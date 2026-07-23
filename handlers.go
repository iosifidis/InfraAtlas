package main

import (
	"bufio"
	"crypto/rand"
	"encoding/base64"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// Session structure for in-memory auth
var sessions = struct {
	sync.RWMutex
	m map[string]string // token -> username
}{m: make(map[string]string)}

// Session expiry helper or simple token validation
const sessionCookieName = "session_token"

func generateToken() string {
	b := make([]byte, 32)
	rand.Read(b)
	return base64.URLEncoding.EncodeToString(b)
}

// Helpers for JSON responses
func respondWithError(w http.ResponseWriter, code int, message string) {
	respondWithJSON(w, code, map[string]string{"error": message})
}

func respondWithJSON(w http.ResponseWriter, code int, payload interface{}) {
	response, err := json.Marshal(payload)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(`{"error": "Failed to marshal JSON response"}`))
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	w.Write(response)
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

		// Check if setup is completed. If not, block other requests.
		hasUsers, err := HasUsers()
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Database error checking users")
			return
		}
		if !hasUsers {
			respondWithError(w, http.StatusForbidden, "Setup required")
			return
		}

		// Check session cookie
		cookie, err := r.Cookie(sessionCookieName)
		if err != nil {
			respondWithError(w, http.StatusUnauthorized, "Unauthorized: Session cookie missing")
			return
		}

		sessions.RLock()
		username, exists := sessions.m[cookie.Value]
		sessions.RUnlock()

		if !exists {
			respondWithError(w, http.StatusUnauthorized, "Unauthorized: Session invalid or expired")
			return
		}

		// Session is valid. Put username in request header or context if needed (optional)
		r.Header.Set("X-Authenticated-User", username)
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
		_, loggedIn = sessions.m[cookie.Value]
		sessions.RUnlock()
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
	if req.Username == "" || len(req.Password) < 4 {
		respondWithError(w, http.StatusBadRequest, "Username must be non-empty, Password must be at least 4 characters")
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

	// Automate login for setup user
	token := generateToken()
	sessions.Lock()
	sessions.m[token] = req.Username
	sessions.Unlock()

	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    token,
		Expires:  time.Now().Add(24 * time.Hour),
		HttpOnly: true,
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

	token := generateToken()
	sessions.Lock()
	sessions.m[token] = u.Username
	sessions.Unlock()

	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    token,
		Expires:  time.Now().Add(24 * time.Hour),
		HttpOnly: true,
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
			if len(req.NewPassword) < 4 {
				respondWithError(w, http.StatusBadRequest, "Ο νέος κωδικός πρόσβασης πρέπει να έχει τουλάχιστον 4 χαρακτήρες")
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
				sessions.m[cookie.Value] = req.Username
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

// --- Clusters Handlers ---

func handleClusters(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		clusters, err := GetClusters()
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, err.Error())
			return
		}
		respondWithJSON(w, http.StatusOK, clusters)

	case http.MethodPost:
		var c Cluster
		if err := json.NewDecoder(r.Body).Decode(&c); err != nil {
			respondWithError(w, http.StatusBadRequest, "Invalid request body")
			return
		}
		c.Name = strings.TrimSpace(c.Name)
		if c.Name == "" {
			respondWithError(w, http.StatusBadRequest, "Cluster name is required")
			return
		}
		if err := CreateCluster(&c); err != nil {
			respondWithError(w, http.StatusInternalServerError, err.Error())
			return
		}
		respondWithJSON(w, http.StatusCreated, c)

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
	}
}

func handleClusterDetail(w http.ResponseWriter, r *http.Request) {
	// Parse ID
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid cluster ID")
		return
	}

	switch r.Method {
	case http.MethodGet:
		c, err := GetCluster(id)
		if err != nil {
			respondWithError(w, http.StatusNotFound, "Cluster not found")
			return
		}
		respondWithJSON(w, http.StatusOK, c)

	case http.MethodPut:
		var c Cluster
		if err := json.NewDecoder(r.Body).Decode(&c); err != nil {
			respondWithError(w, http.StatusBadRequest, "Invalid request body")
			return
		}
		c.ID = id
		c.Name = strings.TrimSpace(c.Name)
		if c.Name == "" {
			respondWithError(w, http.StatusBadRequest, "Cluster name is required")
			return
		}
		if err := UpdateCluster(&c); err != nil {
			respondWithError(w, http.StatusInternalServerError, err.Error())
			return
		}
		respondWithJSON(w, http.StatusOK, c)

	case http.MethodDelete:
		if err := DeleteCluster(id); err != nil {
			respondWithError(w, http.StatusInternalServerError, err.Error())
			return
		}
		respondWithJSON(w, http.StatusOK, map[string]string{"message": "Cluster deleted"})

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
	}
}

// --- VMs Handlers ---

func handleVMs(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		q := r.URL.Query()

		var clusterID int64
		if cid := q.Get("cluster_id"); cid != "" {
			clusterID, _ = strconv.ParseInt(cid, 10, 64)
		}

		var inUse *int
		if iu := q.Get("in_use"); iu != "" {
			val, err := strconv.Atoi(iu)
			if err == nil {
				inUse = &val
			}
		}

		var isImportant *int
		if imp := q.Get("is_important"); imp != "" {
			val, err := strconv.Atoi(imp)
			if err == nil {
				isImportant = &val
			}
		}

		var monitored *int
		if mon := q.Get("monitored"); mon != "" {
			val, err := strconv.Atoi(mon)
			if err == nil {
				monitored = &val
			}
		}

		search := q.Get("search")

		vms, err := GetVMs(clusterID, inUse, isImportant, monitored, search)
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, err.Error())
			return
		}
		respondWithJSON(w, http.StatusOK, vms)

	case http.MethodPost:
		var v VM
		if err := json.NewDecoder(r.Body).Decode(&v); err != nil {
			respondWithError(w, http.StatusBadRequest, "Invalid request body")
			return
		}
		v.Name = strings.TrimSpace(v.Name)
		if v.Name == "" || v.ClusterID == 0 {
			respondWithError(w, http.StatusBadRequest, "VM name and Cluster ID are required")
			return
		}
		if err := CreateVM(&v); err != nil {
			respondWithError(w, http.StatusInternalServerError, err.Error())
			return
		}
		respondWithJSON(w, http.StatusCreated, v)

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
	}
}

func handleVMDetail(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid VM ID")
		return
	}

	switch r.Method {
	case http.MethodGet:
		v, err := GetVM(id)
		if err != nil {
			respondWithError(w, http.StatusNotFound, "VM not found")
			return
		}
		respondWithJSON(w, http.StatusOK, v)

	case http.MethodPut:
		var v VM
		if err := json.NewDecoder(r.Body).Decode(&v); err != nil {
			respondWithError(w, http.StatusBadRequest, "Invalid request body")
			return
		}
		v.ID = id
		v.Name = strings.TrimSpace(v.Name)
		if v.Name == "" || v.ClusterID == 0 {
			respondWithError(w, http.StatusBadRequest, "VM name and Cluster ID are required")
			return
		}
		if err := UpdateVM(&v); err != nil {
			respondWithError(w, http.StatusInternalServerError, err.Error())
			return
		}
		respondWithJSON(w, http.StatusOK, v)

	case http.MethodDelete:
		if err := DeleteVM(id); err != nil {
			respondWithError(w, http.StatusInternalServerError, err.Error())
			return
		}
		respondWithJSON(w, http.StatusOK, map[string]string{"message": "VM deleted"})

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
	}
}

// --- Stats Handlers ---

func handleStats(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	// Calculate totals and per cluster resource allocation
	clusters, err := GetClusters()
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, err.Error())
		return
	}

	vms, err := GetVMs(0, nil, nil, nil, "")
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, err.Error())
		return
	}

	var totalCPU float64
	var totalRAM float64
	var totalDisk float64
	var totalExtraDisk float64
	var totalVMs int
	var inUseVMs int
	var importantVMs int
	var monitoredVMs int
	var usedByUsVMs int

	clusterStats := make(map[int64]map[string]interface{})
	for _, c := range clusters {
		clusterStats[c.ID] = map[string]interface{}{
			"id":             c.ID,
			"name":           c.Name,
			"cpu":            0.0,
			"ram":            0.0,
			"disk":           0.0,
			"extra_disk":     0.0,
			"vm_count":       0,
			"in_use_count":   0,
			"internal_count": 0,
		}
	}

	for _, v := range vms {
		totalVMs++
		if v.InUse == 1 {
			inUseVMs++
		}
		if v.IsImportant == 1 {
			importantVMs++
		}
		if v.Monitored == 1 {
			monitoredVMs++
		}
		if v.UsedByUs == 1 {
			usedByUsVMs++
		}

		totalCPU += v.CPU
		totalRAM += v.RAM
		totalDisk += v.Disk
		totalExtraDisk += v.ExtraDisk

		if stat, exists := clusterStats[v.ClusterID]; exists {
			stat["cpu"] = stat["cpu"].(float64) + v.CPU
			stat["ram"] = stat["ram"].(float64) + v.RAM
			stat["disk"] = stat["disk"].(float64) + v.Disk
			stat["extra_disk"] = stat["extra_disk"].(float64) + v.ExtraDisk
			stat["vm_count"] = stat["vm_count"].(int) + 1
			if v.InUse == 1 {
				stat["in_use_count"] = stat["in_use_count"].(int) + 1
			}
			if v.UsedByUs == 1 {
				stat["internal_count"] = stat["internal_count"].(int) + 1
			}
		}
	}

	// Flatten cluster statistics
	var clusterList []interface{}
	for _, c := range clusters {
		if stat, exists := clusterStats[c.ID]; exists {
			clusterList = append(clusterList, stat)
		}
	}

	statsPayload := map[string]interface{}{
		"total_clusters":       len(clusters),
		"total_vms":            totalVMs,
		"in_use_vms":           inUseVMs,
		"important_vms":        importantVMs,
		"monitored_vms":        monitoredVMs,
		"used_by_us_vms":       usedByUsVMs,
		"total_cpu":            totalCPU,
		"total_ram":            totalRAM,
		"total_disk":           totalDisk,
		"total_extra_disk":     totalExtraDisk,
		"cluster_distribution": clusterList,
	}

	respondWithJSON(w, http.StatusOK, statsPayload)
}

// --- Settings Handlers ---

func handleSettings(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		settings, err := GetSettings()
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, err.Error())
			return
		}
		respondWithJSON(w, http.StatusOK, settings)

	case http.MethodPost:
		var req map[string]string
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			respondWithError(w, http.StatusBadRequest, "Invalid request body")
			return
		}

		for k, v := range req {
			if err := SaveSetting(k, v); err != nil {
				respondWithError(w, http.StatusInternalServerError, err.Error())
				return
			}
		}
		respondWithJSON(w, http.StatusOK, map[string]string{"message": "Settings saved"})

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
	}
}

// --- CSV Export Handlers ---

func handleExportCSV(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	q := r.URL.Query()

	var clusterID int64
	if cid := q.Get("cluster_id"); cid != "" {
		clusterID, _ = strconv.ParseInt(cid, 10, 64)
	}

	var inUse *int
	if iu := q.Get("in_use"); iu != "" {
		val, err := strconv.Atoi(iu)
		if err == nil {
			inUse = &val
		}
	}

	var isImportant *int
	if imp := q.Get("is_important"); imp != "" {
		val, err := strconv.Atoi(imp)
		if err == nil {
			isImportant = &val
		}
	}

	var monitored *int
	if mon := q.Get("monitored"); mon != "" {
		val, err := strconv.Atoi(mon)
		if err == nil {
			monitored = &val
		}
	}

	search := q.Get("search")

	vms, err := GetVMs(clusterID, inUse, isImportant, monitored, search)
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, err.Error())
		return
	}

	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=vms-report-%s.csv", time.Now().Format("2006-01-02")))

	// Write UTF-8 BOM so Excel opens it with correct Greek character encoding
	w.Write([]byte{0xEF, 0xBB, 0xBF})

	// CSV Header
	headers := []string{
		"Όνομα VM", "Cluster", "URL", "Σε Χρήση", "Σημαντικό", "Χρήση από Εμάς",
		"CPU", "RAM", "Δίσκος", "Extra Δίσκος", "IPv4", "IPv6",
		"VPN", "Backup", "Monitored", "OS", "OS Version", "Υπεύθυνος Επικοινωνίας", "Περιγραφή",
	}

	fmt.Fprintf(w, "%s\n", strings.Join(headers, ";")) // using semicolon as delimiter is more Excel-friendly in European locales

	for _, v := range vms {
		row := []string{
			escapeCSV(v.Name),
			escapeCSV(v.ClusterName),
			escapeCSV(v.URL),
			boolToGreek(v.InUse),
			boolToGreek(v.IsImportant),
			boolToGreek(v.UsedByUs),
			fmt.Sprintf("%.1f", v.CPU),
			fmt.Sprintf("%.1f", v.RAM),
			fmt.Sprintf("%.1f", v.Disk),
			fmt.Sprintf("%.1f", v.ExtraDisk),
			escapeCSV(v.IPv4),
			escapeCSV(v.IPv6),
			escapeCSV(v.VPN),
			escapeCSV(v.Backup),
			boolToGreek(v.Monitored),
			escapeCSV(v.OS),
			escapeCSV(v.OSVersion),
			escapeCSV(v.ContactPerson),
			escapeCSV(v.Description),
		}
		fmt.Fprintf(w, "%s\n", strings.Join(row, ";"))
	}
}

func escapeCSV(s string) string {
	s = strings.ReplaceAll(s, "\n", " ")
	s = strings.ReplaceAll(s, "\r", " ")
	if strings.ContainsAny(s, `;"`) {
		s = strings.ReplaceAll(s, `"`, `""`)
		return `"` + s + `"`
	}
	return s
}

func boolToGreek(val int) string {
	if val == 1 {
		return "Ναι"
	}
	return "Όχι"
}

// --- DNS Records Handlers ---

func handleDNSRecords(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		q := r.URL.Query()
		search := q.Get("search")
		recType := strings.ToUpper(q.Get("type"))

		records, err := GetDNSRecords(search, recType)
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, err.Error())
			return
		}
		respondWithJSON(w, http.StatusOK, records)

	case http.MethodPost:
		var rec DNSRecord
		if err := json.NewDecoder(r.Body).Decode(&rec); err != nil {
			respondWithError(w, http.StatusBadRequest, "Invalid request body")
			return
		}
		rec.Name = strings.TrimSpace(rec.Name)
		rec.Type = strings.ToUpper(strings.TrimSpace(rec.Type))
		rec.Value = strings.TrimSpace(rec.Value)

		if rec.Name == "" || rec.Value == "" || (rec.Type != "A" && rec.Type != "CNAME") {
			respondWithError(w, http.StatusBadRequest, "Name, Value and Type ('A' or 'CNAME') are required")
			return
		}
		if rec.TTL <= 0 {
			rec.TTL = 86400
		}

		if err := CreateDNSRecord(&rec); err != nil {
			respondWithError(w, http.StatusInternalServerError, err.Error())
			return
		}
		respondWithJSON(w, http.StatusCreated, rec)

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
	}
}

func handleDNSRecordDetail(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid DNS Record ID")
		return
	}

	switch r.Method {
	case http.MethodGet:
		rec, err := GetDNSRecord(id)
		if err != nil {
			respondWithError(w, http.StatusNotFound, "DNS Record not found")
			return
		}
		respondWithJSON(w, http.StatusOK, rec)

	case http.MethodPut:
		var rec DNSRecord
		if err := json.NewDecoder(r.Body).Decode(&rec); err != nil {
			respondWithError(w, http.StatusBadRequest, "Invalid request body")
			return
		}
		rec.ID = id
		rec.Name = strings.TrimSpace(rec.Name)
		rec.Type = strings.ToUpper(strings.TrimSpace(rec.Type))
		rec.Value = strings.TrimSpace(rec.Value)

		if rec.Name == "" || rec.Value == "" || (rec.Type != "A" && rec.Type != "CNAME") {
			respondWithError(w, http.StatusBadRequest, "Name, Value and Type ('A' or 'CNAME') are required")
			return
		}
		if rec.TTL <= 0 {
			rec.TTL = 86400
		}

		if err := UpdateDNSRecord(&rec); err != nil {
			respondWithError(w, http.StatusInternalServerError, err.Error())
			return
		}
		respondWithJSON(w, http.StatusOK, rec)

	case http.MethodDelete:
		if err := DeleteDNSRecord(id); err != nil {
			respondWithError(w, http.StatusInternalServerError, err.Error())
			return
		}
		respondWithJSON(w, http.StatusOK, map[string]string{"message": "DNS record deleted"})

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
	}
}

func handleDNSImport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	var content string

	// Handle multipart form upload or raw text payload
	if strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data") {
		file, _, err := r.FormFile("zonefile")
		if err != nil {
			respondWithError(w, http.StatusBadRequest, "Failed to get uploaded file 'zonefile'")
			return
		}
		defer file.Close()
		bytes, err := io.ReadAll(file)
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to read file content")
			return
		}
		content = string(bytes)
	} else {
		bytes, err := io.ReadAll(r.Body)
		if err != nil {
			respondWithError(w, http.StatusBadRequest, "Failed to read request body")
			return
		}
		content = string(bytes)
	}

	parsedRecords := parseZoneFile(content)
	if len(parsedRecords) == 0 {
		respondWithError(w, http.StatusBadRequest, "No valid A or CNAME records found in file")
		return
	}

	inserted, updated, err := BulkUpsertDNSRecords(parsedRecords)
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, fmt.Sprintf("Error saving DNS records: %v", err))
		return
	}

	respondWithJSON(w, http.StatusOK, map[string]interface{}{
		"message":  fmt.Sprintf("Import successful. Inserted: %d, Updated: %d", inserted, updated),
		"inserted": inserted,
		"updated":  updated,
		"total":    len(parsedRecords),
	})
}

// parseZoneFile extracts A and CNAME records from BIND zone file content
func parseZoneFile(content string) []DNSRecord {
	var records []DNSRecord
	scanner := bufio.NewScanner(strings.NewReader(content))

	for scanner.Scan() {
		line := scanner.Text()
		// Strip comments starting with ';'
		if idx := strings.Index(line, ";"); idx != -1 {
			line = line[:idx]
		}
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		fields := strings.Fields(line)
		if len(fields) < 3 {
			continue
		}

		// Find "A" or "CNAME" field index
		typeIdx := -1
		var recType string
		for i, field := range fields {
			upper := strings.ToUpper(field)
			if upper == "A" || upper == "CNAME" {
				typeIdx = i
				recType = upper
				break
			}
		}

		if typeIdx == -1 || typeIdx+1 >= len(fields) {
			continue
		}

		name := strings.TrimSuffix(fields[0], ".")
		value := strings.TrimSuffix(fields[typeIdx+1], ".")
		ttl := 86400

		// Look for TTL in fields before typeIdx
		for j := 1; j < typeIdx; j++ {
			if num, err := strconv.Atoi(fields[j]); err == nil && num > 0 {
				ttl = num
				break
			}
		}

		if name != "" && value != "" {
			records = append(records, DNSRecord{
				Name:  name,
				Type:  recType,
				Value: value,
				TTL:   ttl,
			})
		}
	}

	return records
}

// --- VM CSV Import ---

type parsedVMItem struct {
	vm          VM
	clusterName string
}

func ImportVMsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "Failed to read request body")
		return
	}

	parsedItems, err := parseVMCSV(string(body))
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "Failed to parse CSV file: "+err.Error())
		return
	}

	inserted, updated := 0, 0
	clusterCache := make(map[string]int64)

	for _, item := range parsedItems {
		cName := strings.TrimSpace(item.clusterName)
		if cName == "" {
			cName = "General Cluster"
		}

		clusterID, exists := clusterCache[strings.ToLower(cName)]
		if !exists {
			var err error
			clusterID, err = GetOrCreateClusterByName(cName)
			if err != nil {
				respondWithError(w, http.StatusInternalServerError, "Failed to create/get cluster: "+err.Error())
				return
			}
			clusterCache[strings.ToLower(cName)] = clusterID
		}

		vm := item.vm
		vm.ClusterID = clusterID

		created, err := UpsertVMByName(&vm)
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to save VM: "+err.Error())
			return
		}

		if created {
			inserted++
		} else {
			updated++
		}
	}

	respondWithJSON(w, http.StatusOK, map[string]interface{}{
		"message":  "VM CSV Import completed successfully",
		"inserted": inserted,
		"updated":  updated,
		"total":    len(parsedItems),
	})
}

func parseVMCSV(content string) ([]parsedVMItem, error) {
	r := csv.NewReader(strings.NewReader(content))
	r.FieldsPerRecord = -1 // allow variable column counts
	r.LazyQuotes = true

	records, err := r.ReadAll()
	if err != nil {
		return nil, err
	}

	var results []parsedVMItem
	currentCluster := "General Cluster"

	for i, record := range records {
		if len(record) == 0 {
			continue
		}

		// Skip main header row
		if i == 0 && len(record) > 0 && strings.ToUpper(strings.TrimSpace(record[0])) == "ONOMA" {
			continue
		}

		name := strings.TrimSpace(record[0])
		if name == "" {
			continue
		}

		// Check if cluster header row (e.g., "Thiseas", "ViMa", "KNOSSOS", "OKEANOS")
		isClusterHeader := true
		for colIdx := 1; colIdx < len(record); colIdx++ {
			if strings.TrimSpace(record[colIdx]) != "" {
				isClusterHeader = false
				break
			}
		}
		if isClusterHeader {
			currentCluster = name
			continue
		}

		// Regular VM row
		clusterName := currentCluster
		if len(record) > 17 && strings.TrimSpace(record[17]) != "" {
			clusterName = strings.TrimSpace(record[17])
		}

		var vm VM
		vm.Name = name

		if len(record) > 1 {
			vm.URL = strings.TrimSpace(record[1])
		}
		if len(record) > 2 {
			val := strings.ToUpper(strings.TrimSpace(record[2]))
			if strings.Contains(val, "ΝΑΙ") || strings.Contains(val, "YES") || val == "1" {
				vm.InUse = 1
			} else {
				vm.InUse = 0
			}
		}
		if len(record) > 3 {
			val := strings.ToUpper(strings.TrimSpace(record[3]))
			if strings.Contains(val, "ΝΑΙ") || strings.Contains(val, "YES") || strings.Contains(val, "HIGH") || strings.Contains(val, "MEDIUM") {
				vm.IsImportant = 1
			} else {
				vm.IsImportant = 0
			}
		}
		if len(record) > 5 {
			if num, err := strconv.ParseFloat(strings.TrimSpace(record[5]), 64); err == nil {
				vm.CPU = num
			}
		}
		if len(record) > 6 {
			if num, err := strconv.ParseFloat(strings.TrimSpace(record[6]), 64); err == nil {
				vm.RAM = num
			}
		}
		if len(record) > 7 {
			if num, err := strconv.ParseFloat(strings.TrimSpace(record[7]), 64); err == nil {
				vm.Disk = num
			}
		}
		if len(record) > 8 {
			val := strings.TrimSpace(record[8])
			if num, err := strconv.ParseFloat(val, 64); err == nil {
				vm.ExtraDisk = num
			} else if idx := strings.Index(val, "+"); idx != -1 {
				parts := strings.Split(val, "+")
				var sum float64
				for _, p := range parts {
					if n, e := strconv.ParseFloat(strings.TrimSpace(p), 64); e == nil {
						sum += n
					}
				}
				vm.ExtraDisk = sum
			}
		}
		if len(record) > 9 {
			vm.IPv4 = strings.TrimSpace(record[9])
		}
		if len(record) > 10 {
			vm.IPv6 = strings.TrimSpace(record[10])
		}
		if len(record) > 11 {
			vm.VPN = strings.TrimSpace(record[11])
		}
		if len(record) > 12 {
			vm.Backup = strings.TrimSpace(record[12])
		}
		if len(record) > 13 {
			val := strings.ToUpper(strings.TrimSpace(record[13]))
			if val != "" && !strings.Contains(val, "OXI") && !strings.Contains(val, "ΟΧΙ") {
				vm.Monitored = 1
			} else {
				vm.Monitored = 0
			}
		}
		if len(record) > 14 {
			vm.OS = strings.TrimSpace(record[14])
		}
		if len(record) > 15 {
			vm.OSVersion = strings.TrimSpace(record[15])
		}
		if len(record) > 18 {
			vm.ContactPerson = strings.TrimSpace(record[18])
		}
		if len(record) > 19 {
			vm.Description = strings.TrimSpace(record[19])
		}

		results = append(results, parsedVMItem{
			vm:          vm,
			clusterName: clusterName,
		})
	}

	return results, nil
}

