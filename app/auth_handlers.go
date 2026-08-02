package app

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// sessionData holds the username and expiry for an in-memory session.
type sessionData struct {
	username  string
	expiresAt time.Time
}

const sessionDuration = 24 * time.Hour

var sessions = struct {
	sync.RWMutex
	m map[string]sessionData // token → sessionData
}{m: make(map[string]sessionData)}

const sessionCookieName = "session_token"

// Rate Limiter for Authentication Endpoints (max 5 requests per minute per IP)
type rateLimiter struct {
	sync.Mutex
	attempts map[string][]time.Time
}

var authRateLimiter = &rateLimiter{attempts: make(map[string][]time.Time)}

func (rl *rateLimiter) isAllowed(ip string, maxAttempts int, window time.Duration) bool {
	rl.Lock()
	defer rl.Unlock()

	now := time.Now()
	cutoff := now.Add(-window)

	timestamps := rl.attempts[ip]
	var valid []time.Time
	for _, t := range timestamps {
		if t.After(cutoff) {
			valid = append(valid, t)
		}
	}

	if len(valid) >= maxAttempts {
		rl.attempts[ip] = valid
		return false
	}

	valid = append(valid, now)
	rl.attempts[ip] = valid
	return true
}

func getClientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		return strings.TrimSpace(parts[0])
	}
	if ip, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return ip
	}
	return r.RemoteAddr
}

func isSecureRequest(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	return strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
}

// setupCompleted caches whether the first admin has been created,
// avoiding a HasUsers() DB query on every authenticated API request.
var setupCompleted atomic.Bool

func generateToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("failed to generate secure token: %w", err)
	}
	return base64.URLEncoding.EncodeToString(b), nil
}

// startSessionCleanup purges expired sessions once per hour.
func startSessionCleanup() {
	go func() {
		ticker := time.NewTicker(time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			now := time.Now()
			sessions.Lock()
			for token, data := range sessions.m {
				if now.After(data.expiresAt) {
					delete(sessions.m, token)
				}
			}
			sessions.Unlock()
		}
	}()
}

// Middleware to check authentication
func AuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Allow checking setup status and performing initial setup
		if r.URL.Path == "/api/auth/status" || r.URL.Path == "/api/auth/setup" {
			next.ServeHTTP(w, r)
			return
		}

		// Also allow login endpoint
		if r.URL.Path == "/api/auth/login" {
			next.ServeHTTP(w, r)
			return
		}

		// Check setup once; cache the result to skip DB on every request.
		if !setupCompleted.Load() {
			hasUsers, err := HasUsers()
			if err != nil {
				respondWithError(w, http.StatusInternalServerError, "Database error checking users")
				return
			}
			if !hasUsers {
				respondWithError(w, http.StatusForbidden, "Setup required")
				return
			}
			setupCompleted.Store(true)
		}

		// Check session cookie
		cookie, err := r.Cookie(sessionCookieName)
		if err != nil {
			respondWithError(w, http.StatusUnauthorized, "Unauthorized: Session cookie missing")
			return
		}

		sessions.RLock()
		data, exists := sessions.m[cookie.Value]
		sessions.RUnlock()

		if !exists || time.Now().After(data.expiresAt) {
			if exists {
				sessions.Lock()
				delete(sessions.m, cookie.Value)
				sessions.Unlock()
			}
			respondWithError(w, http.StatusUnauthorized, "Unauthorized: Session invalid or expired")
			return
		}

		r.Header.Set("X-Authenticated-User", data.username)
		next.ServeHTTP(w, r)
	})
}

// --- Auth Handlers ---

func handleAuthStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	hasUsers, err := HasUsers()
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "Failed to check users status")
		return
	}

	loggedIn := false
	cookie, err := r.Cookie(sessionCookieName)
	if err == nil {
		sessions.RLock()
		data, ok := sessions.m[cookie.Value]
		sessions.RUnlock()
		loggedIn = ok && time.Now().Before(data.expiresAt)
	}

	respondWithJSON(w, http.StatusOK, map[string]bool{
		"setup_completed": hasUsers,
		"logged_in":       loggedIn,
	})
}

func handleAuthSetup(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	if !authRateLimiter.isAllowed(getClientIP(r), 5, time.Minute) {
		respondWithError(w, http.StatusTooManyRequests, "Too many requests. Please try again later.")
		return
	}

	hasUsers, err := HasUsers()
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "Failed to check users status")
		return
	}
	if hasUsers {
		respondWithError(w, http.StatusForbidden, "Setup already completed")
		return
	}

	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	req.Username = strings.TrimSpace(req.Username)
	if req.Username == "" || len(req.Password) < 8 {
		respondWithError(w, http.StatusBadRequest, "Username must be non-empty, Password must be at least 8 characters")
		return
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "Failed to hash password")
		return
	}

	if err := CreateUser(req.Username, string(hashedPassword)); err != nil {
		respondWithError(w, http.StatusInternalServerError, "Failed to save administrator")
		return
	}
	setupCompleted.Store(true)

	// Automate login for setup user
	token, err := generateToken()
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "Failed to generate session token")
		return
	}
	sessions.Lock()
	sessions.m[token] = sessionData{username: req.Username, expiresAt: time.Now().Add(sessionDuration)}
	sessions.Unlock()

	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    token,
		Expires:  time.Now().Add(24 * time.Hour),
		HttpOnly: true,
		Secure:   isSecureRequest(r),
		Path:     "/",
		SameSite: http.SameSiteLaxMode,
	})

	respondWithJSON(w, http.StatusOK, map[string]string{"message": "Setup successful"})
}

func handleAuthLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	if !authRateLimiter.isAllowed(getClientIP(r), 5, time.Minute) {
		respondWithError(w, http.StatusTooManyRequests, "Too many requests. Please try again later.")
		return
	}

	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	u, err := GetUserByUsername(req.Username)
	if err != nil {
		respondWithError(w, http.StatusUnauthorized, "Invalid credentials")
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(req.Password)); err != nil {
		respondWithError(w, http.StatusUnauthorized, "Invalid credentials")
		return
	}

	token, err := generateToken()
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "Failed to generate session token")
		return
	}
	sessions.Lock()
	sessions.m[token] = sessionData{username: u.Username, expiresAt: time.Now().Add(sessionDuration)}
	sessions.Unlock()

	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    token,
		Expires:  time.Now().Add(24 * time.Hour),
		HttpOnly: true,
		Secure:   isSecureRequest(r),
		Path:     "/",
		SameSite: http.SameSiteLaxMode,
	})

	respondWithJSON(w, http.StatusOK, map[string]string{"message": "Login successful"})
}

func handleAuthLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	cookie, err := r.Cookie(sessionCookieName)
	if err == nil {
		sessions.Lock()
		delete(sessions.m, cookie.Value)
		sessions.Unlock()
	}

	// Delete cookie
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    "",
		Expires:  time.Unix(0, 0),
		HttpOnly: true,
		Path:     "/",
		SameSite: http.SameSiteLaxMode,
	})

	respondWithJSON(w, http.StatusOK, map[string]string{"message": "Logout successful"})
}

func handleAuthProfile(w http.ResponseWriter, r *http.Request) {
	currentUsername := r.Header.Get("X-Authenticated-User")
	if currentUsername == "" {
		respondWithError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	u, err := GetUserByUsername(currentUsername)
	if err != nil {
		respondWithError(w, http.StatusNotFound, "User not found")
		return
	}

	switch r.Method {
	case http.MethodGet:
		respondWithJSON(w, http.StatusOK, map[string]interface{}{
			"id":       u.ID,
			"username": u.Username,
		})

	case http.MethodPut, http.MethodPost:
		var req struct {
			Username        string `json:"username"`
			CurrentPassword string `json:"current_password"`
			NewPassword     string `json:"new_password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			respondWithError(w, http.StatusBadRequest, "Invalid request body")
			return
		}

		req.Username = strings.TrimSpace(req.Username)
		if req.Username == "" {
			req.Username = u.Username
		}

		// Verify current password
		if err := bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(req.CurrentPassword)); err != nil {
			respondWithError(w, http.StatusUnauthorized, "Ο τρέχων κωδικός πρόσβασης είναι εσφαλμένος")
			return
		}

		var newPasswordHash string
		if req.NewPassword != "" {
			if len(req.NewPassword) < 8 {
				respondWithError(w, http.StatusBadRequest, "Ο νέος κωδικός πρόσβασης πρέπει να έχει τουλάχιστον 8 χαρακτήρες")
				return
			}
			hash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
			if err != nil {
				respondWithError(w, http.StatusInternalServerError, "Σφάλμα κρυπτογράφησης κωδικού")
				return
			}
			newPasswordHash = string(hash)
		}

		if err := UpdateUserProfile(u.ID, req.Username, newPasswordHash); err != nil {
			respondWithError(w, http.StatusInternalServerError, "Σφάλμα ενημέρωσης προφίλ: "+err.Error())
			return
		}

		// Update in-memory session if username changed
		if req.Username != u.Username {
			cookie, err := r.Cookie(sessionCookieName)
			if err == nil {
				sessions.Lock()
				if data, ok := sessions.m[cookie.Value]; ok {
					data.username = req.Username
					sessions.m[cookie.Value] = data
				}
				sessions.Unlock()
			}
		}

		respondWithJSON(w, http.StatusOK, map[string]interface{}{
			"message":  "Τα στοιχεία προφίλ ενημερώθηκαν με επιτυχία",
			"username": req.Username,
		})

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
	}
}
