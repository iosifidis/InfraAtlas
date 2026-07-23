package main

import (
	"embed"
	"flag"
	"io/fs"
	"log"
	"net/http"
	"os"
	"strings"
)

//go:embed static
var staticFS embed.FS

func main() {
	dbPath := flag.String("db", "./data/dashboard.db", "Path to SQLite database file")
	port := flag.String("port", "8080", "Port to listen on")
	flag.Parse()

	// Ensure the database directory exists
	if idx := strings.LastIndex(*dbPath, "/"); idx != -1 {
		dbDir := (*dbPath)[:idx]
		if err := os.MkdirAll(dbDir, 0755); err != nil {
			log.Fatalf("Failed to create database directory: %v", err)
		}
	}

	// Initialize SQLite Database
	log.Printf("Initializing database at: %s", *dbPath)
	if err := InitDB(*dbPath); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}

	// Get sub-filesystem for static files
	subFS, err := fs.Sub(staticFS, "static")
	if err != nil {
		log.Fatalf("Failed to sub-embed static folder: %v", err)
	}
	fileServer := http.FileServer(http.FS(subFS))

	// Main Multiplexer
	mux := http.NewServeMux()

	// Auth Public/Status Endpoints (handled separately to avoid blocking setup)
	mux.HandleFunc("GET /api/auth/status", handleAuthStatus)
	mux.HandleFunc("POST /api/auth/setup", handleAuthSetup)
	mux.HandleFunc("POST /api/auth/login", handleAuthLogin)
	mux.HandleFunc("POST /api/auth/logout", handleAuthLogout)

	// API Multiplexer (Requires authentication)
	apiMux := http.NewServeMux()
	apiMux.HandleFunc("GET /api/auth/profile", handleAuthProfile)
	apiMux.HandleFunc("POST /api/auth/profile", handleAuthProfile)
	apiMux.HandleFunc("PUT /api/auth/profile", handleAuthProfile)

	// Clusters API
	apiMux.HandleFunc("GET /api/clusters", handleClusters)
	apiMux.HandleFunc("POST /api/clusters", handleClusters)
	apiMux.HandleFunc("GET /api/clusters/{id}", handleClusterDetail)
	apiMux.HandleFunc("PUT /api/clusters/{id}", handleClusterDetail)
	apiMux.HandleFunc("DELETE /api/clusters/{id}", handleClusterDetail)

	// VMs API
	apiMux.HandleFunc("GET /api/vms", handleVMs)
	apiMux.HandleFunc("POST /api/vms", handleVMs)
	apiMux.HandleFunc("POST /api/vms/import", ImportVMsHandler)
	apiMux.HandleFunc("GET /api/vms/{id}", handleVMDetail)
	apiMux.HandleFunc("PUT /api/vms/{id}", handleVMDetail)
	apiMux.HandleFunc("DELETE /api/vms/{id}", handleVMDetail)

	// Stats, Settings and Export APIs
	apiMux.HandleFunc("GET /api/stats", handleStats)
	apiMux.HandleFunc("GET /api/settings", handleSettings)
	apiMux.HandleFunc("POST /api/settings", handleSettings)
	apiMux.HandleFunc("GET /api/export/csv", handleExportCSV)

	// DNS Records API
	apiMux.HandleFunc("GET /api/dns", handleDNSRecords)
	apiMux.HandleFunc("POST /api/dns", handleDNSRecords)
	apiMux.HandleFunc("POST /api/dns/import", handleDNSImport)
	apiMux.HandleFunc("GET /api/dns/{id}", handleDNSRecordDetail)
	apiMux.HandleFunc("PUT /api/dns/{id}", handleDNSRecordDetail)
	apiMux.HandleFunc("DELETE /api/dns/{id}", handleDNSRecordDetail)

	// Register API router under /api/ using Auth Middleware
	mux.Handle("/api/", AuthMiddleware(apiMux))

	// File Server for Embedded Static assets
	mux.Handle("/", fileServer)

	log.Printf("Starting InfraAtlas server on port %s", *port)
	if err := http.ListenAndServe(":"+*port, mux); err != nil {
		log.Fatalf("Server failed to start: %v", err)
	}
}
