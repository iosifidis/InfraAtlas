package app

import (
	"database/sql"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

// handleBackupDownload creates a consistent SQLite snapshot via VACUUM INTO and streams it to the client.
func handleBackupDownload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	if currentDBPath == "" || currentDBPath == ":memory:" {
		respondWithError(w, http.StatusBadRequest, "Backup is not supported for in-memory databases")
		return
	}

	tmpFile, err := os.CreateTemp("", "infraatlas-backup-*.db")
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "Failed to create temporary backup file")
		return
	}
	tmpPath := tmpFile.Name()
	_ = tmpFile.Close()
	_ = os.Remove(tmpPath) // VACUUM INTO requires the destination file not to exist yet
	defer os.Remove(tmpPath)

	escapedPath := strings.ReplaceAll(tmpPath, "'", "''")
	if _, err := DB.Exec(fmt.Sprintf("VACUUM INTO '%s';", escapedPath)); err != nil {
		respondWithError(w, http.StatusInternalServerError, "Failed to create database snapshot: "+err.Error())
		return
	}

	f, err := os.Open(tmpPath)
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "Failed to read backup file")
		return
	}
	defer f.Close()

	filename := fmt.Sprintf("infraatlas-backup-%s.db", time.Now().Format("2006-01-02"))
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%s", filename))
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	_, _ = io.Copy(w, f)
}

// handleBackupRestore validates an uploaded SQLite database file and replaces the active database.
func handleBackupRestore(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	if currentDBPath == "" || currentDBPath == ":memory:" {
		respondWithError(w, http.StatusBadRequest, "Restore is not supported for in-memory databases")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 50<<20) // 50 MB limit
	file, _, err := r.FormFile("backup")
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "Παρακαλώ επιλέξτε έγκυρο αρχείο backup (.db)")
		return
	}
	defer file.Close()

	tmpFile, err := os.CreateTemp("", "infraatlas-restore-*.db")
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "Failed to create temporary file")
		return
	}
	tmpPath := tmpFile.Name()
	defer os.Remove(tmpPath)

	if _, err := io.Copy(tmpFile, file); err != nil {
		_ = tmpFile.Close()
		respondWithError(w, http.StatusInternalServerError, "Failed to save uploaded backup")
		return
	}
	_ = tmpFile.Close()

	if err := validateSQLiteBackup(tmpPath); err != nil {
		respondWithError(w, http.StatusBadRequest, "Μη έγκυρο αρχείο SQLite backup: "+err.Error())
		return
	}

	// Close current DB before replacing the file on disk
	if DB != nil {
		_ = DB.Close()
	}
	_ = os.Remove(currentDBPath + "-wal")
	_ = os.Remove(currentDBPath + "-shm")

	if err := copyFile(tmpPath, currentDBPath); err != nil {
		_ = InitDB(currentDBPath)
		respondWithError(w, http.StatusInternalServerError, "Failed to replace database file: "+err.Error())
		return
	}

	if err := InitDB(currentDBPath); err != nil {
		respondWithError(w, http.StatusInternalServerError, "Failed to re-open restored database: "+err.Error())
		return
	}

	hasUsers, _ := HasUsers()
	setupCompleted.Store(hasUsers)

	respondWithJSON(w, http.StatusOK, map[string]string{
		"message": "Η επαναφορά της βάσης δεδομένων ολοκληρώθηκε με επιτυχία!",
	})
}

func validateSQLiteBackup(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	header := make([]byte, 16)
	_, err = io.ReadFull(f, header)
	_ = f.Close()
	if err != nil || string(header) != "SQLite format 3\x00" {
		return fmt.Errorf("δεν είναι έγκυρο αρχείο SQLite")
	}

	testDB, err := sql.Open("sqlite", path)
	if err != nil {
		return err
	}
	defer testDB.Close()

	var integrity string
	if err := testDB.QueryRow("PRAGMA integrity_check;").Scan(&integrity); err != nil || integrity != "ok" {
		return fmt.Errorf("απέτυχε ο έλεγχος ακεραιότητας")
	}

	var tableName string
	if err := testDB.QueryRow("SELECT name FROM sqlite_master WHERE type='table' AND name='vms'").Scan(&tableName); err != nil {
		return fmt.Errorf("λείπουν οι βασικοί πίνακες του InfraAtlas")
	}
	return nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
	if err != nil {
		return err
	}
	defer out.Close()

	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	return out.Sync()
}
