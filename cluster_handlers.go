package main

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
)

// handleClusters manages listing and creating Clusters.
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

// handleClusterDetail manages getting, updating, and deleting a single Cluster.
func handleClusterDetail(w http.ResponseWriter, r *http.Request) {
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
