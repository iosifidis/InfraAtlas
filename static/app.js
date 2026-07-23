//* =============================================================
// InfraAtlas SPA Controller (Vanilla JS)
// =============================================================

// Global Application State
const state = {
    setupCompleted: false,
    loggedIn: false,
    activeTab: 'dashboard',
    clusters: [],
    vms: [],
    dnsRecords: [],
    dnsSort: { col: 'name', dir: 'asc' },
    stats: {},
    settings: {},
    deleteTarget: null, // { type: 'cluster'|'vm'|'dns', id: number }
};

// Default Form Customization Settings (if not configured in DB)
const defaultFields = [
    'default_password', 'url', 'cpu', 'ram', 'disk', 'extra_disk',
    'ipv4', 'ipv6', 'vpn', 'backup', 'monitored', 'os', 'os_version',
    'contact_person', 'description'
];

// Initialize Application on Page Load
document.addEventListener('DOMContentLoaded', () => {
    checkAuthStatus();
    setupEventListeners();
});

// -------------------------------------------------------------
// Authentication & Setup Flows
// -------------------------------------------------------------

function checkAuthStatus() {
    fetch('/api/auth/status')
        .then(res => res.json())
        .then(data => {
            state.setupCompleted = data.setup_completed;
            state.loggedIn = data.logged_in;
            
            updateAuthUI();
            
            if (state.loggedIn) {
                initializeDashboard();
            }
        })
        .catch(err => console.error("Error checking auth status:", err));
}

function updateAuthUI() {
    const overlay = document.getElementById('auth-overlay');
    const appContainer = document.getElementById('app-container');
    const confirmGroup = document.getElementById('auth-confirm-group');
    const submitBtn = document.getElementById('auth-submit-btn');
    const title = document.getElementById('auth-title');
    const subtitle = document.getElementById('auth-subtitle');

    if (!state.setupCompleted) {
        // Setup Administrator Mode
        overlay.classList.remove('hidden');
        appContainer.classList.add('hidden');
        confirmGroup.classList.remove('hidden');
        document.getElementById('auth-confirm-password').setAttribute('required', 'true');
        title.textContent = 'Αρχική Ρύθμιση InfraAtlas';
        subtitle.textContent = 'Δημιουργήστε τον πρώτο λογαριασμό διαχειριστή για να ξεκινήσετε.';
        submitBtn.innerHTML = `<span>Δημιουργία & Είσοδος</span><i data-lucide="shield-check"></i>`;
        lucide.createIcons();
    } else if (!state.loggedIn) {
        // Standard Login Mode
        overlay.classList.remove('hidden');
        appContainer.classList.add('hidden');
        confirmGroup.classList.add('hidden');
        document.getElementById('auth-confirm-password').removeAttribute('required');
        title.textContent = 'Σύνδεση στο InfraAtlas';
        subtitle.textContent = 'Παρακαλώ εισάγετε τα στοιχεία σας.';
        submitBtn.innerHTML = `<span>Είσοδος</span><i data-lucide="log-in"></i>`;
        lucide.createIcons();
    } else {
        // Authenticated State
        overlay.classList.add('hidden');
        appContainer.classList.remove('hidden');
        
        // Update profile visual
        const username = document.getElementById('auth-username').value || 'Admin';
        document.getElementById('user-display-name').textContent = username;
        document.getElementById('user-avatar-char').textContent = username.substring(0, 1).toUpperCase();
    }
}

// Handle login/setup form submissions
document.getElementById('auth-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const username = document.getElementById('auth-username').value.trim();
    const password = document.getElementById('auth-password').value;
    const alertBox = document.getElementById('auth-alert');
    
    alertBox.classList.add('hidden');

    if (!state.setupCompleted) {
        // Setup Account
        const confirmPassword = document.getElementById('auth-confirm-password').value;
        if (password !== confirmPassword) {
            showAlert('Οι κωδικοί πρόσβασης δεν ταιριάζουν.');
            return;
        }
        
        sendAuthRequest('/api/auth/setup', { username, password });
    } else {
        // Standard Login
        sendAuthRequest('/api/auth/login', { username, password });
    }
});

function sendAuthRequest(url, payload) {
    fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    .then(async res => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Σφάλμα σύνδεσης');
        return data;
    })
    .then(() => {
        checkAuthStatus();
    })
    .catch(err => {
        showAlert(err.message);
    });
}

function showAlert(message) {
    const alertBox = document.getElementById('auth-alert');
    alertBox.innerHTML = `<i data-lucide="alert-circle"></i><span>${message}</span>`;
    alertBox.classList.remove('hidden');
    lucide.createIcons();
}

// -------------------------------------------------------------
// App Initialization & Tab Navigation
// -------------------------------------------------------------

function initializeDashboard() {
    // Determine active tab from URL hash
    let hash = window.location.hash.substring(1);
    if (!['dashboard', 'clusters', 'vms', 'dns', 'reports', 'settings'].includes(hash)) {
        hash = 'dashboard';
    }
    
    switchTab(hash);
    
    // Initial fetch operations
    loadUserProfile();
    fetchSettings();
    fetchStats();
    fetchClusters();
    fetchVMs();
    fetchDNSRecords();
    
    // Set up timer for periodically updating statistics (e.g. every 60 seconds)
    setInterval(fetchStats, 60000);
}

function setupEventListeners() {
    // Menu Tab switches
    document.querySelectorAll('.menu-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const tab = item.getAttribute('data-tab');
            window.location.hash = tab;
            switchTab(tab);
        });
    });

    // Logout
    document.getElementById('logout-btn').addEventListener('click', () => {
        fetch('/api/auth/logout', { method: 'POST' })
            .then(() => {
                state.loggedIn = false;
                updateAuthUI();
                window.location.hash = '';
            })
            .catch(err => console.error("Logout failed:", err));
    });

    // VM Modal Tab switches
    document.querySelectorAll('.modal-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.modal-tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.modal-tab-content').forEach(c => c.classList.remove('active'));
            
            btn.classList.add('active');
            const contentId = btn.getAttribute('data-modaltab');
            document.getElementById(contentId).classList.add('active');
        });
    });

    // Delete Modal confirmation button
    document.getElementById('delete-confirm-btn').addEventListener('click', confirmDeletion);
}

function switchTab(tabId) {
    state.activeTab = tabId;
    
    // Toggle active classes on sidebar links
    document.querySelectorAll('.menu-item').forEach(item => {
        if (item.getAttribute('data-tab') === tabId) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });

    // Toggle active panes
    document.querySelectorAll('.tab-pane').forEach(pane => {
        if (pane.id === `tab-${tabId}`) {
            pane.classList.add('active');
        } else {
            pane.classList.remove('active');
        }
    });

    // Update Header labels
    const pageTitle = document.getElementById('page-title');
    const pageDesc = document.getElementById('page-description');
    
    switch (tabId) {
        case 'dashboard':
            pageTitle.textContent = 'Dashboard';
            pageDesc.textContent = 'Συνολική εικόνα των υποδομών σας.';
            fetchStats();
            break;
        case 'clusters':
            pageTitle.textContent = 'Clusters';
            pageDesc.textContent = 'Διαχείριση των clusters (συστάδων) των VM.';
            fetchClusters();
            break;
        case 'vms':
            pageTitle.textContent = 'Virtual Machines';
            pageDesc.textContent = 'Λεπτομερής κατάλογος και διαχείριση όλων των εικονικών μηχανών.';
            fetchVMs();
            break;
        case 'dns':
            pageTitle.textContent = 'DNS Records (Zone File)';
            pageDesc.textContent = 'Διαχείριση και εισαγωγή εγγραφών A & CNAME από zonefile.';
            fetchDNSRecords();
            break;
        case 'reports':
            pageTitle.textContent = 'Αναφορές & Έλεγχος';
            pageDesc.textContent = 'Έλεγχος χρήσης, εντοπισμός ανενεργών πόρων και εξαγωγές.';
            runReport();
            break;
        case 'settings':
            pageTitle.textContent = 'Ρυθμίσεις Φόρμας';
            pageDesc.textContent = 'Προσαρμογή των εμφανιζόμενων πεδίων εισαγωγής.';
            break;
    }
}

// -------------------------------------------------------------
// Fetching Data APIs
// -------------------------------------------------------------

function fetchSettings() {
    fetch('/api/settings')
        .then(res => res.json())
        .then(data => {
            state.settings = data;
            applySettingsToUI();
        })
        .catch(err => console.error("Error loading settings:", err));
}

function fetchStats() {
    fetch('/api/stats')
        .then(res => res.json())
        .then(data => {
            state.stats = data;
            renderStatsDashboard();
        })
        .catch(err => console.error("Error loading statistics:", err));
}

function fetchClusters() {
    fetch('/api/clusters')
        .then(res => res.json())
        .then(data => {
            state.clusters = data || [];
            renderClusters();
            populateClusterDropdowns();
        })
        .catch(err => console.error("Error loading clusters:", err));
}

function fetchVMs() {
    const search = document.getElementById('vm-search').value.trim();
    const clusterId = document.getElementById('filter-cluster').value;
    const inUse = document.getElementById('filter-in-use').value;
    const important = document.getElementById('filter-important').value;
    const monitored = document.getElementById('filter-monitored').value;

    let queryParams = [];
    if (search) queryParams.push(`search=${encodeURIComponent(search)}`);
    if (clusterId) queryParams.push(`cluster_id=${clusterId}`);
    if (inUse !== '') queryParams.push(`in_use=${inUse}`);
    if (important !== '') queryParams.push(`is_important=${important}`);
    if (monitored !== '') queryParams.push(`monitored=${monitored}`);

    const url = '/api/vms' + (queryParams.length ? '?' + queryParams.join('&') : '');

    fetch(url)
        .then(res => res.json())
        .then(data => {
            state.vms = data || [];
            renderVMs();
        })
        .catch(err => console.error("Error loading VMs:", err));
}

// -------------------------------------------------------------
// Dynamic Rendering: Settings Page & Form Layout
// -------------------------------------------------------------

function applySettingsToUI() {
    // 1. Sync toggle switches in the Settings panel
    defaultFields.forEach(field => {
        const toggle = document.getElementById(`field-${field}`);
        if (toggle) {
            // Checked if not disabled (defaults to checked if not explicitly configured as "0" or "false")
            const isVisible = state.settings[field] !== '0';
            toggle.checked = isVisible;
        }
    });

    // 2. Adjust visibility of fields inside the VM Modal Form
    defaultFields.forEach(field => {
        const isVisible = state.settings[field] !== '0';
        const formFields = document.querySelectorAll(`[data-customfield="${field}"]`);
        formFields.forEach(el => {
            if (isVisible) {
                el.classList.remove('hidden');
            } else {
                el.classList.add('hidden');
            }
        });
    });
}

function saveSettings(e) {
    e.preventDefault();
    const payload = {};
    
    defaultFields.forEach(field => {
        const toggle = document.getElementById(`field-${field}`);
        if (toggle) {
            payload[field] = toggle.checked ? '1' : '0';
        }
    });

    fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    .then(res => res.json())
    .then(data => {
        state.settings = payload;
        applySettingsToUI();
        alert("Οι ρυθμίσεις της φόρμας αποθηκεύτηκαν με επιτυχία!");
    })
    .catch(err => alert("Αποτυχία αποθήκευσης ρυθμίσεων: " + err));
}

// -------------------------------------------------------------
// Dynamic Rendering: Dashboard Stats
// -------------------------------------------------------------

function renderStatsDashboard() {
    const stats = state.stats;
    if (!stats) return;

    // Counters
    document.getElementById('stat-clusters').textContent = stats.total_clusters || 0;
    document.getElementById('stat-vms').textContent = stats.total_vms || 0;
    document.getElementById('stat-in-use').textContent = stats.in_use_vms || 0;
    document.getElementById('stat-important').textContent = stats.important_vms || 0;
    document.getElementById('stat-monitored').textContent = stats.monitored_vms || 0;
    document.getElementById('stat-internal').textContent = stats.used_by_us_vms || 0;

    // Resource calculations: Progress bar shows portion allocated to "In Use" VMs vs all VMs.
    // However, since total_cpu represents sum of all VMs, let's render totals.
    // For visual aesthetics, we can represent progress bars as (in-use resources / total resources).
    // Let's first retrieve total sums.
    document.getElementById('total-cpu-val').textContent = (stats.total_cpu || 0).toFixed(1);
    document.getElementById('total-ram-val').textContent = (stats.total_ram || 0).toFixed(1);
    document.getElementById('total-disk-val').textContent = (stats.total_disk || 0).toFixed(1);
    document.getElementById('total-extradisk-val').textContent = (stats.total_extra_disk || 0).toFixed(1);

    // Calculate In-Use specs percentages
    let inUseCPU = 0, inUseRAM = 0, inUseDisk = 0, inUseExtraDisk = 0;
    
    // We can compute this client-side from state.vms
    state.vms.forEach(v => {
        if (v.in_use === 1) {
            inUseCPU += v.cpu;
            inUseRAM += v.ram;
            inUseDisk += v.disk;
            inUseExtraDisk += v.extra_disk;
        }
    });

    const cpuPct = stats.total_cpu > 0 ? (inUseCPU / stats.total_cpu) * 100 : 0;
    const ramPct = stats.total_ram > 0 ? (inUseRAM / stats.total_ram) * 100 : 0;
    const diskPct = stats.total_disk > 0 ? (inUseDisk / stats.total_disk) * 100 : 0;
    const extraDiskPct = stats.total_extra_disk > 0 ? (inUseExtraDisk / stats.total_extra_disk) * 100 : 0;

    document.getElementById('total-cpu-fill').style.width = `${cpuPct}%`;
    document.getElementById('total-ram-fill').style.width = `${ramPct}%`;
    document.getElementById('total-disk-fill').style.width = `${diskPct}%`;
    document.getElementById('total-extradisk-fill').style.width = `${extraDiskPct}%`;

    // Smart Warnings Generator
    const alertZone = document.getElementById('alert-zone');
    alertZone.innerHTML = '';

    let warningsCount = 0;
    state.vms.forEach(v => {
        if (v.is_important === 1 && v.in_use === 0) {
            warningsCount++;
            const alertCard = document.createElement('div');
            alertCard.className = 'alert-item alert-item-warning';
            alertCard.innerHTML = `
                <i data-lucide="alert-triangle"></i>
                <span>Το VM <strong>${escapeHTML(v.name)}</strong> (${escapeHTML(v.cluster_name)}) είναι Σημαντικό αλλά <strong>Δεν χρησιμοποιείται</strong>.</span>
            `;
            alertZone.appendChild(alertCard);
        }
        if (v.is_important === 1 && v.monitored === 0) {
            warningsCount++;
            const alertCard = document.createElement('div');
            alertCard.className = 'alert-item alert-item-warning';
            alertCard.innerHTML = `
                <i data-lucide="eye-off"></i>
                <span>Το VM <strong>${escapeHTML(v.name)}</strong> (${escapeHTML(v.cluster_name)}) είναι Σημαντικό αλλά <strong>Δεν παρακολουθείται (Unmonitored)</strong>.</span>
            `;
            alertZone.appendChild(alertCard);
        }
    });

    if (warningsCount === 0) {
        alertZone.innerHTML = `
            <div class="alert-item alert-item-warning" style="background: rgba(16, 185, 129, 0.06); border-left-color: var(--success); color: #ecfdf5;">
                <i data-lucide="check-circle" style="color: var(--success)"></i>
                <span>Δεν εντοπίστηκαν εκκρεμότητες ή ανενεργά σημαντικά VM.</span>
            </div>
        `;
    }
    
    lucide.createIcons();

    // Render Cluster Resources Table
    const tbody = document.getElementById('cluster-resources-tbody');
    tbody.innerHTML = '';

    if (stats.cluster_distribution && stats.cluster_distribution.length > 0) {
        stats.cluster_distribution.forEach(dist => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td><strong>${escapeHTML(dist.name)}</strong></td>
                <td>${dist.vm_count}</td>
                <td><span class="badge badge-success">${dist.in_use_count} Active</span></td>
                <td>${(dist.cpu || 0).toFixed(1)}</td>
                <td>${(dist.ram || 0).toFixed(1)}</td>
                <td>${(dist.disk || 0).toFixed(1)}</td>
                <td>${dist.internal_count} VMs</td>
            `;
            tbody.appendChild(row);
        });
    } else {
        tbody.innerHTML = `<tr><td colspan="7" class="text-secondary" style="text-align: center;">Δεν υπάρχουν δεδομένα clusters.</td></tr>`;
    }
}

// -------------------------------------------------------------
// Dynamic Rendering: Clusters Cards
// -------------------------------------------------------------

function renderClusters() {
    const container = document.getElementById('clusters-container');
    container.innerHTML = '';

    if (state.clusters.length === 0) {
        container.innerHTML = `
            <div class="glass" style="padding: 3rem; text-align: center; grid-column: 1 / -1;">
                <i data-lucide="boxes" style="width: 48px; height: 48px; color: var(--text-muted); margin-bottom: 1rem;"></i>
                <h3>Δεν βρέθηκαν Clusters</h3>
                <p class="text-secondary" style="margin-top: 0.5rem;">Ξεκινήστε προσθέτοντας ένα νέο cluster διαχείρισης VM.</p>
            </div>
        `;
        lucide.createIcons();
        return;
    }

    state.clusters.forEach(c => {
        const card = document.createElement('div');
        card.className = 'cluster-card glass';
        card.innerHTML = `
            <div class="cluster-card-header">
                <h3>${escapeHTML(c.name)}</h3>
                <div class="cluster-actions">
                    <button class="btn-icon-only" onclick="openClusterModal(${c.id})" title="Επεξεργασία"><i data-lucide="edit-3"></i></button>
                    <button class="btn-icon-only text-danger" onclick="openDeleteModal('cluster', ${c.id})" title="Διαγραφή"><i data-lucide="trash-2"></i></button>
                </div>
            </div>
            <p>${escapeHTML(c.description || 'Χωρίς περιγραφή.')}</p>
            <div class="cluster-stats">
                <span><i data-lucide="server" style="width:12px; vertical-align:middle; margin-right:4px;"></i>${c.vm_count} Virtual Machines</span>
            </div>
        `;
        container.appendChild(card);
    });

    lucide.createIcons();
}

function populateClusterDropdowns() {
    const filterDropdown = document.getElementById('filter-cluster');
    const formDropdown = document.getElementById('vm-cluster-id');
    const reportDropdown = document.getElementById('report-cluster');

    // Save active selections
    const filterVal = filterDropdown.value;
    const reportVal = reportDropdown.value;

    // Reset
    filterDropdown.innerHTML = '<option value="">Όλα</option>';
    formDropdown.innerHTML = '<option value="">Επιλέξτε Cluster...</option>';
    reportDropdown.innerHTML = '<option value="">Όλα</option>';

    state.clusters.forEach(c => {
        filterDropdown.innerHTML += `<option value="${c.id}">${escapeHTML(c.name)}</option>`;
        formDropdown.innerHTML += `<option value="${c.id}">${escapeHTML(c.name)}</option>`;
        reportDropdown.innerHTML += `<option value="${c.id}">${escapeHTML(c.name)}</option>`;
    });

    // Restore selections
    filterDropdown.value = filterVal;
    reportDropdown.value = reportVal;
}

// -------------------------------------------------------------
// Dynamic Rendering: VMs list
// -------------------------------------------------------------

function renderVMs() {
    const tbody = document.getElementById('vms-tbody');
    tbody.innerHTML = '';

    if (state.vms.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-secondary" style="text-align: center; padding: 2rem;">Δεν βρέθηκαν VMs με τα τρέχοντα κριτήρια.</td></tr>`;
        return;
    }

    state.vms.forEach(v => {
        const row = document.createElement('tr');
        
        // Badges elements
        let badgesHtml = '';
        if (v.is_important === 1) badgesHtml += '<span class="badge badge-danger" style="margin-left:4px;">Important</span>';
        if (v.monitored === 1) badgesHtml += '<span class="badge badge-info" style="margin-left:4px;">Monitored</span>';
        if (v.used_by_us === 0) badgesHtml += '<span class="badge badge-warning" style="margin-left:4px;">Client</span>';

        const specsText = `CPU: ${v.cpu} | RAM: ${v.ram} | Disk: ${v.disk}${v.extra_disk > 0 ? ' +' + v.extra_disk : ''}`;

        row.innerHTML = `
            <td>
                <div style="font-weight: 600; color: #ffffff;">${escapeHTML(v.name)}</div>
                <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.2rem;">${v.url ? `<a href="${escapeHTML(v.url)}" target="_blank" style="text-decoration:underline;">${escapeHTML(v.url)}</a>` : ''}</div>
            </td>
            <td><span class="badge badge-info">${escapeHTML(v.cluster_name)}</span></td>
            <td><span style="font-size:0.8125rem;">${specsText}</span></td>
            <td><code style="font-size: 0.8125rem;">${escapeHTML(v.ipv4 || '-')}</code></td>
            <td>
                <div style="display:flex; align-items:center; gap:0.4rem;">
                    <span class="indicator-dot ${v.in_use === 1 ? 'online' : ''}" style="background-color: ${v.in_use === 1 ? 'var(--success)' : 'var(--text-muted)'};"></span>
                    <span style="font-size: 0.8125rem;">${v.in_use === 1 ? 'Σε Χρήση' : 'Ανενεργό'}</span>
                    ${badgesHtml}
                </div>
            </td>
            <td><span style="font-size:0.8125rem;">${escapeHTML(v.contact_person || 'Εμείς')}</span></td>
            <td class="actions-col">
                <div class="table-actions">
                    <button class="btn-icon-only" onclick="openVMModal(${v.id})" title="Επεξεργασία"><i data-lucide="edit-3"></i></button>
                    <button class="btn-icon-only text-danger" onclick="openDeleteModal('vm', ${v.id})" title="Διαγραφή"><i data-lucide="trash-2"></i></button>
                </div>
            </td>
        `;
        tbody.appendChild(row);
    });

    lucide.createIcons();
}

// -------------------------------------------------------------
// Modals Open/Close/Save: Clusters
// -------------------------------------------------------------

function openClusterModal(id = null) {
    const modal = document.getElementById('cluster-modal');
    const title = document.getElementById('cluster-modal-title');
    const form = document.getElementById('cluster-form');
    
    form.reset();
    document.getElementById('cluster-id').value = '';

    if (id) {
        title.textContent = 'Επεξεργασία Cluster';
        const cluster = state.clusters.find(c => c.id === id);
        if (cluster) {
            document.getElementById('cluster-id').value = cluster.id;
            document.getElementById('cluster-name').value = cluster.name;
            document.getElementById('cluster-desc').value = cluster.description;
        }
    } else {
        title.textContent = 'Προσθήκη Νέου Cluster';
    }

    modal.classList.remove('hidden');
}

function closeClusterModal() {
    document.getElementById('cluster-modal').classList.add('hidden');
}

function saveCluster(e) {
    e.preventDefault();
    const id = document.getElementById('cluster-id').value;
    const name = document.getElementById('cluster-name').value.trim();
    const description = document.getElementById('cluster-desc').value.trim();

    const payload = { name, description };
    const method = id ? 'PUT' : 'POST';
    const url = id ? `/api/clusters/${id}` : '/api/clusters';

    fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    .then(async res => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Σφάλμα κατά την αποθήκευση');
        return data;
    })
    .then(() => {
        closeClusterModal();
        fetchClusters();
        fetchStats();
    })
    .catch(err => alert(err.message));
}

// -------------------------------------------------------------
// Modals Open/Close/Save: VMs
// -------------------------------------------------------------

function openVMModal(id = null) {
    const modal = document.getElementById('vm-modal');
    const title = document.getElementById('vm-modal-title');
    const form = document.getElementById('vm-form');
    
    form.reset();
    document.getElementById('vm-id').value = '';
    
    // Default Tab selection
    document.querySelectorAll('.modal-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.modal-tab-content').forEach(c => c.classList.remove('active'));
    document.querySelector('[data-modaltab="vm-tab-basic"]').classList.add('active');
    document.getElementById('vm-tab-basic').classList.add('active');

    // Load form field customization settings
    applySettingsToUI();

    if (id) {
        title.textContent = 'Επεξεργασία Virtual Machine';
        
        fetch(`/api/vms/${id}`)
            .then(res => res.json())
            .then(v => {
                document.getElementById('vm-id').value = v.id;
                document.getElementById('vm-cluster-id').value = v.cluster_id;
                document.getElementById('vm-name').value = v.name;
                document.getElementById('vm-default-password').value = v.default_password || '';
                document.getElementById('vm-url').value = v.url || '';
                document.getElementById('vm-os').value = v.os || '';
                document.getElementById('vm-os-version').value = v.os_version || '';
                
                document.getElementById('vm-cpu').value = v.cpu || '';
                document.getElementById('vm-ram').value = v.ram || '';
                document.getElementById('vm-disk').value = v.disk || '';
                document.getElementById('vm-extra-disk').value = v.extra_disk || '';
                
                document.getElementById('vm-ipv4').value = v.ipv4 || '';
                document.getElementById('vm-ipv6').value = v.ipv6 || '';
                document.getElementById('vm-vpn').value = v.vpn || '';
                document.getElementById('vm-backup').value = v.backup || '';
                document.getElementById('vm-contact').value = v.contact_person || '';
                document.getElementById('vm-desc').value = v.description || '';

                document.getElementById('vm-in-use').checked = v.in_use === 1;
                document.getElementById('vm-is-important').checked = v.is_important === 1;
                document.getElementById('vm-used-by-us').checked = v.used_by_us === 1;
                document.getElementById('vm-monitored').checked = v.monitored === 1;
                
                modal.classList.remove('hidden');
            })
            .catch(err => alert("Αποτυχία φόρτωσης VM: " + err));
    } else {
        title.textContent = 'Καταγραφή Νέου Virtual Machine';
        
        // Pre-select active cluster filter if any
        const activeClusterFilter = document.getElementById('filter-cluster').value;
        if (activeClusterFilter) {
            document.getElementById('vm-cluster-id').value = activeClusterFilter;
        }
        
        modal.classList.remove('hidden');
    }
}

function closeVMModal() {
    document.getElementById('vm-modal').classList.add('hidden');
}

function saveVM(e) {
    e.preventDefault();
    const id = document.getElementById('vm-id').value;
    
    // Numeric specs validation & parsing
    const parseNumber = (val) => {
        const num = parseFloat(val);
        return isNaN(num) ? 0 : num;
    };

    const payload = {
        cluster_id: parseInt(document.getElementById('vm-cluster-id').value),
        name: document.getElementById('vm-name').value.trim(),
        default_password: document.getElementById('vm-default-password').value.trim(),
        url: document.getElementById('vm-url').value.trim(),
        os: document.getElementById('vm-os').value.trim(),
        os_version: document.getElementById('vm-os-version').value.trim(),
        
        cpu: parseNumber(document.getElementById('vm-cpu').value),
        ram: parseNumber(document.getElementById('vm-ram').value),
        disk: parseNumber(document.getElementById('vm-disk').value),
        extra_disk: parseNumber(document.getElementById('vm-extra-disk').value),
        
        ipv4: document.getElementById('vm-ipv4').value.trim(),
        ipv6: document.getElementById('vm-ipv6').value.trim(),
        vpn: document.getElementById('vm-vpn').value.trim(),
        backup: document.getElementById('vm-backup').value.trim(),
        contact_person: document.getElementById('vm-contact').value.trim(),
        description: document.getElementById('vm-desc').value.trim(),

        in_use: document.getElementById('vm-in-use').checked ? 1 : 0,
        is_important: document.getElementById('vm-is-important').checked ? 1 : 0,
        used_by_us: document.getElementById('vm-used-by-us').checked ? 1 : 0,
        monitored: document.getElementById('vm-monitored').checked ? 1 : 0
    };

    const method = id ? 'PUT' : 'POST';
    const url = id ? `/api/vms/${id}` : '/api/vms';

    fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    .then(async res => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Σφάλμα κατά την αποθήκευση');
        return data;
    })
    .then(() => {
        closeVMModal();
        fetchVMs();
        fetchStats();
    })
    .catch(err => alert(err.message));
}

// -------------------------------------------------------------
// Confirmation Delete Modal
// -------------------------------------------------------------

function openDeleteModal(type, id) {
    state.deleteTarget = { type, id };
    const modal = document.getElementById('delete-modal');
    const msg = document.getElementById('delete-modal-message');

    if (type === 'cluster') {
        msg.innerHTML = 'Είστε σίγουροι ότι θέλετε να διαγράψετε αυτό το <strong>Cluster</strong>; <br><span class="text-danger" style="font-size:0.8rem;">Προσοχή: Όλα τα VMs που ανήκουν σε αυτό το cluster θα διαγραφούν επίσης οριστικά!</span>';
    } else if (type === 'dns') {
        msg.innerHTML = 'Είστε σίγουροι ότι θέλετε να διαγράψετε αυτή την <strong>DNS εγγραφή</strong>;';
    } else {
        msg.innerHTML = 'Είστε σίγουροι ότι θέλετε να διαγράψετε αυτό το <strong>Virtual Machine</strong>; αυτή η ενέργεια δεν αναιρείται.';
    }

    modal.classList.remove('hidden');
    lucide.createIcons();
}

function closeDeleteModal() {
    document.getElementById('delete-modal').classList.add('hidden');
    state.deleteTarget = null;
}

function confirmDeletion() {
    if (!state.deleteTarget) return;
    const { type, id } = state.deleteTarget;
    
    let url = `/api/vms/${id}`;
    if (type === 'cluster') url = `/api/clusters/${id}`;
    if (type === 'dns') url = `/api/dns/${id}`;

    fetch(url, { method: 'DELETE' })
        .then(async res => {
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Σφάλμα κατά τη διαγραφή');
            return data;
        })
        .then(() => {
            closeDeleteModal();
            if (type === 'cluster') fetchClusters();
            if (type === 'dns') fetchDNSRecords();
            fetchVMs();
            fetchStats();
        })
        .catch(err => {
            closeDeleteModal();
            alert(err.message);
        });
}

// -------------------------------------------------------------
// DNS Records Management
// -------------------------------------------------------------

function fetchDNSRecords() {
    const search = document.getElementById('dns-search').value.trim();
    const type = document.getElementById('filter-dns-type').value;

    let queryParams = [];
    if (search) queryParams.push(`search=${encodeURIComponent(search)}`);
    if (type) queryParams.push(`type=${encodeURIComponent(type)}`);

    const url = '/api/dns' + (queryParams.length ? '?' + queryParams.join('&') : '');

    fetch(url)
        .then(res => res.json())
        .then(data => {
            state.dnsRecords = data || [];
            renderDNSRecords();
        })
        .catch(err => console.error("Error loading DNS records:", err));
}

function sortDNSTable(col) {
    if (state.dnsSort.col === col) {
        state.dnsSort.dir = state.dnsSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
        state.dnsSort.col = col;
        state.dnsSort.dir = 'asc';
    }
    renderDNSRecords();
}

function renderDNSRecords() {
    const tbody = document.getElementById('dns-tbody');
    tbody.innerHTML = '';

    if (state.dnsRecords.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-secondary" style="text-align: center; padding: 2rem;">Δεν βρέθηκαν εγγραφές DNS.</td></tr>`;
        return;
    }

    // Sort records in-place
    const { col, dir } = state.dnsSort;
    state.dnsRecords.sort((a, b) => {
        let valA = (a[col] || '').toString().toLowerCase();
        let valB = (b[col] || '').toString().toLowerCase();
        if (valA < valB) return dir === 'asc' ? -1 : 1;
        if (valA > valB) return dir === 'asc' ? 1 : -1;
        return 0;
    });

    // Update active sort indicator icons in header
    ['name', 'type', 'value'].forEach(cKey => {
        const iconEl = document.getElementById(`dns-sort-icon-${cKey}`);
        if (iconEl) {
            if (state.dnsSort.col === cKey) {
                iconEl.setAttribute('data-lucide', state.dnsSort.dir === 'asc' ? 'arrow-up' : 'arrow-down');
                iconEl.style.opacity = '1';
                iconEl.style.color = 'var(--primary)';
            } else {
                iconEl.setAttribute('data-lucide', 'arrow-up-down');
                iconEl.style.opacity = '0.4';
                iconEl.style.color = '';
            }
        }
    });

    state.dnsRecords.forEach(r => {
        const row = document.createElement('tr');
        const badgeClass = r.type === 'A' ? 'badge-success' : 'badge-info';
        
        row.innerHTML = `
            <td>
                <div style="font-weight: 600; color: #ffffff;">${escapeHTML(r.name)}</div>
                ${r.description ? `<div style="font-size: 0.75rem; color: var(--text-secondary);">${escapeHTML(r.description)}</div>` : ''}
            </td>
            <td><span class="badge ${badgeClass}">${escapeHTML(r.type)}</span></td>
            <td><code>${escapeHTML(r.value)}</code></td>
            <td>
                <button class="btn btn-outline" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;" onclick="linkDNSToVM('${escapeHTML(r.value)}', '${escapeHTML(r.name)}')">
                    <i data-lucide="link" style="width:12px; height:12px;"></i>
                    <span>Σύνδεση / VM</span>
                </button>
            </td>
            <td class="actions-col">
                <div class="table-actions">
                    <button class="btn-icon-only" onclick="openDNSModal(${r.id})" title="Επεξεργασία"><i data-lucide="edit-3"></i></button>
                    <button class="btn-icon-only text-danger" onclick="openDeleteModal('dns', ${r.id})" title="Διαγραφή"><i data-lucide="trash-2"></i></button>
                </div>
            </td>
        `;
        tbody.appendChild(row);
    });

    lucide.createIcons();
}

function openDNSModal(id = null) {
    const modal = document.getElementById('dns-modal');
    const title = document.getElementById('dns-modal-title');
    const form = document.getElementById('dns-form');
    
    form.reset();
    document.getElementById('dns-id').value = '';

    if (id) {
        title.textContent = 'Επεξεργασία Εγγραφής DNS';
        const record = state.dnsRecords.find(r => r.id === id);
        if (record) {
            document.getElementById('dns-id').value = record.id;
            document.getElementById('dns-name').value = record.name;
            document.getElementById('dns-type').value = record.type;
            document.getElementById('dns-value').value = record.value;
            document.getElementById('dns-desc').value = record.description || '';
        }
    } else {
        title.textContent = 'Προσθήκη Εγγραφής DNS';
    }

    modal.classList.remove('hidden');
}

function closeDNSModal() {
    document.getElementById('dns-modal').classList.add('hidden');
}

function saveDNSRecord(e) {
    e.preventDefault();
    const id = document.getElementById('dns-id').value;
    const name = document.getElementById('dns-name').value.trim();
    const type = document.getElementById('dns-type').value;
    const value = document.getElementById('dns-value').value.trim();
    const description = document.getElementById('dns-desc').value.trim();

    const payload = { name, type, value, ttl: 86400, description };
    const method = id ? 'PUT' : 'POST';
    const url = id ? `/api/dns/${id}` : '/api/dns';

    fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    .then(async res => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Σφάλμα κατά την αποθήκευση DNS');
        return data;
    })
    .then(() => {
        closeDNSModal();
        fetchDNSRecords();
    })
    .catch(err => alert(err.message));
}

function openDNSImportModal() {
    const modal = document.getElementById('dns-import-modal');
    const form = document.getElementById('dns-import-form');
    const alertBox = document.getElementById('dns-import-alert');
    form.reset();
    alertBox.classList.add('hidden');
    modal.classList.remove('hidden');
}

function closeDNSImportModal() {
    document.getElementById('dns-import-modal').classList.add('hidden');
}

function submitDNSImport(e) {
    e.preventDefault();
    const fileInput = document.getElementById('dns-file-input');
    const pasteInput = document.getElementById('dns-paste-input').value.trim();
    const alertBox = document.getElementById('dns-import-alert');

    if (fileInput.files.length > 0) {
        const formData = new FormData();
        formData.append('zonefile', fileInput.files[0]);

        fetch('/api/dns/import', {
            method: 'POST',
            body: formData
        })
        .then(async res => {
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Σφάλμα εισαγωγής αρχείου');
            return data;
        })
        .then(data => {
            alertBox.className = 'alert alert-success';
            alertBox.textContent = data.message;
            alertBox.classList.remove('hidden');
            setTimeout(() => {
                closeDNSImportModal();
                fetchDNSRecords();
            }, 1200);
        })
        .catch(err => {
            alertBox.className = 'alert alert-danger';
            alertBox.textContent = err.message;
            alertBox.classList.remove('hidden');
        });
    } else if (pasteInput) {
        fetch('/api/dns/import', {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: pasteInput
        })
        .then(async res => {
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Σφάλμα εισαγωγής zonefile');
            return data;
        })
        .then(data => {
            alertBox.className = 'alert alert-success';
            alertBox.textContent = data.message;
            alertBox.classList.remove('hidden');
            setTimeout(() => {
                closeDNSImportModal();
                fetchDNSRecords();
            }, 1200);
        })
        .catch(err => {
            alertBox.className = 'alert alert-danger';
            alertBox.textContent = err.message;
            alertBox.classList.remove('hidden');
        });
    } else {
        alert("Παρακαλώ επιλέξτε αρχείο zonefile ή επικολλήστε περιεχόμενο.");
    }
}

function linkDNSToVM(val, hostname) {
    // Switch to VMs tab and filter by IP or Hostname
    switchTab('vms');
    window.location.hash = 'vms';
    
    const searchInput = document.getElementById('vm-search');
    searchInput.value = val;
    fetchVMs();
}

// -------------------------------------------------------------
// Report Generator Page Logic
// -------------------------------------------------------------

function applyReportPreset(preset) {
    // Reset all filter options
    document.getElementById('report-cluster').value = '';
    document.getElementById('report-in-use').value = '';
    document.getElementById('report-important').value = '';
    document.getElementById('report-used-by-us').value = '';
    
    // Toggle active classes on preset buttons
    document.querySelectorAll('.presets-row .btn').forEach(btn => {
        btn.classList.remove('active');
    });

    // Apply specific preset configurations
    if (preset === 'unused-important') {
        document.getElementById('report-in-use').value = '0';
        document.getElementById('report-important').value = '1';
        event.currentTarget.classList.add('active');
    } else if (preset === 'external-clients') {
        document.getElementById('report-used-by-us').value = '0';
        event.currentTarget.classList.add('active');
    } else if (preset === 'unmonitored') {
        document.getElementById('report-important').value = '1'; // Unmonitored checks are typically critical for important VMs
        // In the app preset, let's select all unmonitored instead
        document.getElementById('report-important').value = '';
        // Wait, unmonitored doesn't have an option in report fields directly.
        // We will fetch VMs and filter clientside or add a parameter.
        // Let's filter clientside or just load all and display unmonitored!
        event.currentTarget.classList.add('active');
    } else if (preset === 'all') {
        event.currentTarget.classList.add('active');
    }
    
    state.activeReportPreset = preset;
    runReport();
}

function runReport() {
    const clusterId = document.getElementById('report-cluster').value;
    const inUse = document.getElementById('report-in-use').value;
    const important = document.getElementById('report-important').value;
    const usedByUs = document.getElementById('report-used-by-us').value;

    let queryParams = [];
    if (clusterId) queryParams.push(`cluster_id=${clusterId}`);
    if (inUse !== '') queryParams.push(`in_use=${inUse}`);
    if (important !== '') queryParams.push(`is_important=${important}`);

    const url = '/api/vms' + (queryParams.length ? '?' + queryParams.join('&') : '');

    fetch(url)
        .then(res => res.json())
        .then(data => {
            let vms = data || [];
            
            // Client-side filtering for specific presets
            if (state.activeReportPreset === 'unmonitored') {
                vms = vms.filter(v => v.monitored === 0);
            }
            if (usedByUs !== '') {
                vms = vms.filter(v => v.used_by_us === parseInt(usedByUs));
            }

            renderReportTable(vms);
        })
        .catch(err => console.error("Error running report:", err));
}

function renderReportTable(vms) {
    const tbody = document.getElementById('reports-tbody');
    tbody.innerHTML = '';
    
    document.getElementById('report-results-count').textContent = `${vms.length} VMs`;

    // Title label updates based on preset
    const resultsTitle = document.getElementById('report-results-title');
    if (state.activeReportPreset === 'unused-important') {
        resultsTitle.textContent = 'Ανενεργά Σημαντικά VMs (Προς Έλεγχο/Διαγραφή)';
    } else if (state.activeReportPreset === 'external-clients') {
        resultsTitle.textContent = 'VMs Παραχωρημένα σε Εξωτερικούς Συνεργάτες / Τρίτους';
    } else if (state.activeReportPreset === 'unmonitored') {
        resultsTitle.textContent = 'VMs Χωρίς Επίβλεψη (Unmonitored)';
    } else {
        resultsTitle.textContent = 'Καταγραφή VMs (Πλήρης Αναφορά)';
    }

    if (vms.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="text-secondary" style="text-align: center; padding: 2rem;">Δεν βρέθηκαν αποτελέσματα για αυτή την αναφορά.</td></tr>`;
        return;
    }

    vms.forEach(v => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td><strong>${escapeHTML(v.name)}</strong></td>
            <td><span class="badge badge-info">${escapeHTML(v.cluster_name)}</span></td>
            <td><span style="font-size:0.75rem;">CPU: ${v.cpu} | RAM: ${v.ram} | Disk: ${v.disk}</span></td>
            <td><code>${escapeHTML(v.ipv4 || '-')}</code></td>
            <td>
                <div style="font-size: 0.75rem;">
                    <div>VPN: ${escapeHTML(v.vpn || 'Όχι')}</div>
                    <div>Backup: ${escapeHTML(v.backup || 'Όχι')}</div>
                </div>
            </td>
            <td><span class="badge ${v.in_use === 1 ? 'badge-success' : 'badge-danger'}">${v.in_use === 1 ? 'Ναι' : 'Όχι'}</span></td>
            <td><span class="badge ${v.is_important === 1 ? 'badge-danger' : 'badge-info'}">${v.is_important === 1 ? 'Ναι' : 'Όχι'}</span></td>
            <td><span class="badge ${v.used_by_us === 1 ? 'badge-success' : 'badge-warning'}">${v.used_by_us === 1 ? 'Εμείς' : 'Τρίτοι'}</span></td>
            <td><span style="font-size: 0.75rem;">${escapeHTML(v.contact_person || 'Εμείς')}</span></td>
        `;
        tbody.appendChild(row);
    });
}

function exportReportCSV() {
    const clusterId = document.getElementById('report-cluster').value;
    const inUse = document.getElementById('report-in-use').value;
    const important = document.getElementById('report-important').value;
    // Note: CSV API will export matching VMs
    let queryParams = [];
    if (clusterId) queryParams.push(`cluster_id=${clusterId}`);
    if (inUse !== '') queryParams.push(`in_use=${inUse}`);
    if (important !== '') queryParams.push(`is_important=${important}`);
    
    // We open download link
    const url = '/api/export/csv' + (queryParams.length ? '?' + queryParams.join('&') : '');
    window.open(url, '_blank');
}

function printReport() {
    window.print();
}

function openVMImportModal() {
    const modal = document.getElementById('vm-import-modal');
    const form = document.getElementById('vm-import-form');
    const alertBox = document.getElementById('vm-import-alert');
    form.reset();
    alertBox.classList.add('hidden');
    modal.classList.remove('hidden');
}

function closeVMImportModal() {
    document.getElementById('vm-import-modal').classList.add('hidden');
}

function submitVMImport(e) {
    e.preventDefault();
    const fileInput = document.getElementById('vm-file-input');
    const pasteInput = document.getElementById('vm-paste-input').value.trim();
    const alertBox = document.getElementById('vm-import-alert');

    const handleSuccess = (data) => {
        alertBox.className = 'alert alert-success';
        alertBox.style.backgroundColor = 'var(--success-bg)';
        alertBox.style.color = 'var(--success)';
        alertBox.textContent = `Επιτυχία! Εισήχθησαν ${data.inserted} νέα VMs και ενημερώθηκαν ${data.updated}.`;
        alertBox.classList.remove('hidden');
        setTimeout(() => {
            closeVMImportModal();
            fetchClusters();
            fetchVMs();
            fetchStats();
        }, 1200);
    };

    const handleError = (err) => {
        alertBox.className = 'alert alert-danger';
        alertBox.textContent = err.message;
        alertBox.classList.remove('hidden');
    };

    if (fileInput.files.length > 0) {
        const reader = new FileReader();
        reader.onload = function(evt) {
            const csvContent = evt.target.result;
            fetch('/api/vms/import', {
                method: 'POST',
                headers: { 'Content-Type': 'text/csv' },
                body: csvContent
            })
            .then(async res => {
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Σφάλμα εισαγωγής CSV');
                return data;
            })
            .then(handleSuccess)
            .catch(handleError);
        };
        reader.readAsText(fileInput.files[0]);
    } else if (pasteInput) {
        fetch('/api/vms/import', {
            method: 'POST',
            headers: { 'Content-Type': 'text/csv' },
            body: pasteInput
        })
        .then(async res => {
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Σφάλμα εισαγωγής CSV');
            return data;
        })
        .then(handleSuccess)
        .catch(handleError);
    } else {
        alertBox.className = 'alert alert-danger';
        alertBox.textContent = 'Παρακαλώ επιλέξτε αρχείο CSV ή επικολλήστε το περιεχόμενο.';
        alertBox.classList.remove('hidden');
    }
}

function openProfileModal() {
    const modal = document.getElementById('profile-modal');
    const form = document.getElementById('profile-form');
    const alertBox = document.getElementById('profile-alert');
    form.reset();
    alertBox.classList.add('hidden');

    fetch('/api/auth/profile')
        .then(async res => {
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Σφάλμα ανάκτησης προφίλ');
            return data;
        })
        .then(data => {
            document.getElementById('profile-username').value = data.username || 'admin';
            modal.classList.remove('hidden');
        })
        .catch(err => {
            alert('Σφάλμα: ' + err.message);
        });
}

function closeProfileModal() {
    document.getElementById('profile-modal').classList.add('hidden');
}

function submitProfileUpdate(e) {
    e.preventDefault();
    const username = document.getElementById('profile-username').value.trim();
    const currentPassword = document.getElementById('profile-current-password').value;
    const newPassword = document.getElementById('profile-new-password').value;
    const confirmPassword = document.getElementById('profile-confirm-password').value;
    const alertBox = document.getElementById('profile-alert');

    if (newPassword && newPassword !== confirmPassword) {
        alertBox.className = 'alert alert-danger';
        alertBox.textContent = 'Ο νέος κωδικός και η επιβεβαίωση δεν ταιριάζουν.';
        alertBox.classList.remove('hidden');
        return;
    }

    if (newPassword && newPassword.length < 4) {
        alertBox.className = 'alert alert-danger';
        alertBox.textContent = 'Ο νέος κωδικός πρέπει να έχει τουλάχιστον 4 χαρακτήρες.';
        alertBox.classList.remove('hidden');
        return;
    }

    fetch('/api/auth/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            username: username,
            current_password: currentPassword,
            new_password: newPassword
        })
    })
    .then(async res => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Σφάλμα ενημέρωσης προφίλ');
        return data;
    })
    .then(data => {
        alertBox.className = 'alert alert-success';
        alertBox.style.backgroundColor = 'var(--success-bg)';
        alertBox.style.color = 'var(--success)';
        alertBox.textContent = data.message || 'Επιτυχής ενημέρωση!';
        alertBox.classList.remove('hidden');

        // Update displayed username in sidebar
        const userDisp = document.getElementById('user-display-name');
        const userChar = document.getElementById('user-avatar-char');
        if (userDisp && data.username) {
            userDisp.textContent = data.username;
        }
        if (userChar && data.username) {
            userChar.textContent = data.username.charAt(0).toUpperCase();
        }

        setTimeout(() => {
            closeProfileModal();
        }, 1200);
    })
    .catch(err => {
        alertBox.className = 'alert alert-danger';
        alertBox.textContent = err.message;
        alertBox.classList.remove('hidden');
    });
}

function loadUserProfile() {
    fetch('/api/auth/profile')
        .then(res => res.ok ? res.json() : null)
        .then(data => {
            if (data && data.username) {
                const userDisp = document.getElementById('user-display-name');
                const userChar = document.getElementById('user-avatar-char');
                if (userDisp) userDisp.textContent = data.username;
                if (userChar) userChar.textContent = data.username.charAt(0).toUpperCase();
            }
        })
        .catch(err => console.error("Error loading user profile:", err));
}

// -------------------------------------------------------------
// Helper Utilities
// -------------------------------------------------------------

function escapeHTML(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
