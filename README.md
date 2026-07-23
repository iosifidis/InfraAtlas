# InfraAtlas

**InfraAtlas** είναι μια σύγχρονη, ελαφριά και αυτόνομη εφαρμογή (Single Page Application - SPA) για την καταγραφή, διαχείριση και παρακολούθηση Υποδομών (Clusters), Εικονικών Μηχανών (Virtual Machines) και Εγγραφών DNS (A & CNAME). 

Αναπτύχθηκε σε **Go** για μέγιστη απόδοση και χαμηλή κατανάλωση πόρων, σε συνδυασμό με ένα **Glassmorphic Dark UI** σχεδιασμένο σε Vanilla CSS και JavaScript.

---

## 🚀 Χαρακτηριστικά (Features)

### 1. 📦 Διαχείριση Clusters & Πόρων
- Καταγραφή και παρακολούθηση συμπλεγμάτων (Clusters).
- Αυτόματος υπολογισμός συνολικών πόρων: **CPU**, **RAM (GB)**, **Storage (GB)**, **Extra Storage (GB)**.
- Οπτικοποίηση κατανομής VM και κατάστασης χρήσης.

### 2. 🖥️ Πλήρης Καταγραφή Εικονικών Μηχανών (VMs)
- Λεπτομερής παρακολούθηση πεδίων:
  - Όνομα, URL, Κατάσταση Χρήσης (`In Use`), Σημαντικότητα (`Is Important`).
  - Πόροι: CPU Cores, RAM, Κύριος Δίσκος, Extra Δίσκος.
  - Δίκτυο: IPv4 Address, IPv6 Address, VPN Access.
  - Operational: Backup Status, Monitoring (`Monitored`), Λειτουργικό Σύστημα (`OS & OS Version`).
  - Διοικητικά: Υπεύθυνος Επικοινωνίας (Contact Person), Περιγραφή / Σημειώσεις.
- Φιλτράρισμα & Αναζήτηση σε πραγματικό χρόνο (ανά όνομα, IP, URL, OS, υπεύθυνο).

### 3. 📄 Μαζική Εισαγωγή VMs από CSV (Bulk Import)
- Εισαγωγή αρχείων CSV (π.χ. `ΕΕΛΛΑΚ-systems.ods.csv`) με αυτόματη αναγνώριση ενοτήτων/headers για ανάθεση σε Clusters.
- **Smart Parsing & Upsert**: Δημιουργεί αυτόματα νέα Clusters αν δεν υπάρχουν και ενημερώνει/εισάγει VMs χωρίς διπλότυπες εγγραφές.

### 4. 🌐 Διαχείριση Εγγραφών DNS (A & CNAME)
- Πλήρης καταγραφή εγγραφών DNS (Domain, Τύπος εγγραφής A/CNAME, Τιμή/IP).
- **Zone File Import**: Αυτόματη αναγνώριση και εισαγωγή εγγραφών απευθείας από BIND zonefiles.
- Ταξινόμηση στηλών (Sorting) κατά αύξουσα/φθίνουσα σειρά με ένα κλικ.

### 5. 📊 Αναφορές & Εξαγωγή Δεδομένων (Reports & Export)
- Δημιουργία προσαρμοσμένων αναφορών με φίλτρα.
- Εξαγωγή δεδομένων σε αρχείο **CSV**.
- Λειτουργία εκτύπωσης / Print-friendly view.

### 6. 🔐 Ασφάλεια & Διαχείριση Προφίλ
- Αρχικό setup λογαριασμού διαχειριστή κατά την πρώτη εκκίνηση.
- Ασφαλής αυθεντικοποίηση με HTTP-only Session Cookies και **bcrypt password hashing**.
- Πλήρες μενού διαχείρισης προφίλ για αλλαγή **Username** και **Password**.

---

## 🛠️ Τεχνολογικό Στοίβαγμα (Tech Stack)

- **Backend**: Go (Golang 1.22+)
  - `net/http` standard library.
  - Embedded static asset file server (`embed`).
  - `modernc.org/sqlite` (Pure Go CGO-free SQLite driver).
- **Frontend**: Single Page Application (SPA)
  - Vanilla HTML5 / Vanilla CSS3 (Glassmorphism design, CSS Variables, Responsive layout).
  - Vanilla JavaScript (Async Fetch API, dynamic components).
  - Google Fonts (`Inter`, `JetBrains Mono`) & Lucide Icons.
- **Containerization**: Docker & Docker Compose (Multi-stage build).

---

## 🐳 Γρήγορη Εκκίνηση με Docker (Quick Start)

### 1. Κλωνοποίηση του Αποθετηρίου
```bash
git clone https://github.com/iosifidis/InfraAtlas.git
cd InfraAtlas
```

### 2. Εκκίνηση με Docker Compose
```bash
docker compose up --build -d
```

Η εφαρμογή θα είναι διαθέσιμη στη διεύθυνση: **`http://localhost:8080`**

---

## 📂 Δομή Αρχείων Έργου

```text
InfraAtlas/
├── main.go               # Σημείο εισόδου & δρομολόγηση HTTP routes
├── handlers.go           # Handlers για API endpoints (Auth, Clusters, VMs, DNS, CSV)
├── db.go                 # Σχήμα SQLite & CRUD λειτουργίες βάσης
├── Dockerfile            # Multi-stage Docker build file
├── docker-compose.yml    # Docker Compose configuration με bind volume
├── go.mod / go.sum       # Εξαρτήσεις Go modules
├── static/               # Frontend Assets
│   ├── index.html        # SPA Main Interface
│   ├── style.css         # Custom Glassmorphic Dark Design System
│   └── app.js            # Frontend Logic Controller
└── data/                 # SQLite Database Volume (/app/data/dashboard.db)
```

---

## 💾 Αποθήκευση Δεδομένων (Data Persistence)

Η βάση δεδομένων SQLite αποθηκεύεται στον κατάλογο `./data/dashboard.db` του host μηχανήματος μέσω Docker Bind Volume.
Αυτό διασφαλίζει ότι όλα τα δεδομένα παραμένουν ανέπαφα ακόμα και κατά την επανεκκίνηση ή αναβάθμιση του container.

---

## 📜 Άδεια Χρήσης (License)

Το **InfraAtlas** είναι ελεύθερο λογισμικό και διατίθεται υπό την άδεια **GNU Affero General Public License v3.0 (AGPL-3.0)**. 
Δείτε το αρχείο [LICENSE](LICENSE) για περισσότερες λεπτομέρειες.
