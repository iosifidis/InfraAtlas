package app

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// VMSyncPayload represents data sent by Ansible (or external scripts) to update a VM.
type VMSyncPayload struct {
	Name      string       `json:"name"`
	IPv4      string       `json:"ipv4"`
	OS        string       `json:"os"`
	OSVersion string       `json:"os_version"`
	CPU       float64      `json:"cpu"`
	RAM       float64      `json:"ram"`
	Disk      float64      `json:"disk"`
	Software  []VMSoftware `json:"software"`
}

// handleVMSync updates an existing VM's OS, specs, and software versions by name or IPv4.
func handleVMSync(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	var payload VMSyncPayload
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	payload.Name = strings.TrimSpace(payload.Name)
	payload.IPv4 = strings.TrimSpace(payload.IPv4)
	if payload.Name == "" && payload.IPv4 == "" {
		respondWithError(w, http.StatusBadRequest, "VM name or ipv4 is required")
		return
	}

	vm, err := SyncVM(payload)
	if err != nil {
		if errors.Is(err, ErrVMNotFound) {
			respondWithError(w, http.StatusNotFound, "Matching VM not found")
			return
		}
		respondWithError(w, http.StatusInternalServerError, err.Error())
		return
	}
	respondWithJSON(w, http.StatusOK, vm)
}

// handleAnsibleInventory returns a dynamic Ansible inventory JSON for VMs.
func handleAnsibleInventory(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	includeAll := r.URL.Query().Get("all") == "1"
	var filter VMFilter
	if !includeAll {
		one := 1
		filter.Ansible = &one
	}

	vms, err := GetVMs(filter)
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, err.Error())
		return
	}

	hostVars := make(map[string]map[string]interface{})
	allHosts := make([]string, 0, len(vms))
	groups := make(map[string][]string)

	for _, v := range vms {
		hostKey := v.Name
		allHosts = append(allHosts, hostKey)

		vars := map[string]interface{}{
			"infraatlas_vm_id":   v.ID,
			"infraatlas_vm_name": v.Name,
			"infraatlas_cluster": v.ClusterName,
		}
		if v.IPv4 != "" {
			vars["ansible_host"] = v.IPv4
		}
		hostVars[hostKey] = vars

		groupName := sanitizeAnsibleGroup(v.ClusterName)
		groups[groupName] = append(groups[groupName], hostKey)
	}

	inventory := map[string]interface{}{
		"_meta": map[string]interface{}{
			"hostvars": hostVars,
		},
		"all": map[string]interface{}{
			"hosts": allHosts,
		},
	}
	for g, hosts := range groups {
		inventory[g] = map[string]interface{}{
			"hosts": hosts,
		}
	}

	respondWithJSON(w, http.StatusOK, inventory)
}

func sanitizeAnsibleGroup(name string) string {
	s := strings.ToLower(strings.TrimSpace(name))
	var b strings.Builder
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_' {
			b.WriteRune(r)
		} else {
			b.WriteRune('_')
		}
	}
	res := strings.Trim(b.String(), "_")
	if res == "" {
		return "cluster"
	}
	return res
}

// handleAnsibleStatus reports whether ansible-playbook is available on the server.
func handleAnsibleStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	path, err := exec.LookPath("ansible-playbook")
	playbookPath := findPlaybookPath()
	respondWithJSON(w, http.StatusOK, map[string]interface{}{
		"available":     err == nil && playbookPath != "",
		"binary_path":   path,
		"playbook_path": playbookPath,
	})
}

func findPlaybookPath() string {
	candidates := []string{
		"ansible/sync-infraatlas.yml",
		"/app/ansible/sync-infraatlas.yml",
	}
	for _, p := range candidates {
		if _, err := os.Stat(p); err == nil {
			abs, err := filepath.Abs(p)
			if err == nil {
				return abs
			}
			return p
		}
	}
	return ""
}

// handleAPITokenGenerate creates or returns the API token for Ansible / external automation.
func handleAPITokenGenerate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		respondWithError(w, http.StatusInternalServerError, "Failed to generate API token")
		return
	}
	token := "ia_" + hex.EncodeToString(b)
	if err := SaveSetting("api_token", token); err != nil {
		respondWithError(w, http.StatusInternalServerError, "Failed to save API token")
		return
	}
	respondWithJSON(w, http.StatusOK, map[string]string{
		"api_token": token,
	})
}

// handleAnsibleRun executes sync-infraatlas.yml for the selected VM IDs if ansible-playbook is installed.
func handleAnsibleRun(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	binPath, err := exec.LookPath("ansible-playbook")
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "Το ansible-playbook δεν είναι εγκατεστημένο σε αυτόν τον server. Χρησιμοποιήστε το playbook ansible/sync-infraatlas.yml από το control node σας με το API Token.")
		return
	}

	playbookPath := findPlaybookPath()
	if playbookPath == "" {
		respondWithError(w, http.StatusInternalServerError, "Δεν βρέθηκε το playbook ansible/sync-infraatlas.yml")
		return
	}

	var req struct {
		VMIDs []int64 `json:"vm_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.VMIDs) == 0 {
		respondWithError(w, http.StatusBadRequest, "Επιλέξτε τουλάχιστον ένα VM για συγχρονισμό.")
		return
	}

	settings, _ := GetSettings()
	apiToken := settings["api_token"]
	if apiToken == "" {
		b := make([]byte, 24)
		if _, err := rand.Read(b); err == nil {
			apiToken = "ia_" + hex.EncodeToString(b)
			_ = SaveSetting("api_token", apiToken)
		}
	}

	// Build temporary INI inventory for the selected VMs
	var invBuilder strings.Builder
	invBuilder.WriteString("[targets]\n")
	count := 0
	for _, id := range req.VMIDs {
		vm, err := GetVM(id)
		if err != nil {
			continue
		}
		targetHost := strings.TrimSpace(vm.IPv4)
		if targetHost == "" {
			targetHost = vm.Name
		}
		invBuilder.WriteString(fmt.Sprintf("%s ansible_host=%s infraatlas_vm_name=%s\n", vm.Name, targetHost, vm.Name))
		count++
	}
	if count == 0 {
		respondWithError(w, http.StatusNotFound, "Δεν βρέθηκαν έγκυρα VMs.")
		return
	}

	invFile, err := os.CreateTemp("", "infraatlas-inv-*.ini")
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "Failed to create temporary inventory")
		return
	}
	invPath := invFile.Name()
	_, _ = invFile.WriteString(invBuilder.String())
	_ = invFile.Close()
	defer os.Remove(invPath)

	localPort := currentPort
	if localPort == "" {
		localPort = "8080"
	}

	args := []string{"-i", invPath, playbookPath, "-e", fmt.Sprintf("infraatlas_url=http://127.0.0.1:%s", localPort), "-e", fmt.Sprintf("infraatlas_token=%s", apiToken)}
	if sshUser := strings.TrimSpace(settings["ansible_ssh_user"]); sshUser != "" {
		args = append(args, "-u", sshUser)
	}
	if sshKey := strings.TrimSpace(settings["ansible_ssh_key"]); sshKey != "" {
		args = append(args, "--private-key", sshKey)
	}

	ctx, cancel := context.WithTimeout(r.Context(), 120*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, binPath, args...)
	var outBuf bytes.Buffer
	cmd.Stdout = &outBuf
	cmd.Stderr = &outBuf
	cmd.Env = append(os.Environ(), "ANSIBLE_HOST_KEY_CHECKING=False")

	runErr := cmd.Run()
	output := outBuf.String()
	if runErr != nil {
		respondWithJSON(w, http.StatusOK, map[string]interface{}{
			"success": false,
			"message": "Η εκτέλεση του Ansible ολοκληρώθηκε με σφάλματα.",
			"output":  output,
		})
		return
	}

	respondWithJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": fmt.Sprintf("Ο συγχρονισμός %d VM(s) με Ansible ολοκληρώθηκε επιτυχώς!", count),
		"output":  output,
	})
}
