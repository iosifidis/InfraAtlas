package app

import (
	"bytes"
	"crypto/tls"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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

func TestParseBoolInt(t *testing.T) {
	tests := []struct {
		input    string
		expected int
	}{
		{"1", 1},
		{"true", 1},
		{"TRUE", 1},
		{"yes", 1},
		{"YES", 1},
		{"nai", 1},
		{"ναι", 1},
		{"Client Configured", 1},
		{"VPN active", 1},
		{"0", 0},
		{"false", 0},
		{"no", 0},
		{"oxi", 0},
		{"", 0},
	}

	for _, tt := range tests {
		result := parseBoolInt(tt.input)
		if result != tt.expected {
			t.Errorf("parseBoolInt(%q) = %d; want %d", tt.input, result, tt.expected)
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

func TestParseVMCSV(t *testing.T) {
	csvData := `ONOMA,URL,SE XRISI,IMPORTANCE,EMPTY,CPU,RAM,DISK,EXTRA DISK,IPV4,IPV6,VPN,BACKUP,MONITOR,OS,OS VER,EMPTY2,CLUSTER,CONTACT,DESC
Thiseas
vm1.example.com,https://vm1.com,ΝΑΙ,HIGH,,4,8,100,50+25,192.168.1.5,fe80::1,YES,Daily,OXI,Ubuntu,22.04,,Thiseas Cluster,John Doe,Main VM
vm2.example.com,https://vm2.com,OXI,LOW,,2,4,50,0,192.168.1.6,,OXI,None,OXI,Debian,12,,General Cluster,Jane Doe,Backup VM
`
	items, err := parseVMCSV(csvData)
	if err != nil {
		t.Fatalf("parseVMCSV returned unexpected error: %v", err)
	}

	if len(items) != 2 {
		t.Fatalf("expected 2 parsed VM items, got %d", len(items))
	}

	// VM 1
	item1 := items[0]
	if item1.vm.Name != "vm1.example.com" {
		t.Errorf("expected VM name 'vm1.example.com', got %q", item1.vm.Name)
	}
	if item1.clusterName != "Thiseas Cluster" {
		t.Errorf("expected cluster name 'Thiseas Cluster', got %q", item1.clusterName)
	}
	if item1.vm.InUse != 1 {
		t.Errorf("expected InUse=1, got %d", item1.vm.InUse)
	}
	if item1.vm.IsImportant != 1 {
		t.Errorf("expected IsImportant=1, got %d", item1.vm.IsImportant)
	}
	if item1.vm.CPU != 4 || item1.vm.RAM != 8 || item1.vm.Disk != 100 {
		t.Errorf("unexpected specs for VM1: CPU=%.1f, RAM=%.1f, Disk=%.1f", item1.vm.CPU, item1.vm.RAM, item1.vm.Disk)
	}
	if item1.vm.ExtraDisk != 75 { // 50+25
		t.Errorf("expected ExtraDisk=75 (50+25), got %.1f", item1.vm.ExtraDisk)
	}
	if item1.vm.VPN != 1 {
		t.Errorf("expected VPN=1, got %d", item1.vm.VPN)
	}

	// VM 2
	item2 := items[1]
	if item2.vm.Name != "vm2.example.com" {
		t.Errorf("expected VM name 'vm2.example.com', got %q", item2.vm.Name)
	}
	if item2.vm.InUse != 0 {
		t.Errorf("expected InUse=0, got %d", item2.vm.InUse)
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
