package main

import (
	"database/sql"
	"fmt"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

var DB *sql.DB

// Models
type Cluster struct {
	ID          int64     `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
	VMCount     int       `json:"vm_count"`
}

type VM struct {
	ID              int64     `json:"id"`
	ClusterID       int64     `json:"cluster_id"`
	ClusterName     string    `json:"cluster_name,omitempty"`
	Name            string    `json:"name"`
	DefaultPassword string    `json:"default_password"`
	URL             string    `json:"url"`
	InUse           int       `json:"in_use"`       // 0 or 1
	IsImportant     int       `json:"is_important"` // 0 or 1
	UsedByUs        int       `json:"used_by_us"`   // 0 or 1
	CPU             float64   `json:"cpu"`
	RAM             float64   `json:"ram"`
	Disk            float64   `json:"disk"`
	ExtraDisk       float64   `json:"extra_disk"`
	IPv4            string    `json:"ipv4"`
	IPv6            string    `json:"ipv6"`
	VPN             string    `json:"vpn"`
	Backup          string    `json:"backup"`
	Monitored       int       `json:"monitored"` // 0 or 1
	OS              string    `json:"os"`
	OSVersion       string    `json:"os_version"`
	ContactPerson   string    `json:"contact_person"`
	Description     string    `json:"description"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

type User struct {
	ID           int64     `json:"id"`
	Username     string    `json:"username"`
	PasswordHash string    `json:"-"`
	CreatedAt    time.Time `json:"created_at"`
}

type DNSRecord struct {
	ID          int64     `json:"id"`
	Name        string    `json:"name"`        // hostname / domain (e.g. web.ellak.gr.)
	Type        string    `json:"type"`        // A or CNAME
	Value       string    `json:"value"`       // IP for A, target for CNAME
	TTL         int       `json:"ttl"`
	Description string    `json:"description"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// InitDB opens the database and runs migrations
func InitDB(dbPath string) error {
	var err error
	DB, err = sql.Open("sqlite", dbPath)
	if err != nil {
		return fmt.Errorf("failed to open database: %w", err)
	}

	// Set connection limits
	DB.SetMaxOpenConns(1)

	if err = DB.Ping(); err != nil {
		return fmt.Errorf("failed to ping database: %w", err)
	}

	if err = migrate(); err != nil {
		return fmt.Errorf("failed migrations: %w", err)
	}

	return nil
}

func migrate() error {
	// Enable foreign keys
	_, err := DB.Exec("PRAGMA foreign_keys = ON;")
	if err != nil {
		return err
	}

	schema := []string{
		`CREATE TABLE IF NOT EXISTS clusters (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL UNIQUE,
			description TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);`,
		`CREATE TABLE IF NOT EXISTS vms (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			cluster_id INTEGER NOT NULL,
			name TEXT NOT NULL,
			default_password TEXT,
			url TEXT,
			in_use INTEGER DEFAULT 1,
			is_important INTEGER DEFAULT 0,
			used_by_us INTEGER DEFAULT 1,
			cpu REAL DEFAULT 0,
			ram REAL DEFAULT 0,
			disk REAL DEFAULT 0,
			extra_disk REAL DEFAULT 0,
			ipv4 TEXT,
			ipv6 TEXT,
			vpn TEXT,
			backup TEXT,
			monitored INTEGER DEFAULT 0,
			os TEXT,
			os_version TEXT,
			contact_person TEXT,
			description TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (cluster_id) REFERENCES clusters(id) ON DELETE CASCADE
		);`,
		`CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT NOT NULL UNIQUE,
			password_hash TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);`,
		`CREATE TABLE IF NOT EXISTS settings (
			key TEXT PRIMARY KEY,
			value TEXT
		);`,
		`CREATE TABLE IF NOT EXISTS dns_records (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			type TEXT NOT NULL CHECK(type IN ('A','CNAME')),
			value TEXT NOT NULL,
			ttl INTEGER DEFAULT 86400,
			description TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_dns_name_type ON dns_records(name, type);`,
	}

	for _, q := range schema {
		_, err := DB.Exec(q)
		if err != nil {
			return err
		}
	}

	return nil
}

// --- Clusters CRUD ---

func GetClusters() ([]Cluster, error) {
	query := `
		SELECT c.id, c.name, c.description, c.created_at, c.updated_at, COUNT(v.id) as vm_count
		FROM clusters c
		LEFT JOIN vms v ON c.id = v.cluster_id
		GROUP BY c.id
		ORDER BY c.name ASC
	`
	rows, err := DB.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var clusters []Cluster
	for rows.Next() {
		var c Cluster
		var desc sql.NullString
		err := rows.Scan(&c.ID, &c.Name, &desc, &c.CreatedAt, &c.UpdatedAt, &c.VMCount)
		if err != nil {
			return nil, err
		}
		c.Description = desc.String
		clusters = append(clusters, c)
	}
	return clusters, nil
}

func GetCluster(id int64) (Cluster, error) {
	var c Cluster
	var desc sql.NullString
	query := `
		SELECT c.id, c.name, c.description, c.created_at, c.updated_at, COUNT(v.id) as vm_count
		FROM clusters c
		LEFT JOIN vms v ON c.id = v.cluster_id
		WHERE c.id = ?
		GROUP BY c.id
	`
	err := DB.QueryRow(query, id).Scan(&c.ID, &c.Name, &desc, &c.CreatedAt, &c.UpdatedAt, &c.VMCount)
	if err != nil {
		return c, err
	}
	c.Description = desc.String
	return c, nil
}

func CreateCluster(c *Cluster) error {
	query := `INSERT INTO clusters (name, description, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)`
	res, err := DB.Exec(query, c.Name, c.Description)
	if err != nil {
		return err
	}
	c.ID, err = res.LastInsertId()
	return err
}

func UpdateCluster(c *Cluster) error {
	query := `UPDATE clusters SET name = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
	_, err := DB.Exec(query, c.Name, c.Description, c.ID)
	return err
}

func DeleteCluster(id int64) error {
	query := `DELETE FROM clusters WHERE id = ?`
	_, err := DB.Exec(query, id)
	return err
}

func GetOrCreateClusterByName(name string) (int64, error) {
	name = fmt.Sprintf("%v", name)
	name = fmt.Sprintf("%s", name)
	if name == "" {
		name = "General Cluster"
	}
	var id int64
	err := DB.QueryRow("SELECT id FROM clusters WHERE LOWER(name) = LOWER(?)", name).Scan(&id)
	if err == nil {
		return id, nil
	}
	c := &Cluster{
		Name:        name,
		Description: "Αυτόματα δημιουργημένο σύμπλεγμα από εισαγωγή CSV",
	}
	err = CreateCluster(c)
	if err != nil {
		return 0, err
	}
	return c.ID, nil
}

// --- VMs CRUD ---

func GetVMs(clusterID int64, inUse *int, isImportant *int, monitored *int, search string) ([]VM, error) {
	query := `
		SELECT v.id, v.cluster_id, c.name as cluster_name, v.name, v.default_password, v.url, 
		       v.in_use, v.is_important, v.used_by_us, v.cpu, v.ram, v.disk, v.extra_disk, 
		       v.ipv4, v.ipv6, v.vpn, v.backup, v.monitored, v.os, v.os_version, 
		       v.contact_person, v.description, v.created_at, v.updated_at
		FROM vms v
		JOIN clusters c ON v.cluster_id = c.id
		WHERE 1=1
	`
	var args []interface{}

	if clusterID > 0 {
		query += " AND v.cluster_id = ?"
		args = append(args, clusterID)
	}
	if inUse != nil {
		query += " AND v.in_use = ?"
		args = append(args, *inUse)
	}
	if isImportant != nil {
		query += " AND v.is_important = ?"
		args = append(args, *isImportant)
	}
	if monitored != nil {
		query += " AND v.monitored = ?"
		args = append(args, *monitored)
	}
	if search != "" {
		query += " AND (v.name LIKE ? OR v.ipv4 LIKE ? OR v.ipv6 LIKE ? OR v.url LIKE ? OR v.os LIKE ? OR v.contact_person LIKE ? OR v.description LIKE ?)"
		likePattern := "%" + search + "%"
		args = append(args, likePattern, likePattern, likePattern, likePattern, likePattern, likePattern, likePattern)
	}

	query += " ORDER BY v.name ASC"

	rows, err := DB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var vms []VM
	for rows.Next() {
		var v VM
		var pass, url, ipv4, ipv6, vpn, backup, os, osVer, contact, desc sql.NullString
		err := rows.Scan(
			&v.ID, &v.ClusterID, &v.ClusterName, &v.Name, &pass, &url,
			&v.InUse, &v.IsImportant, &v.UsedByUs, &v.CPU, &v.RAM, &v.Disk, &v.ExtraDisk,
			&ipv4, &ipv6, &vpn, &backup, &v.Monitored, &os, &osVer,
			&contact, &desc, &v.CreatedAt, &v.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}
		v.DefaultPassword = pass.String
		v.URL = url.String
		v.IPv4 = ipv4.String
		v.IPv6 = ipv6.String
		v.VPN = vpn.String
		v.Backup = backup.String
		v.OS = os.String
		v.OSVersion = osVer.String
		v.ContactPerson = contact.String
		v.Description = desc.String
		vms = append(vms, v)
	}
	return vms, nil
}

func GetVM(id int64) (VM, error) {
	var v VM
	var pass, url, ipv4, ipv6, vpn, backup, os, osVer, contact, desc sql.NullString
	query := `
		SELECT v.id, v.cluster_id, c.name as cluster_name, v.name, v.default_password, v.url, 
		       v.in_use, v.is_important, v.used_by_us, v.cpu, v.ram, v.disk, v.extra_disk, 
		       v.ipv4, v.ipv6, v.vpn, v.backup, v.monitored, v.os, v.os_version, 
		       v.contact_person, v.description, v.created_at, v.updated_at
		FROM vms v
		JOIN clusters c ON v.cluster_id = c.id
		WHERE v.id = ?
	`
	err := DB.QueryRow(query, id).Scan(
		&v.ID, &v.ClusterID, &v.ClusterName, &v.Name, &pass, &url,
		&v.InUse, &v.IsImportant, &v.UsedByUs, &v.CPU, &v.RAM, &v.Disk, &v.ExtraDisk,
		&ipv4, &ipv6, &vpn, &backup, &v.Monitored, &os, &v.OSVersion,
		&contact, &desc, &v.CreatedAt, &v.UpdatedAt,
	)
	if err != nil {
		return v, err
	}
	v.DefaultPassword = pass.String
	v.URL = url.String
	v.IPv4 = ipv4.String
	v.IPv6 = ipv6.String
	v.VPN = vpn.String
	v.Backup = backup.String
	v.OS = os.String
	v.OSVersion = osVer.String
	v.ContactPerson = contact.String
	v.Description = desc.String
	return v, nil
}

func CreateVM(v *VM) error {
	query := `
		INSERT INTO vms (
			cluster_id, name, default_password, url, in_use, is_important, used_by_us,
			cpu, ram, disk, extra_disk, ipv4, ipv6, vpn, backup, monitored, 
			os, os_version, contact_person, description, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
	`
	res, err := DB.Exec(query,
		v.ClusterID, v.Name, v.DefaultPassword, v.URL, v.InUse, v.IsImportant, v.UsedByUs,
		v.CPU, v.RAM, v.Disk, v.ExtraDisk, v.IPv4, v.IPv6, v.VPN, v.Backup, v.Monitored,
		v.OS, v.OSVersion, v.ContactPerson, v.Description,
	)
	if err != nil {
		return err
	}
	v.ID, err = res.LastInsertId()
	return err
}

func UpdateVM(v *VM) error {
	query := `
		UPDATE vms SET 
			cluster_id = ?, name = ?, default_password = ?, url = ?, in_use = ?, is_important = ?, used_by_us = ?,
			cpu = ?, ram = ?, disk = ?, extra_disk = ?, ipv4 = ?, ipv6 = ?, vpn = ?, backup = ?, monitored = ?, 
			os = ?, os_version = ?, contact_person = ?, description = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`
	_, err := DB.Exec(query,
		v.ClusterID, v.Name, v.DefaultPassword, v.URL, v.InUse, v.IsImportant, v.UsedByUs,
		v.CPU, v.RAM, v.Disk, v.ExtraDisk, v.IPv4, v.IPv6, v.VPN, v.Backup, v.Monitored,
		v.OS, v.OSVersion, v.ContactPerson, v.Description, v.ID,
	)
	return err
}

func UpsertVMByName(v *VM) (created bool, err error) {
	var existingID int64
	err = DB.QueryRow("SELECT id FROM vms WHERE cluster_id = ? AND LOWER(name) = LOWER(?)", v.ClusterID, strings.ToLower(v.Name)).Scan(&existingID)
	if err == nil {
		v.ID = existingID
		err = UpdateVM(v)
		return false, err
	}

	err = DB.QueryRow("SELECT id FROM vms WHERE LOWER(name) = LOWER(?)", strings.ToLower(v.Name)).Scan(&existingID)
	if err == nil {
		v.ID = existingID
		err = UpdateVM(v)
		return false, err
	}

	err = CreateVM(v)
	return true, err
}

func DeleteVM(id int64) error {
	query := `DELETE FROM vms WHERE id = ?`
	_, err := DB.Exec(query, id)
	return err
}

// --- DNS Records CRUD ---

func GetDNSRecords(search, recType string) ([]DNSRecord, error) {
	query := `SELECT id, name, type, value, ttl, description, created_at, updated_at FROM dns_records WHERE 1=1`
	var args []interface{}

	if recType != "" {
		query += " AND type = ?"
		args = append(args, recType)
	}
	if search != "" {
		query += " AND (name LIKE ? OR value LIKE ? OR description LIKE ?)"
		p := "%" + search + "%"
		args = append(args, p, p, p)
	}
	query += " ORDER BY name ASC"

	rows, err := DB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var records []DNSRecord
	for rows.Next() {
		var r DNSRecord
		var desc sql.NullString
		if err := rows.Scan(&r.ID, &r.Name, &r.Type, &r.Value, &r.TTL, &desc, &r.CreatedAt, &r.UpdatedAt); err != nil {
			return nil, err
		}
		r.Description = desc.String
		records = append(records, r)
	}
	return records, nil
}

func GetDNSRecord(id int64) (DNSRecord, error) {
	var r DNSRecord
	var desc sql.NullString
	err := DB.QueryRow(`SELECT id, name, type, value, ttl, description, created_at, updated_at FROM dns_records WHERE id = ?`, id).
		Scan(&r.ID, &r.Name, &r.Type, &r.Value, &r.TTL, &desc, &r.CreatedAt, &r.UpdatedAt)
	if err != nil {
		return r, err
	}
	r.Description = desc.String
	return r, nil
}

func CreateDNSRecord(r *DNSRecord) error {
	res, err := DB.Exec(
		`INSERT INTO dns_records (name, type, value, ttl, description, updated_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
		r.Name, r.Type, r.Value, r.TTL, r.Description,
	)
	if err != nil {
		return err
	}
	r.ID, err = res.LastInsertId()
	return err
}

func UpdateDNSRecord(r *DNSRecord) error {
	_, err := DB.Exec(
		`UPDATE dns_records SET name=?, type=?, value=?, ttl=?, description=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
		r.Name, r.Type, r.Value, r.TTL, r.Description, r.ID,
	)
	return err
}

func DeleteDNSRecord(id int64) error {
	_, err := DB.Exec(`DELETE FROM dns_records WHERE id = ?`, id)
	return err
}

// BulkUpsertDNSRecords inserts or replaces records (used during zone file import).
// Records with the same (name, type) are updated; new ones are inserted.
func BulkUpsertDNSRecords(records []DNSRecord) (int, int, error) {
	inserted, updated := 0, 0
	for _, r := range records {
		var existing int64
		qErr := DB.QueryRow(`SELECT id FROM dns_records WHERE name = ? AND type = ?`, r.Name, r.Type).Scan(&existing)
		if qErr == nil {
			// exists → update value & ttl
			_, err := DB.Exec(`UPDATE dns_records SET value=?, ttl=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`, r.Value, r.TTL, existing)
			if err != nil {
				return inserted, updated, err
			}
			updated++
		} else {
			// new → insert
			_, err := DB.Exec(`INSERT INTO dns_records (name, type, value, ttl, description, updated_at) VALUES (?, ?, ?, ?, '', CURRENT_TIMESTAMP)`, r.Name, r.Type, r.Value, r.TTL)
			if err != nil {
				return inserted, updated, err
			}
			inserted++
		}
	}
	return inserted, updated, nil
}

// --- Users (Auth) ---

func HasUsers() (bool, error) {
	var count int
	err := DB.QueryRow("SELECT COUNT(*) FROM users").Scan(&count)
	return count > 0, err
}

func GetUserByUsername(username string) (User, error) {
	var u User
	err := DB.QueryRow("SELECT id, username, password_hash, created_at FROM users WHERE username = ?", username).Scan(
		&u.ID, &u.Username, &u.PasswordHash, &u.CreatedAt,
	)
	return u, err
}

func CreateUser(username, passwordHash string) error {
	_, err := DB.Exec("INSERT INTO users (username, password_hash) VALUES (?, ?)", username, passwordHash)
	return err
}

func UpdateUserProfile(id int64, newUsername, newPasswordHash string) error {
	if newPasswordHash != "" {
		_, err := DB.Exec("UPDATE users SET username = ?, password_hash = ? WHERE id = ?", newUsername, newPasswordHash, id)
		return err
	}
	_, err := DB.Exec("UPDATE users SET username = ? WHERE id = ?", newUsername, id)
	return err
}

// --- Settings ---

func GetSettings() (map[string]string, error) {
	rows, err := DB.Query("SELECT key, value FROM settings")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	settings := make(map[string]string)
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return nil, err
		}
		settings[k] = v
	}
	return settings, nil
}

func SaveSetting(key, val string) error {
	_, err := DB.Exec("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", key, val)
	return err
}
