package app

import (
	"database/sql"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

func parseIntQueryParam(val string) *int {
	if val == "" {
		return nil
	}
	if n, err := strconv.Atoi(val); err == nil {
		return &n
	}
	return nil
}

func parseVMFilter(r *http.Request) VMFilter {
	q := r.URL.Query()
	var clusterID int64
	if cid := q.Get("cluster_id"); cid != "" {
		clusterID, _ = strconv.ParseInt(cid, 10, 64)
	}
	return VMFilter{
		ClusterID:   clusterID,
		InUse:       parseIntQueryParam(q.Get("in_use")),
		IsImportant: parseIntQueryParam(q.Get("is_important")),
		Monitored:   parseIntQueryParam(q.Get("monitored")),
		Ansible:     parseIntQueryParam(q.Get("ansible")),
		Docker:      parseIntQueryParam(q.Get("docker")),
		Search:      q.Get("search"),
	}
}

// handleVMs manages listing and creating Virtual Machines.
func handleVMs(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		vms, err := GetVMs(parseVMFilter(r))
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
			if errors.Is(err, sql.ErrNoRows) {
				respondWithError(w, http.StatusNotFound, "VM not found")
				return
			}
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
			if errors.Is(err, sql.ErrNoRows) {
				respondWithError(w, http.StatusNotFound, "VM not found")
				return
			}
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

	vms, err := GetVMs(parseVMFilter(r))
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
		"Ansible", "Docker", "CPU", "RAM", "Δίσκος", "Extra Δίσκος", "IPv4", "IPv6",
		"VPN", "Backup", "Monitored", "Αναβάθμιση OS", "Αναβάθμιση App", "OS", "OS Version", "Λογισμικό / Εκδόσεις", "Υπεύθυνος Επικοινωνίας", "Περιγραφή",
	}
	_ = cw.Write(headers)

	for _, v := range vms {
		var swParts []string
		for _, s := range v.Software {
			if s.Version != "" {
				swParts = append(swParts, fmt.Sprintf("%s %s", s.Name, s.Version))
			} else {
				swParts = append(swParts, s.Name)
			}
		}
		row := []string{
			v.Name,
			v.ClusterName,
			v.URL,
			boolToGreek(v.InUse),
			boolToGreek(v.IsImportant),
			boolToGreek(v.UsedByUs),
			boolToGreek(v.Ansible),
			boolToGreek(v.Docker),
			fmt.Sprintf("%.1f", v.CPU),
			fmt.Sprintf("%.1f", v.RAM),
			fmt.Sprintf("%.1f", v.Disk),
			fmt.Sprintf("%.1f", v.ExtraDisk),
			v.IPv4,
			v.IPv6,
			boolToGreek(v.VPN),
			v.Backup,
			boolToGreek(v.Monitored),
			boolToGreek(v.OSUpgrade),
			boolToGreek(v.AppUpgrade),
			v.OS,
			v.OSVersion,
			strings.Join(swParts, ", "),
			v.ContactPerson,
			v.Description,
		}
		_ = cw.Write(row)
	}
	cw.Flush()
}
