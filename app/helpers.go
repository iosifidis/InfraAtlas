package app

import (
	"encoding/json"
	"net/http"
)

// respondWithError returns a standardized JSON error response.
func respondWithError(w http.ResponseWriter, code int, message string) {
	respondWithJSON(w, code, map[string]string{"error": message})
}

// respondWithJSON returns a JSON payload with appropriate HTTP headers and status code.
func respondWithJSON(w http.ResponseWriter, code int, payload interface{}) {
	response, err := json.Marshal(payload)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error": "Failed to marshal JSON response"}`))
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")
	w.WriteHeader(code)
	_, _ = w.Write(response)
}

// boolToGreek converts integer boolean (1/0) to Greek string ("Ναι"/"Όχι").
func boolToGreek(val int) string {
	if val == 1 {
		return "Ναι"
	}
	return "Όχι"
}
