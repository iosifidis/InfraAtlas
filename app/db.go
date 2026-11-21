package app

import (
	"database/sql"
	"fmt"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

var (
	DB            *sql.DB
	currentDBPath string
)

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
	Ansible         int       `json:"ansible"`      // 0 or 1
	Docker          int       `json:"docker"`       // 0 or 1
	CPU             float64   `json:"cpu"`
	RAM             float64   `json:"ram"`
	Disk            float64   `json:"disk"`
	ExtraDisk       float64   `json:"extra_disk"`
	IPv4            string    `json:"ipv4"`
	IPv6            string    `json:"ipv6"`
	VPN             int       `json:"vpn"`         // 0 or 1
	Backup          string    `json:"backup"`
	Monitored       int       `json:"monitored"`   // 0 or 1
	OSUpgrade       int       `json:"os_upgrade"`  // 0 or 1
	AppUpgrade      int       `json:"app_upgrade"` // 0 or 1
	OS              string    `json:"os"`
	OSVersion       string    `json:"os_version"`
	ContactPerson   string       `json:"contact_person"`
	Description     string       `json:"description"`
	Software        []VMSoftware `json:"software"`
	CreatedAt       time.Time    `json:"created_at"`
	UpdatedAt       time.Time    `json:"updated_at"`
}

type VMSoftware struct {
	ID      int64  `json:"id"`
	VMID    int64  `json:"vm_id"`
	Name    string `json:"name"`
	Version string `json:"version"`
	Notes   string `json:"notes,omitempty"`
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
	currentDBPath = dbPath
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
	// Enable foreign keys, WAL mode, and busy timeout for concurrent safety
	_, _ = DB.Exec("PRAGMA foreign_keys = ON;")
	_, _ = DB.Exec("PRAGMA journal_mode = WAL;")
	_, _ = DB.Exec("PRAGMA busy_timeout = 5000;")

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
			ansible INTEGER DEFAULT 0,
			docker INTEGER DEFAULT 0,
			cpu REAL DEFAULT 0,
			ram REAL DEFAULT 0,
			disk REAL DEFAULT 0,
			extra_disk REAL DEFAULT 0,
			ipv4 TEXT,
			ipv6 TEXT,
			vpn INTEGER DEFAULT 0,
			backup TEXT,
			monitored INTEGER DEFAULT 0,
			os_upgrade INTEGER DEFAULT 0,
			app_upgrade INTEGER DEFAULT 0,
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
		`CREATE INDEX IF NOT EXISTS idx_vms_cluster_id ON vms(cluster_id);`,
		`CREATE INDEX IF NOT EXISTS idx_vms_in_use ON vms(in_use);`,
		`CREATE INDEX IF NOT EXISTS idx_vms_is_important ON vms(is_important);`,
		`CREATE INDEX IF NOT EXISTS idx_vms_ipv4 ON vms(ipv4);`,
		`CREATE TABLE IF NOT EXISTS vm_software (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			vm_id INTEGER NOT NULL,
			name TEXT NOT NULL,
			version TEXT NOT NULL DEFAULT '',
			notes TEXT DEFAULT '',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (vm_id) REFERENCES vms(id) ON DELETE CASCADE
		);`,
		`CREATE INDEX IF NOT EXISTS idx_vm_software_vm_id ON vm_software(vm_id);`,
	}

	for _, q := range schema {
		_, err := DB.Exec(q)
		if err != nil {
			return err
		}
	}

	// Auto-migrations for new columns on existing database files
	if err := ensureVMColumns(); err != nil {
		return err
	}

	return nil
}

func hasColumn(table, col string) (bool, error) {
	rows, err := DB.Query(fmt.Sprintf("PRAGMA table_info(%s);", table))
	if err != nil {
		return false, err
	}
	defer rows.Close()

	for rows.Next() {
		var cid int
		var name, ctype string
		var notnull int
		var dflt sql.NullString
		var pk int
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk); err != nil {
			return false, err
		}
		if strings.EqualFold(name, col) {
			return true, nil
		}
	}
	return false, rows.Err()
}

func getColumnType(table, col string) (string, error) {
	rows, err := DB.Query(fmt.Sprintf("PRAGMA table_info(%s);", table))
	if err != nil {
		return "", err
	}
	defer rows.Close()

	for rows.Next() {
		var cid int
		var name, ctype string
		var notnull int
		var dflt sql.NullString
		var pk int
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk); err != nil {
			return "", err
		}
		if strings.EqualFold(name, col) {
			return strings.ToUpper(ctype), nil
		}
	}
	return "", rows.Err()
}

func ensureVMColumns() error {
	for _, col := range []string{"os_upgrade", "app_upgrade", "ansible", "docker"} {
		exists, err := hasColumn("vms", col)
		if err != nil {
			return err
		}
		if !exists {
			if _, err := DB.Exec(fmt.Sprintf("ALTER TABLE vms ADD COLUMN %s INTEGER DEFAULT 0;", col)); err != nil {
				return err
			}
		}
	}

	// Migration: fix vpn column TEXT → INTEGER (SQLite RENAME COLUMN: v3.25+)
	vpnType, err := getColumnType("vms", "vpn")
	if err != nil {
		return err
	}
	if vpnType == "TEXT" {
		if _, err := DB.Exec(`ALTER TABLE vms RENAME COLUMN vpn TO vpn_legacy;`); err != nil {
			return err
		}
		if _, err := DB.Exec(`ALTER TABLE vms ADD COLUMN vpn INTEGER DEFAULT 0;`); err != nil {
			return err
		}
		if _, err := DB.Exec(`UPDATE vms SET vpn = 1
			WHERE LOWER(COALESCE(vpn_legacy,'')) IN ('1','true','yes','nai','ναι')
			   OR LOWER(COALESCE(vpn_legacy,'')) LIKE '%vpn%'
			   OR LOWER(COALESCE(vpn_legacy,'')) LIKE '%client%';`); err != nil {
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
	if err := rows.Err(); err != nil {
		return nil, err
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
	res, err := DB.Exec(query, c.Name, c.Description, c.ID)
	if err != nil {
		return err
	}
	if n, err := res.RowsAffected(); err == nil && n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func DeleteCluster(id int64) error {
	query := `DELETE FROM clusters WHERE id = ?`
	res, err := DB.Exec(query, id)
	if err != nil {
		return err
	}
	if n, err := res.RowsAffected(); err == nil && n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// --- VMs CRUD ---

// VMFilter specifies optional filters for querying VMs.
type VMFilter struct {
	ClusterID   int64
	InUse       *int
	IsImportant *int
	Monitored   *int
	Ansible     *int
	Docker      *int
	Search      string
}

const vmSelectColumns = `
		SELECT v.id, v.cluster_id, c.name as cluster_name, v.name, v.default_password, v.url, 
		       v.in_use, v.is_important, v.used_by_us, v.ansible, v.docker, v.cpu, v.ram, v.disk, v.extra_disk, 
		       v.ipv4, v.ipv6, v.vpn, v.backup, v.monitored, v.os_upgrade, v.app_upgrade, v.os, v.os_version, 
		       v.contact_person, v.description, v.created_at, v.updated_at
		FROM vms v
		JOIN clusters c ON v.cluster_id = c.id`

func scanVM(scanner interface{ Scan(...any) error }) (VM, error) {
	var v VM
	var pass, url, ipv4, ipv6, backup, os, osVer, contact, desc sql.NullString
	var vpn sql.NullInt64
	err := scanner.Scan(
		&v.ID, &v.ClusterID, &v.ClusterName, &v.Name, &pass, &url,
		&v.InUse, &v.IsImportant, &v.UsedByUs, &v.Ansible, &v.Docker, &v.CPU, &v.RAM, &v.Disk, &v.ExtraDisk,
		&ipv4, &ipv6, &vpn, &backup, &v.Monitored, &v.OSUpgrade, &v.AppUpgrade, &os, &osVer,
		&contact, &desc, &v.CreatedAt, &v.UpdatedAt,
	)
	if err != nil {
		return v, err
	}
	v.DefaultPassword = pass.String
	v.URL = url.String
	v.IPv4 = ipv4.String
	v.IPv6 = ipv6.String
	v.VPN = int(vpn.Int64)
	v.Backup = backup.String
	v.OS = os.String
	v.OSVersion = osVer.String
	v.ContactPerson = contact.String
	v.Description = desc.String
	return v, nil
}

func GetVMs(f VMFilter) ([]VM, error) {
	query := vmSelectColumns + "\n\t\tWHERE 1=1\n\t"
	var args []interface{}

	if f.ClusterID > 0 {
		query += " AND v.cluster_id = ?"
		args = append(args, f.ClusterID)
	}
	if f.InUse != nil {
		query += " AND v.in_use = ?"
		args = append(args, *f.InUse)
	}
	if f.IsImportant != nil {
		query += " AND v.is_important = ?"
		args = append(args, *f.IsImportant)
	}
	if f.Monitored != nil {
		query += " AND v.monitored = ?"
		args = append(args, *f.Monitored)
	}
	if f.Ansible != nil {
		query += " AND v.ansible = ?"
		args = append(args, *f.Ansible)
	}
	if f.Docker != nil {
		query += " AND v.docker = ?"
		args = append(args, *f.Docker)
	}
	if f.Search != "" {
		query += ` AND (v.name LIKE ? OR v.ipv4 LIKE ? OR v.ipv6 LIKE ? OR v.url LIKE ? OR v.os LIKE ? OR v.contact_person LIKE ? OR v.description LIKE ?
			OR EXISTS (SELECT 1 FROM vm_software s WHERE s.vm_id = v.id AND (s.name LIKE ? OR s.version LIKE ?)))`
		likePattern := "%" + f.Search + "%"
		args = append(args, likePattern, likePattern, likePattern, likePattern, likePattern, likePattern, likePattern, likePattern, likePattern)
	}

	query += " ORDER BY v.name ASC"

	rows, err := DB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var vms []VM
	for rows.Next() {
		v, err := scanVM(rows)
		if err != nil {
			return nil, err
		}
		v.Software = []VMSoftware{}
		vms = append(vms, v)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	if len(vms) > 0 {
		swMap, err := getAllVMSoftware()
		if err != nil {
			return nil, err
		}
		for i := range vms {
			if items, ok := swMap[vms[i].ID]; ok {
				vms[i].Software = items
			}
		}
	}
	return vms, nil
}

func getAllVMSoftware() (map[int64][]VMSoftware, error) {
	rows, err := DB.Query(`SELECT id, vm_id, name, version, notes FROM vm_software ORDER BY name ASC, id ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[int64][]VMSoftware)
	for rows.Next() {
		var s VMSoftware
		var notes sql.NullString
		if err := rows.Scan(&s.ID, &s.VMID, &s.Name, &s.Version, &notes); err != nil {
			return nil, err
		}
		s.Notes = notes.String
		result[s.VMID] = append(result[s.VMID], s)
	}
	return result, rows.Err()
}

func getVMSoftware(vmID int64) ([]VMSoftware, error) {
	rows, err := DB.Query(`SELECT id, vm_id, name, version, notes FROM vm_software WHERE vm_id = ? ORDER BY name ASC, id ASC`, vmID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []VMSoftware{}
	for rows.Next() {
		var s VMSoftware
		var notes sql.NullString
		if err := rows.Scan(&s.ID, &s.VMID, &s.Name, &s.Version, &notes); err != nil {
			return nil, err
		}
		s.Notes = notes.String
		items = append(items, s)
	}
	return items, rows.Err()
}

func GetVM(id int64) (VM, error) {
	v, err := scanVM(DB.QueryRow(vmSelectColumns+" WHERE v.id = ?", id))
	if err != nil {
		return v, err
	}
	sw, err := getVMSoftware(id)
	if err != nil {
		return v, err
	}
	v.Software = sw
	return v, nil
}

func replaceVMSoftwareTx(tx *sql.Tx, vmID int64, items []VMSoftware) error {
	if _, err := tx.Exec(`DELETE FROM vm_software WHERE vm_id = ?`, vmID); err != nil {
		return err
	}
	for _, s := range items {
		name := strings.TrimSpace(s.Name)
		if name == "" {
			continue
		}
		if _, err := tx.Exec(
			`INSERT INTO vm_software (vm_id, name, version, notes) VALUES (?, ?, ?, ?)`,
			vmID, name, strings.TrimSpace(s.Version), strings.TrimSpace(s.Notes),
		); err != nil {
			return err
		}
	}
	return nil
}

func CreateVM(v *VM) error {
	tx, err := DB.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	query := `
		INSERT INTO vms (
			cluster_id, name, default_password, url, in_use, is_important, used_by_us, ansible, docker,
			cpu, ram, disk, extra_disk, ipv4, ipv6, vpn, backup, monitored, os_upgrade, app_upgrade,
			os, os_version, contact_person, description, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
	`
	res, err := tx.Exec(query,
		v.ClusterID, v.Name, v.DefaultPassword, v.URL, v.InUse, v.IsImportant, v.UsedByUs, v.Ansible, v.Docker,
		v.CPU, v.RAM, v.Disk, v.ExtraDisk, v.IPv4, v.IPv6, v.VPN, v.Backup, v.Monitored, v.OSUpgrade, v.AppUpgrade,
		v.OS, v.OSVersion, v.ContactPerson, v.Description,
	)
	if err != nil {
		return err
	}
	v.ID, err = res.LastInsertId()
	if err != nil {
		return err
	}
	if err := replaceVMSoftwareTx(tx, v.ID, v.Software); err != nil {
		return err
	}
	return tx.Commit()
}

func UpdateVM(v *VM) error {
	tx, err := DB.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	query := `
		UPDATE vms SET 
			cluster_id = ?, name = ?, default_password = ?, url = ?, in_use = ?, is_important = ?, used_by_us = ?, ansible = ?, docker = ?,
			cpu = ?, ram = ?, disk = ?, extra_disk = ?, ipv4 = ?, ipv6 = ?, vpn = ?, backup = ?, monitored = ?, os_upgrade = ?, app_upgrade = ?, 
			os = ?, os_version = ?, contact_person = ?, description = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`
	res, err := tx.Exec(query,
		v.ClusterID, v.Name, v.DefaultPassword, v.URL, v.InUse, v.IsImportant, v.UsedByUs, v.Ansible, v.Docker,
		v.CPU, v.RAM, v.Disk, v.ExtraDisk, v.IPv4, v.IPv6, v.VPN, v.Backup, v.Monitored, v.OSUpgrade, v.AppUpgrade,
		v.OS, v.OSVersion, v.ContactPerson, v.Description, v.ID,
	)
	if err != nil {
		return err
	}
	if n, err := res.RowsAffected(); err == nil && n == 0 {
		return sql.ErrNoRows
	}
	if err := replaceVMSoftwareTx(tx, v.ID, v.Software); err != nil {
		return err
	}
	return tx.Commit()
}

func PatchVMUpgradeFlags(id int64, osUpgrade int, appUpgrade int) error {
	query := `UPDATE vms SET os_upgrade = ?, app_upgrade = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
	_, err := DB.Exec(query, osUpgrade, appUpgrade, id)
	return err
}

func DeleteVM(id int64) error {
	query := `DELETE FROM vms WHERE id = ?`
	res, err := DB.Exec(query, id)
	if err != nil {
		return err
	}
	if n, err := res.RowsAffected(); err == nil && n == 0 {
		return sql.ErrNoRows
	}
	return nil
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
	if err := rows.Err(); err != nil {
		return nil, err
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
	res, err := DB.Exec(
		`UPDATE dns_records SET name=?, type=?, value=?, ttl=?, description=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
		r.Name, r.Type, r.Value, r.TTL, r.Description, r.ID,
	)
	if err != nil {
		return err
	}
	if n, err := res.RowsAffected(); err == nil && n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func DeleteDNSRecord(id int64) error {
	res, err := DB.Exec(`DELETE FROM dns_records WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, err := res.RowsAffected(); err == nil && n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// BulkUpsertDNSRecords inserts or replaces records inside a transaction (used during zone file import).
// Records with the same (name, type) are updated; new ones are inserted.
func BulkUpsertDNSRecords(records []DNSRecord) (int, int, error) {
	tx, err := DB.Begin()
	if err != nil {
		return 0, 0, err
	}
	defer func() {
		_ = tx.Rollback()
	}()

	inserted, updated := 0, 0
	for _, r := range records {
		var existing int64
		qErr := tx.QueryRow(`SELECT id FROM dns_records WHERE name = ? AND type = ?`, r.Name, r.Type).Scan(&existing)
		if qErr == nil {
			// exists → update value & ttl
			if _, err := tx.Exec(`UPDATE dns_records SET value=?, ttl=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`, r.Value, r.TTL, existing); err != nil {
				return 0, 0, err
			}
			updated++
		} else {
			// new → insert
			if _, err := tx.Exec(`INSERT INTO dns_records (name, type, value, ttl, description, updated_at) VALUES (?, ?, ?, ?, '', CURRENT_TIMESTAMP)`, r.Name, r.Type, r.Value, r.TTL); err != nil {
				return 0, 0, err
			}
			inserted++
		}
	}

	if err := tx.Commit(); err != nil {
		return 0, 0, err
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
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return settings, nil
}

func SaveSetting(key, val string) error {
	_, err := DB.Exec("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", key, val)
	return err
}
