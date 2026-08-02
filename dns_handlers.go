package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
)

// handleDNSRecords manages listing and creating DNS records.
func handleDNSRecords(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		q := r.URL.Query()
		search := strings.TrimSpace(q.Get("search"))
		recType := strings.TrimSpace(q.Get("type"))

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

// handleDNSRecordDetail manages getting, updating, and deleting a single DNS record.
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

// handleDNSImport handles BIND zone file upload and bulk upsert.
func handleDNSImport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	var content string

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
