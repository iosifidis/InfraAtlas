package app

import (
	"bytes"
	"crypto/tls"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func TestBoolToGreek(t *testing.T) {
	tests := []struct {
		input    int
		expected string
	}{
		{1, "Ναι"},
		{0, "Όχι"},
		{-1, "Όχι"},
		{10, "Όχι"},
	}

	for _, tt := range tests {
		result := boolToGreek(tt.input)
		if result != tt.expected {
			t.Errorf("boolToGreek(%d) = %q; want %q", tt.input, result, tt.expected)
		}
	}
}

func TestParseZoneFile(t *testing.T) {
	zoneContent := `
; Zone file for example.com
$TTL 86400
@       IN      SOA     ns1.example.com. admin.example.com. ( 2026010101 3600 1800 604800 86400 )
web     3600    IN      A       192.168.1.10 ; Web Server
mail    IN      A       192.168.1.20
blog            IN      CNAME   web.example.com.
`
	records := parseZoneFile(zoneContent)

	if len(records) != 3 {
		t.Fatalf("expected 3 DNS records, got %d", len(records))
	}

	// Record 1: web
	if records[0].Name != "web" || records[0].Type != "A" || records[0].Value != "192.168.1.10" || records[0].TTL != 3600 {
		t.Errorf("unexpected record 0: %+v", records[0])
	}

	// Record 2: mail
	if records[1].Name != "mail" || records[1].Type != "A" || records[1].Value != "192.168.1.20" || records[1].TTL != 86400 {
		t.Errorf("unexpected record 1: %+v", records[1])
	}

	// Record 3: blog
	if records[2].Name != "blog" || records[2].Type != "CNAME" || records[2].Value != "web.example.com" {
		t.Errorf("unexpected record 2: %+v", records[2])
	}
}

func TestAuthRateLimiter(t *testing.T) {
	limiter := &rateLimiter{attempts: make(map[string][]time.Time)}
	testIP := "192.168.1.100"

	// First 5 requests should be allowed
	for i := 0; i < 5; i++ {
		if !limiter.isAllowed(testIP, 5, time.Minute) {
			t.Errorf("request %d should be allowed", i+1)
		}
	}

	// 6th request should be rejected
	if limiter.isAllowed(testIP, 5, time.Minute) {
		t.Errorf("6th request should be blocked by rate limiter")
	}

	// Different IP should still be allowed
	if !limiter.isAllowed("192.168.1.101", 5, time.Minute) {
		t.Errorf("request from new IP should be allowed")
	}
}

func TestIsSecureRequest(t *testing.T) {
	// Standard HTTP request
	req1 := httptest.NewRequest("GET", "http://example.com/api/test", nil)
	if isSecureRequest(req1) {
		t.Errorf("expected standard HTTP request to return isSecureRequest=false")
	}

	// Request with TLS connection
	req2 := httptest.NewRequest("GET", "https://example.com/api/test", nil)
	req2.TLS = &tls.ConnectionState{}
	if !isSecureRequest(req2) {
		t.Errorf("expected TLS request to return isSecureRequest=true")
	}

	// Request behind HTTPS proxy (X-Forwarded-Proto)
	req3 := httptest.NewRequest("GET", "http://example.com/api/test", nil)
	req3.Header.Set("X-Forwarded-Proto", "https")
	if !isSecureRequest(req3) {
		t.Errorf("expected X-Forwarded-Proto: https to return isSecureRequest=true")
	}
}

func TestAuthMiddleware(t *testing.T) {
	handler := AuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("OK"))
	}))

	// Setup bypass check
	setupCompleted.Store(true)

	// Test 1: Unauthenticated request to protected endpoint -> 401
	req1 := httptest.NewRequest("GET", "/api/vms", nil)
	rr1 := httptest.NewRecorder()
	handler.ServeHTTP(rr1, req1)
	if rr1.Code != http.StatusUnauthorized {
		t.Errorf("expected status 401 Unauthorized, got %d", rr1.Code)
	}

	// Test 2: Public endpoint bypass (/api/auth/login)
	req2 := httptest.NewRequest("POST", "/api/auth/login", nil)
	rr2 := httptest.NewRecorder()
	handler.ServeHTTP(rr2, req2)
	if rr2.Code != http.StatusOK {
		t.Errorf("expected status 200 OK for login endpoint bypass, got %d", rr2.Code)
	}

	// Test 3: Authenticated request with valid token
	token := "test-valid-session-token"
	sessions.Lock()
	sessions.m[token] = sessionData{username: "testuser", expiresAt: time.Now().Add(time.Hour)}
	sessions.Unlock()

	req3 := httptest.NewRequest("GET", "/api/vms", nil)
	req3.AddCookie(&http.Cookie{Name: sessionCookieName, Value: token})
	rr3 := httptest.NewRecorder()
	handler.ServeHTTP(rr3, req3)
	if rr3.Code != http.StatusOK {
		t.Errorf("expected status 200 OK for valid session token, got %d", rr3.Code)
	}
}

func setupTestDB(t *testing.T) {
	t.Helper()
	if err := InitDB(":memory:"); err != nil {
		t.Fatalf("InitDB(:memory:) failed: %v", err)
	}
	t.Cleanup(func() {
		if DB != nil {
			_ = DB.Close()
		}
	})
}

func TestRateLimiterCleanup(t *testing.T) {
	limiter := &rateLimiter{attempts: map[string][]time.Time{
		"old-ip":   {time.Now().Add(-2 * time.Minute)},
		"fresh-ip": {time.Now()},
	}}
	limiter.cleanup(time.Minute)

	if _, exists := limiter.attempts["old-ip"]; exists {
		t.Errorf("expected expired IP to be removed by cleanup")
	}
	if _, exists := limiter.attempts["fresh-ip"]; !exists {
		t.Errorf("expected fresh IP to remain after cleanup")
	}
}

func TestClusterCRUDHandlers(t *testing.T) {
	setupTestDB(t)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/clusters", handleClusters)
	mux.HandleFunc("POST /api/clusters", handleClusters)
	mux.HandleFunc("GET /api/clusters/{id}", handleClusterDetail)
	mux.HandleFunc("PUT /api/clusters/{id}", handleClusterDetail)
	mux.HandleFunc("DELETE /api/clusters/{id}", handleClusterDetail)

	// Create
	req := httptest.NewRequest("POST", "/api/clusters", strings.NewReader(`{"name":"Cluster-A","description":"Primary"}`))
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created, got %d: %s", rr.Code, rr.Body.String())
	}

	var created Cluster
	if err := json.Unmarshal(rr.Body.Bytes(), &created); err != nil {
		t.Fatalf("failed to decode created cluster: %v", err)
	}

	// Update non-existent -> 404
	req404 := httptest.NewRequest("PUT", "/api/clusters/9999", strings.NewReader(`{"name":"Missing"}`))
	rr404 := httptest.NewRecorder()
	mux.ServeHTTP(rr404, req404)
	if rr404.Code != http.StatusNotFound {
		t.Errorf("expected 404 Not Found for missing cluster PUT, got %d", rr404.Code)
	}

	// Delete created -> 200
	reqDel := httptest.NewRequest("DELETE", "/api/clusters/1", nil)
	rrDel := httptest.NewRecorder()
	mux.ServeHTTP(rrDel, reqDel)
	if rrDel.Code != http.StatusOK {
		t.Errorf("expected 200 OK on delete, got %d", rrDel.Code)
	}

	// Delete again -> 404
	rrDel2 := httptest.NewRecorder()
	mux.ServeHTTP(rrDel2, httptest.NewRequest("DELETE", "/api/clusters/1", nil))
	if rrDel2.Code != http.StatusNotFound {
		t.Errorf("expected 404 Not Found on second delete, got %d", rrDel2.Code)
	}
}

func TestVMCRUDAndFilterHandlers(t *testing.T) {
	setupTestDB(t)

	c := &Cluster{Name: "Prod"}
	if err := CreateCluster(c); err != nil {
		t.Fatalf("CreateCluster failed: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/vms", handleVMs)
	mux.HandleFunc("POST /api/vms", handleVMs)
	mux.HandleFunc("PATCH /api/vms/{id}", handleVMDetail)
	mux.HandleFunc("DELETE /api/vms/{id}", handleVMDetail)
	mux.HandleFunc("GET /api/export/csv", handleExportCSV)

	body1 := `{"cluster_id":1,"name":"web-01","ansible":1,"docker":0,"cpu":2,"ram":4,"disk":40}`
	body2 := `{"cluster_id":1,"name":"app-01","ansible":0,"docker":1,"cpu":4,"ram":8,"disk":80}`

	for _, b := range []string{body1, body2} {
		rr := httptest.NewRecorder()
		mux.ServeHTTP(rr, httptest.NewRequest("POST", "/api/vms", strings.NewReader(b)))
		if rr.Code != http.StatusCreated {
			t.Fatalf("expected 201 Created, got %d: %s", rr.Code, rr.Body.String())
		}
	}

	// Filter by ansible=1
	rrFilter := httptest.NewRecorder()
	mux.ServeHTTP(rrFilter, httptest.NewRequest("GET", "/api/vms?ansible=1", nil))
	if rrFilter.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", rrFilter.Code)
	}
	var filtered []VM
	if err := json.Unmarshal(rrFilter.Body.Bytes(), &filtered); err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if len(filtered) != 1 || filtered[0].Name != "web-01" {
		t.Errorf("expected only web-01 for ansible=1, got %+v", filtered)
	}

	// Patch upgrade flags
	rrPatch := httptest.NewRecorder()
	mux.ServeHTTP(rrPatch, httptest.NewRequest("PATCH", "/api/vms/1", bytes.NewBufferString(`{"os_upgrade":1}`)))
	if rrPatch.Code != http.StatusOK {
		t.Errorf("expected 200 OK on PATCH, got %d", rrPatch.Code)
	}

	// CSV Export includes new columns
	rrCSV := httptest.NewRecorder()
	mux.ServeHTTP(rrCSV, httptest.NewRequest("GET", "/api/export/csv?docker=1", nil))
	if rrCSV.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on CSV export, got %d", rrCSV.Code)
	}
	csvOut := rrCSV.Body.String()
	if !strings.Contains(csvOut, "Ansible") || !strings.Contains(csvOut, "app-01") || strings.Contains(csvOut, "web-01") {
		t.Errorf("unexpected CSV export output: %s", csvOut)
	}

	// Delete missing -> 404
	rrDel := httptest.NewRecorder()
	mux.ServeHTTP(rrDel, httptest.NewRequest("DELETE", "/api/vms/999", nil))
	if rrDel.Code != http.StatusNotFound {
		t.Errorf("expected 404 Not Found on missing VM delete, got %d", rrDel.Code)
	}
}

func TestDNSImportAndStatsHandlers(t *testing.T) {
	setupTestDB(t)

	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/dns/import", handleDNSImport)
	mux.HandleFunc("GET /api/dns", handleDNSRecords)
	mux.HandleFunc("GET /api/stats", handleStats)
	mux.HandleFunc("POST /api/settings", handleSettings)
	mux.HandleFunc("GET /api/settings", handleSettings)

	zone := "web 3600 IN A 10.0.0.1\napi IN CNAME web.example.com.\n"
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, httptest.NewRequest("POST", "/api/dns/import", strings.NewReader(zone)))
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on DNS import, got %d: %s", rr.Code, rr.Body.String())
	}

	// Settings round-trip
	rrSet := httptest.NewRecorder()
	mux.ServeHTTP(rrSet, httptest.NewRequest("POST", "/api/settings", strings.NewReader(`{"capacity_cpu":"64"}`)))
	if rrSet.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on settings POST, got %d", rrSet.Code)
	}

	rrStats := httptest.NewRecorder()
	mux.ServeHTTP(rrStats, httptest.NewRequest("GET", "/api/stats", nil))
	if rrStats.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on stats GET, got %d", rrStats.Code)
	}
	var stats map[string]interface{}
	if err := json.Unmarshal(rrStats.Body.Bytes(), &stats); err != nil {
		t.Fatalf("decode stats failed: %v", err)
	}
	if stats["total_dns_records"] != float64(2) {
		t.Errorf("expected total_dns_records=2, got %v", stats["total_dns_records"])
	}
}

func TestVMSoftwareAndSearch(t *testing.T) {
	setupTestDB(t)

	c := &Cluster{Name: "WebCluster"}
	if err := CreateCluster(c); err != nil {
		t.Fatalf("CreateCluster failed: %v", err)
	}

	v := &VM{
		ClusterID: c.ID,
		Name:      "portal-vm",
		Software: []VMSoftware{
			{Name: "nginx", Version: "1.24.0"},
			{Name: "php", Version: "8.2"},
			{Name: "wordpress", Version: "6.7"},
		},
	}
	if err := CreateVM(v); err != nil {
		t.Fatalf("CreateVM failed: %v", err)
	}

	loaded, err := GetVM(v.ID)
	if err != nil {
		t.Fatalf("GetVM failed: %v", err)
	}
	if len(loaded.Software) != 3 {
		t.Fatalf("expected 3 software items, got %d", len(loaded.Software))
	}

	// Search by software name
	found, err := GetVMs(VMFilter{Search: "wordpress"})
	if err != nil {
		t.Fatalf("GetVMs search failed: %v", err)
	}
	if len(found) != 1 || found[0].Name != "portal-vm" {
		t.Errorf("expected portal-vm when searching for wordpress, got %+v", found)
	}

	// Update software list
	loaded.Software = []VMSoftware{{Name: "matrix", Version: "1.118"}}
	if err := UpdateVM(&loaded); err != nil {
		t.Fatalf("UpdateVM failed: %v", err)
	}
	reloaded, err := GetVM(v.ID)
	if err != nil {
		t.Fatalf("GetVM after update failed: %v", err)
	}
	if len(reloaded.Software) != 1 || reloaded.Software[0].Name != "matrix" {
		t.Errorf("expected updated software [matrix], got %+v", reloaded.Software)
	}
}

func TestBackupValidation(t *testing.T) {
	badFile, err := os.CreateTemp("", "bad-backup-*.db")
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(badFile.Name())
	_, _ = badFile.WriteString("not a sqlite file")
	_ = badFile.Close()

	if err := validateSQLiteBackup(badFile.Name()); err == nil {
		t.Errorf("expected validateSQLiteBackup to fail for non-sqlite file")
	}
}

func TestVMSyncAndAnsibleInventory(t *testing.T) {
	setupTestDB(t)

	c := &Cluster{Name: "Prod Cluster"}
	if err := CreateCluster(c); err != nil {
		t.Fatalf("CreateCluster failed: %v", err)
	}
	v := &VM{
		ClusterID: c.ID,
		Name:      "web-01",
		IPv4:      "10.0.0.10",
		Ansible:   1,
	}
	if err := CreateVM(v); err != nil {
		t.Fatalf("CreateVM failed: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/vms/sync", handleVMSync)
	mux.HandleFunc("GET /api/ansible/inventory", handleAnsibleInventory)

	syncBody := `{"name":"web-01","os":"Ubuntu","os_version":"24.04","cpu":4,"ram":8,"software":[{"name":"nginx","version":"1.24.0"},{"name":"php","version":"8.3"}]}`
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, httptest.NewRequest("POST", "/api/vms/sync", strings.NewReader(syncBody)))
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on /api/vms/sync, got %d: %s", rr.Code, rr.Body.String())
	}

	var synced VM
	if err := json.Unmarshal(rr.Body.Bytes(), &synced); err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if synced.OS != "Ubuntu" || synced.OSVersion != "24.04" || len(synced.Software) != 2 {
		t.Errorf("unexpected synced VM: %+v", synced)
	}

	// Dynamic inventory
	rrInv := httptest.NewRecorder()
	mux.ServeHTTP(rrInv, httptest.NewRequest("GET", "/api/ansible/inventory", nil))
	if rrInv.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on /api/ansible/inventory, got %d", rrInv.Code)
	}
	if !strings.Contains(rrInv.Body.String(), `"10.0.0.10"`) || !strings.Contains(rrInv.Body.String(), `"prod_cluster"`) {
		t.Errorf("unexpected inventory output: %s", rrInv.Body.String())
	}
}

func TestBearerTokenAuth(t *testing.T) {
	setupTestDB(t)
	if err := CreateUser("admin", "hash"); err != nil {
		t.Fatal(err)
	}
	setupCompleted.Store(true)
	if err := SaveSetting("api_token", "ia_test_secret_token"); err != nil {
		t.Fatal(err)
	}

	handler := AuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// Valid Bearer token
	reqValid := httptest.NewRequest("POST", "/api/vms/sync", nil)
	reqValid.Header.Set("Authorization", "Bearer ia_test_secret_token")
	rrValid := httptest.NewRecorder()
	handler.ServeHTTP(rrValid, reqValid)
	if rrValid.Code != http.StatusOK {
		t.Errorf("expected 200 OK for valid Bearer token, got %d", rrValid.Code)
	}

	// Invalid Bearer token
	reqBad := httptest.NewRequest("POST", "/api/vms/sync", nil)
	reqBad.Header.Set("Authorization", "Bearer wrong")
	rrBad := httptest.NewRecorder()
	handler.ServeHTTP(rrBad, reqBad)
	if rrBad.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 Unauthorized for invalid Bearer token, got %d", rrBad.Code)
	}
}
