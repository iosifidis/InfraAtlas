package app

import (
	"encoding/json"
	"net/http"
)

// handleStats calculates dashboard metrics and cluster resource distribution.
func handleStats(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

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

	dnsRecords, _ := GetDNSRecords("", "")

	var totalCPU float64
	var totalRAM float64
	var totalDisk float64
	var totalExtraDisk float64
	var totalVMs int
	var inUseVMs int
	var importantVMs int
	var usedByUsVMs int
	var monitoredVMs int
	var ansibleVMs int
	var dockerVMs int
	var vpnVMs int
	var osUpgradeVMs int
	var appUpgradeVMs int

	clusterStats := make(map[int64]map[string]interface{})
	for _, c := range clusters {
		clusterStats[c.ID] = map[string]interface{}{
			"id":              c.ID,
			"name":            c.Name,
			"cpu":             0.0,
			"ram":             0.0,
			"disk":            0.0,
			"extra_disk":      0.0,
			"vm_count":        0,
			"in_use_count":    0,
			"important_count": 0,
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
		if v.UsedByUs == 1 {
			usedByUsVMs++
		}
		if v.Monitored == 1 {
			monitoredVMs++
		}
		if v.Ansible == 1 {
			ansibleVMs++
		}
		if v.Docker == 1 {
			dockerVMs++
		}
		if v.VPN == 1 {
			vpnVMs++
		}
		if v.OSUpgrade == 1 {
			osUpgradeVMs++
		}
		if v.AppUpgrade == 1 {
			appUpgradeVMs++
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
			if v.IsImportant == 1 {
				stat["important_count"] = stat["important_count"].(int) + 1
			}
		}
	}

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
		"used_by_us_vms":       usedByUsVMs,
		"monitored_vms":        monitoredVMs,
		"ansible_vms":          ansibleVMs,
		"docker_vms":           dockerVMs,
		"vpn_vms":              vpnVMs,
		"os_upgrade_vms":       osUpgradeVMs,
		"app_upgrade_vms":      appUpgradeVMs,
		"total_dns_records":    len(dnsRecords),
		"total_cpu":            totalCPU,
		"total_ram":            totalRAM,
		"total_disk":           totalDisk,
		"total_extra_disk":     totalExtraDisk,
		"cluster_distribution": clusterList,
	}

	respondWithJSON(w, http.StatusOK, statsPayload)
}

// handleSettings manages reading and saving application key-value configuration settings.
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
