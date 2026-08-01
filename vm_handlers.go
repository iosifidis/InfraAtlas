package main

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type parsedVMItem struct {
	vm          VM
	clusterName string
}

// handleVMs manages listing and creating Virtual Machines.
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

// handleVMDetail manages getting, updating, patching upgrade flags, and deleting a single VM.
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

	case http.MethodPatch:
		var patch struct {
			OSUpgrade  *int `json:"os_upgrade"`
			AppUpgrade *int `json:"app_upgrade"`
		}
		if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
			respondWithError(w, http.StatusBadRequest, "Invalid request body")
			return
		}
		current, err := GetVM(id)
		if err != nil {
			respondWithError(w, http.StatusNotFound, "VM not found")
			return
		}
		osUpgrade := current.OSUpgrade
		appUpgrade := current.AppUpgrade
		if patch.OSUpgrade != nil {
			osUpgrade = *patch.OSUpgrade
		}
		if patch.AppUpgrade != nil {
			appUpgrade = *patch.AppUpgrade
		}
		if err := PatchVMUpgradeFlags(id, osUpgrade, appUpgrade); err != nil {
			respondWithError(w, http.StatusInternalServerError, err.Error())
			return
		}
		current.OSUpgrade = osUpgrade
		current.AppUpgrade = appUpgrade
		respondWithJSON(w, http.StatusOK, current)

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

// handleExportCSV exports VMs filtered list as UTF-8 BOM CSV.
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

	if _, err := w.Write([]byte{0xEF, 0xBB, 0xBF}); err != nil {
		respondWithError(w, http.StatusInternalServerError, "Failed to write response")
		return
	}

	cw := csv.NewWriter(w)
	cw.Comma = ';'

	headers := []string{
		"Όνομα VM", "Cluster", "URL", "Σε Χρήση", "Σημαντικό", "Χρήση από Εμάς",
		"CPU", "RAM", "Δίσκος", "Extra Δίσκος", "IPv4", "IPv6",
		"VPN", "Backup", "Monitored", "OS", "OS Version", "Υπεύθυνος Επικοινωνίας", "Περιγραφή",
	}
	_ = cw.Write(headers)

	for _, v := range vms {
		row := []string{
			v.Name,
			v.ClusterName,
			v.URL,
			boolToGreek(v.InUse),
			boolToGreek(v.IsImportant),
			boolToGreek(v.UsedByUs),
			fmt.Sprintf("%.1f", v.CPU),
			fmt.Sprintf("%.1f", v.RAM),
			fmt.Sprintf("%.1f", v.Disk),
			fmt.Sprintf("%.1f", v.ExtraDisk),
			v.IPv4,
			v.IPv6,
			boolToGreek(v.VPN),
			v.Backup,
			boolToGreek(v.Monitored),
			v.OS,
			v.OSVersion,
			v.ContactPerson,
			v.Description,
		}
		_ = cw.Write(row)
	}
	cw.Flush()
}

// importVMsHandler processes uploaded CSV content and upserts VM records.
func importVMsHandler(w http.ResponseWriter, r *http.Request) {
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

// parseVMCSV parses raw CSV string data into parsedVMItem structs.
func parseVMCSV(content string) ([]parsedVMItem, error) {
	r := csv.NewReader(strings.NewReader(content))
	r.FieldsPerRecord = -1
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

		if i == 0 && len(record) > 0 && strings.ToUpper(strings.TrimSpace(record[0])) == "ONOMA" {
			continue
		}

		name := strings.TrimSpace(record[0])
		if name == "" {
			continue
		}

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
			val := strings.ToUpper(strings.TrimSpace(record[11]))
			if val != "" && !strings.Contains(val, "OXI") && !strings.Contains(val, "ΟΧΙ") && val != "0" {
				vm.VPN = 1
			} else {
				vm.VPN = 0
			}
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
