package main

import (
	"crypto/tls"
	"net/http"
	"net/http/httptest"
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
