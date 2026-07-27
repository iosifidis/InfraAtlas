//* =============================================================
// InfraAtlas SPA Controller (Vanilla JS)
// =============================================================

// Global Application State
const state = {
    setupCompleted: false,
    loggedIn: false,
    activeTab: 'dashboard',
    clusters: [],
    vms: null,
    vmsLoaded: false,
    dnsRecords: [],
    dnsSort: { col: 'name', dir: 'asc' },
    stats: {},
    settings: {},
    deleteTarget: null, // { type: 'cluster'|'vm'|'dns', id: number }
    currentReportData: [],
    activeReportPreset: null,
};

// Default Form Customization Settings (if not configured in DB)
const defaultFields = [
    'default_password', 'url', 'cpu', 'ram', 'disk', 'extra_disk',
    'ipv4', 'ipv6', 'vpn', 'backup', 'monitored', 'os_upgrade', 'app_upgrade', 'os', 'os_version',
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
        lucide.createIcons({ nodes: [submitBtn] });
    } else if (!state.loggedIn) {
        // Standard Login Mode
        overlay.classList.remove('hidden');
        appContainer.classList.add('hidden');
        confirmGroup.classList.add('hidden');
        document.getElementById('auth-confirm-password').removeAttribute('required');
        title.textContent = 'Σύνδεση στο InfraAtlas';
        subtitle.textContent = 'Παρακαλώ εισάγετε τα στοιχεία σας.';
        submitBtn.innerHTML = `<span>Είσοδος</span><i data-lucide="log-in"></i>`;
        lucide.createIcons({ nodes: [submitBtn] });
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
    lucide.createIcons({ nodes: [alertBox] });
}

// -------------------------------------------------------------
// App Initialization & Tab Navigation
// -------------------------------------------------------------

function initializeDashboard() {
    // Determine active tab from URL hash
    let hash = window.location.hash.substring(1);
    if (!['dashboard', 'clusters', 'vms', 'dns', 'upgrades', 'reports', 'settings'].includes(hash)) {
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

    // ESC key closes any open modal
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const openModal = document.querySelector('.modal-overlay:not(.hidden)');
        if (!openModal) return;
        const id = openModal.id;
        if (id === 'cluster-modal')    closeClusterModal();
        else if (id === 'vm-modal')    closeVMModal();
        else if (id === 'dns-modal')   closeDNSModal();
        else if (id === 'dns-import-modal') closeDNSImportModal();
        else if (id === 'vm-import-modal')  closeVMImportModal();
        else if (id === 'profile-modal')    closeProfileModal();
        else if (id === 'delete-modal')     closeDeleteModal();
    });

    // Search inputs
    const debouncedRenderVMs = debounce(renderVMs, 150);
    const debouncedFetchDNS  = debounce(fetchDNSRecords, 300);
    document.getElementById('vm-search').addEventListener('input',  debouncedRenderVMs);
    document.getElementById('dns-search').addEventListener('input', debouncedFetchDNS);
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
        case 'upgrades':
            pageTitle.textContent = 'Αναβαθμίσεις';
            pageDesc.textContent = 'Λίστα εικονικών μηχανών που απαιτούν αναβάθμιση λειτουργικού ή λογισμικού.';
            // Render immediately with current data (if loaded), then refresh in background
            renderUpgradesTab();
            fetchVMs();
            break;
        case 'reports':
            pageTitle.textContent = 'Αναφορές & Έλεγχος';
            pageDesc.textContent = 'Έλεγχος χρήσης, εντοπισμός ανενεργών πόρων και εξαγωγές.';
            runReport();
            break;
        case 'settings':
            pageTitle.textContent = 'Ρυθμίσεις';
            pageDesc.textContent = 'Διαχείριση χωρητικότητας υποδομών και προσαρμογή πεδίων φόρμας.';
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
    return fetch('/api/vms?t=' + Date.now())
        .then(res => res.json())
        .then(data => {
            state.vms = data || [];
            state.vmsLoaded = true;
            try { renderVMs(); } catch (e) { console.error("Error in renderVMs:", e); }
            try { renderDashboard(); } catch (e) { console.error("Error in renderDashboard:", e); }
            try { renderUpgradesTab(); } catch (e) { console.error("Error in renderUpgradesTab:", e); }
        })
        .catch(err => console.error("Error loading VMs:", err));
}

// -------------------------------------------------------------
// Dynamic Rendering: Settings Page & Form Layout
// -------------------------------------------------------------

function applySettingsToUI() {
    // 1. Sync capacity input values in Settings panel
    const capCpu = document.getElementById('setting-capacity_cpu');
    const capRam = document.getElementById('setting-capacity_ram');
    const capDisk = document.getElementById('setting-capacity_disk');
    const capIps = document.getElementById('setting-capacity_ips');

    if (capCpu) capCpu.value = state.settings.capacity_cpu || '';
    if (capRam) capRam.value = state.settings.capacity_ram || '';
    if (capDisk) capDisk.value = state.settings.capacity_disk || '';
    if (capIps) capIps.value = state.settings.capacity_ips || '';

    // 2. Sync toggle switches in the Settings panel
    defaultFields.forEach(field => {
        const toggle = document.getElementById(`field-${field}`);
        if (toggle) {
            const isVisible = state.settings[field] !== '0';
            toggle.checked = isVisible;
        }
    });

    // 3. Adjust visibility of fields inside the VM Modal Form
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

    if (state.stats) {
        renderStatsDashboard();
    }
}

function saveSettings(e) {
    e.preventDefault();
    const payload = {};
    
    // Collect capacity limit inputs
    const capCpu = document.getElementById('setting-capacity_cpu');
    const capRam = document.getElementById('setting-capacity_ram');
    const capDisk = document.getElementById('setting-capacity_disk');
    const capIps = document.getElementById('setting-capacity_ips');

    if (capCpu) payload['capacity_cpu'] = capCpu.value.trim();
    if (capRam) payload['capacity_ram'] = capRam.value.trim();
    if (capDisk) payload['capacity_disk'] = capDisk.value.trim();
    if (capIps) payload['capacity_ips'] = capIps.value.trim();

    // Collect form field toggles
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
        fetchStats();
        showToast('Οι ρυθμίσεις αποθηκεύτηκαν με επιτυχία!', 'success');
    })
    .catch(err => showToast('Αποτυχία αποθήκευσης ρυθμίσεων: ' + err.message, 'error'));
}

// -------------------------------------------------------------
// Dynamic Rendering: Dashboard Stats
// -------------------------------------------------------------

function renderStatsDashboard() {
    const stats = state.stats;
    if (!stats) return;

    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };
    setVal('stat-clusters', stats.total_clusters || 0);
    setVal('stat-vms', stats.total_vms || 0);
    setVal('stat-in-use', stats.in_use_vms || 0);
    setVal('stat-important', stats.important_vms || 0);
    setVal('stat-monitored', stats.monitored_vms || 0);
    setVal('stat-internal', stats.used_by_us_vms || 0);

    // Resource totals across all VMs
    const allocatedCPU = stats.total_cpu || 0;
    const allocatedRAM = stats.total_ram || 0;
    const allocatedDisk = (stats.total_disk || 0) + (stats.total_extra_disk || 0);

    // Count non-empty IPv4 addresses used across VMs
    let usedIPs = 0;
    (state.vms || []).forEach(v => {
        if (v.ipv4 && v.ipv4.trim() !== '') usedIPs++;
    });

    // Capacity limits set in settings
    const maxCPU = parseFloat(state.settings.capacity_cpu) || 0;
    const maxRAM = parseFloat(state.settings.capacity_ram) || 0;
    const maxDisk = parseFloat(state.settings.capacity_disk) || 0;
    const maxIPs = parseFloat(state.settings.capacity_ips) || 0;

    // Render CPU Meter
    if (maxCPU > 0) {
        const cpuPct = Math.min(100, (allocatedCPU / maxCPU) * 100);
        document.getElementById('total-cpu-val').textContent = `${allocatedCPU.toFixed(1)} / ${maxCPU} Cores (${cpuPct.toFixed(1)}%)`;
        document.getElementById('total-cpu-fill').style.width = `${cpuPct}%`;
    } else {
        document.getElementById('total-cpu-val').textContent = `${allocatedCPU.toFixed(1)} Cores`;
        document.getElementById('total-cpu-fill').style.width = `100%`;
    }

    // Render RAM Meter
    if (maxRAM > 0) {
        const ramPct = Math.min(100, (allocatedRAM / maxRAM) * 100);
        document.getElementById('total-ram-val').textContent = `${allocatedRAM.toFixed(1)} / ${maxRAM} GB (${ramPct.toFixed(1)}%)`;
        document.getElementById('total-ram-fill').style.width = `${ramPct}%`;
    } else {
        document.getElementById('total-ram-val').textContent = `${allocatedRAM.toFixed(1)} GB`;
        document.getElementById('total-ram-fill').style.width = `100%`;
    }

    // Render DISK Meter
    if (maxDisk > 0) {
        const diskPct = Math.min(100, (allocatedDisk / maxDisk) * 100);
        document.getElementById('total-disk-val').textContent = `${allocatedDisk.toFixed(1)} / ${maxDisk} GB (${diskPct.toFixed(1)}%)`;
        document.getElementById('total-disk-fill').style.width = `${diskPct}%`;
    } else {
        document.getElementById('total-disk-val').textContent = `${allocatedDisk.toFixed(1)} GB`;
        document.getElementById('total-disk-fill').style.width = `100%`;
    }

    // Render IP Meter
    const elIpVal = document.getElementById('total-ips-val');
    const elIpFill = document.getElementById('total-ips-fill');
    if (elIpVal && elIpFill) {
        if (maxIPs > 0) {
            const ipPct = Math.min(100, (usedIPs / maxIPs) * 100);
            elIpVal.textContent = `${usedIPs} / ${maxIPs} IPs (${ipPct.toFixed(1)}%)`;
            elIpFill.style.width = `${ipPct}%`;
        } else {
            elIpVal.textContent = `${usedIPs} IPs`;
            elIpFill.style.width = `100%`;
        }
    }

    // Render Upgrades Needing List
    const upgradesListContainer = document.getElementById('upgrades-list');
    const upgradesBadge = document.getElementById('upgrades-count-badge');
    if (upgradesListContainer) {
        upgradesListContainer.innerHTML = '';
        const needingUpgrade = (state.vms || [])
            .filter(v => v.os_upgrade === 1 || v.app_upgrade === 1)
            .sort((a, b) => (b.is_important || 0) - (a.is_important || 0) || a.name.localeCompare(b.name));
        if (upgradesBadge) {
            upgradesBadge.textContent = needingUpgrade.length;
        }

        if (needingUpgrade.length === 0) {
            upgradesListContainer.innerHTML = `
                <div style="text-align: center; padding: 1.5rem 0.5rem; color: var(--text-secondary); font-size: 0.875rem;">
                    <i data-lucide="check-circle" style="color: var(--success); width: 32px; height: 32px; display: block; margin: 0 auto 0.5rem auto;"></i>
                    Όλα τα VMs είναι ενημερωμένα!
                </div>
            `;
        } else {
            needingUpgrade.forEach(v => {
                const card = document.createElement('div');
                card.className = 'upgrade-item-card';
                if (v.is_important === 1) {
                    card.classList.add('important-upgrade-card');
                }
                card.style.cursor = 'pointer';
                card.onclick = () => openVMModal(v.id);

                let badgesHtml = '';
                if (v.is_important === 1) badgesHtml += '<span class="badge badge-danger" style="margin-left:4px;">Important</span>';
                if (v.os_upgrade === 1) badgesHtml += '<span class="badge badge-warning" style="margin-left:4px;" title="Αναβάθμιση Λειτουργικού">OS Upgr</span>';
                if (v.app_upgrade === 1) badgesHtml += '<span class="badge badge-primary" style="margin-left:4px;" title="Αναβάθμιση Λογισμικού">App Upgr</span>';

                card.innerHTML = `
                    <div class="upgrade-item-main">
                        <div class="upgrade-item-name">${escapeHTML(v.name)}</div>
                        <div class="upgrade-item-ip"><code>${escapeHTML(v.ipv4 || 'Χωρίς IP')}</code> <span style="font-size:0.7rem; opacity:0.7;">(${escapeHTML(v.cluster_name)})</span></div>
                    </div>
                    <div class="upgrade-item-badges">
                        ${badgesHtml}
                    </div>
                `;
                upgradesListContainer.appendChild(card);
            });
        }
    }
    
    lucide.createIcons({ nodes: [document.getElementById('tab-dashboard')] });

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
        lucide.createIcons({ nodes: [container] });
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

    lucide.createIcons({ nodes: [container] });
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
    if (!tbody) return;
    tbody.innerHTML = '';

    const searchInput = document.getElementById('vm-search');
    const clusterSelect = document.getElementById('filter-cluster');
    const inUseSelect = document.getElementById('filter-in-use');
    const importantSelect = document.getElementById('filter-important');
    const monitoredSelect = document.getElementById('filter-monitored');

    const search = (searchInput ? searchInput.value : '').trim().toLowerCase();
    const clusterId = clusterSelect ? clusterSelect.value : '';
    const inUse = inUseSelect ? inUseSelect.value : '';
    const important = importantSelect ? importantSelect.value : '';
    const monitored = monitoredSelect ? monitoredSelect.value : '';

    let filtered = state.vms || [];

    if (search) {
        filtered = filtered.filter(v => 
            (v.name && v.name.toLowerCase().includes(search)) ||
            (v.ipv4 && v.ipv4.toLowerCase().includes(search)) ||
            (v.ipv6 && v.ipv6.toLowerCase().includes(search)) ||
            (v.url && v.url.toLowerCase().includes(search)) ||
            (v.os && v.os.toLowerCase().includes(search)) ||
            (v.contact_person && v.contact_person.toLowerCase().includes(search)) ||
            (v.description && v.description.toLowerCase().includes(search))
        );
    }
    if (clusterId) {
        filtered = filtered.filter(v => v.cluster_id === parseInt(clusterId));
    }
    if (inUse !== '') {
        filtered = filtered.filter(v => v.in_use === parseInt(inUse));
    }
    if (important !== '') {
        filtered = filtered.filter(v => v.is_important === parseInt(important));
    }
    if (monitored !== '') {
        filtered = filtered.filter(v => v.monitored === parseInt(monitored));
    }

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-secondary" style="text-align: center; padding: 2rem;">Δεν βρέθηκαν VMs με τα τρέχοντα κριτήρια.</td></tr>`;
        return;
    }

    filtered.forEach(v => {
        const row = document.createElement('tr');
        row.classList.add('vm-table-row', 'clickable-row');
        row.setAttribute('title', 'Κάντε κλικ για προβολή / επεξεργασία VM');
        row.onclick = (e) => {
            if (e.target.closest('a') || e.target.closest('button')) return;
            openVMModal(v.id);
        };
        
        // Badges elements
        let badgesHtml = '';
        if (v.is_important === 1) badgesHtml += '<span class="badge badge-danger" style="margin-left:4px;">Important</span>';
        if (v.monitored === 1) badgesHtml += '<span class="badge badge-info" style="margin-left:4px;">Monitored</span>';
        if (v.os_upgrade === 1) badgesHtml += '<span class="badge badge-warning" style="margin-left:4px;" title="Αναβάθμιση Λειτουργικού">OS Upgr</span>';
        if (v.app_upgrade === 1) badgesHtml += '<span class="badge badge-primary" style="margin-left:4px;" title="Αναβάθμιση Λογισμικού">App Upgr</span>';
        if (v.ansible === 1) badgesHtml += '<span class="badge badge-info" style="margin-left:4px;" title="Ansible">Ansible</span>';
        if (v.docker === 1) badgesHtml += '<span class="badge badge-primary" style="margin-left:4px;" title="Docker">Docker</span>';

        const specsText = `CPU: ${v.cpu} | RAM: ${v.ram} | Disk: ${v.disk}${v.extra_disk > 0 ? ' +' + v.extra_disk : ''}`;

        row.innerHTML = `
            <td class="col-vm-info">
                <div class="vm-row-flex">
                    <div class="vm-main-details">
                        <div class="vm-name-title">${escapeHTML(v.name)}</div>
                        <div class="vm-url-sub">${v.url ? `<a href="${escapeHTML(v.url)}" target="_blank" onclick="event.stopPropagation();">${escapeHTML(v.url)}</a>` : '<span class="no-url-text">Χωρίς Domain</span>'}</div>
                    </div>
                    <div class="mobile-chevron-icon">
                        <i data-lucide="chevron-right"></i>
                    </div>
                </div>
            </td>
            <td class="col-cluster"><span class="badge badge-info">${escapeHTML(v.cluster_name)}</span></td>
            <td class="col-specs"><span style="font-size:0.8125rem;">${specsText}</span></td>
            <td class="col-ipv4"><code style="font-size: 0.8125rem;">${escapeHTML(v.ipv4 || '-')}</code></td>
            <td class="col-status">
                <div style="display:flex; align-items:center; gap:0.4rem; flex-wrap:wrap;">
                    <span class="indicator-dot ${v.in_use === 1 ? 'online' : ''}" style="background-color: ${v.in_use === 1 ? 'var(--success)' : 'var(--text-muted)'};"></span>
                    <span style="font-size: 0.8125rem;">${v.in_use === 1 ? 'Σε Χρήση' : 'Ανενεργό'}</span>
                    ${badgesHtml}
                </div>
            </td>
            <td class="actions-col col-actions">
                <div class="table-actions">
                    <button class="btn-icon-only" onclick="event.stopPropagation(); openVMModal(${v.id})" title="Επεξεργασία"><i data-lucide="edit-3"></i></button>
                    <button class="btn-icon-only text-danger" onclick="event.stopPropagation(); openDeleteModal('vm', ${v.id})" title="Διαγραφή"><i data-lucide="trash-2"></i></button>
                </div>
            </td>
        `;
        tbody.appendChild(row);
    });

    lucide.createIcons({ nodes: [tbody] });
}

// -------------------------------------------------------------
// Dynamic Rendering: Upgrades Tab & Quick Toggles
// -------------------------------------------------------------

function renderUpgradesTab() {
    const tbody = document.getElementById('upgrades-tbody');
    const summaryBadge = document.getElementById('upgrades-summary-badge');
    if (!tbody) return;

    // Show spinner if vms not yet loaded (null = initial state, [] = loaded but empty)
    if (state.vms === null) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-secondary" style="text-align: center; padding: 2.5rem;"><i data-lucide="loader-2" class="spin" style="margin-right: 0.5rem;"></i> Φόρτωση δεδομένων...</td></tr>`;
        if (summaryBadge) {
            summaryBadge.className = 'badge badge-info';
            summaryBadge.textContent = 'Φόρτωση...';
        }
        lucide.createIcons({ nodes: [tbody] });
        return;
    }

    tbody.innerHTML = '';

    const needingUpgrade = (state.vms || []).filter(v => Number(v.os_upgrade) === 1 || Number(v.app_upgrade) === 1);
    
    // Sort: Priority (is_important === 1) first, then alphabetical by name (Same as Dashboard!)
    needingUpgrade.sort((a, b) => (Number(b.is_important) || 0) - (Number(a.is_important) || 0) || (a.name || '').localeCompare(b.name || ''));

    if (summaryBadge) {
        summaryBadge.textContent = `${needingUpgrade.length} VMs προς αναβάθμιση`;
        if (needingUpgrade.length > 0) {
            summaryBadge.className = 'badge badge-warning';
        } else {
            summaryBadge.className = 'badge badge-success';
            summaryBadge.textContent = 'Όλα τα VMs είναι ενημερωμένα!';
        }
    }

    if (needingUpgrade.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-secondary" style="text-align: center; padding: 2.5rem;">✨ Δεν υπάρχουν εκκρεμείς αναβαθμίσεις! Όλα τα συστήματα είναι ενημερωμένα.</td></tr>`;
        return;
    }

    needingUpgrade.forEach(v => {
        const row = document.createElement('tr');
        row.classList.add('vm-table-row', 'clickable-row');
        row.setAttribute('title', 'Κάντε κλικ για προβολή / επεξεργασία VM');
        row.onclick = (e) => {
            if (e.target.closest('a') || e.target.closest('button') || e.target.closest('input') || e.target.closest('label')) return;
            openVMModal(v.id);
        };

        const specsText = `CPU: ${v.cpu} | RAM: ${v.ram} | Disk: ${v.disk}${v.extra_disk > 0 ? ' +' + v.extra_disk : ''}`;

        let importantBadge = '';
        if (v.is_important === 1) {
            importantBadge = '<span class="badge badge-danger" style="margin-left: 6px;">Important</span>';
        }

        row.innerHTML = `
            <td class="col-vm-info">
                <div class="vm-row-flex">
                    <div class="vm-main-details">
                        <div class="vm-name-title">
                            ${escapeHTML(v.name)}
                            ${importantBadge}
                        </div>
                        <div class="vm-url-sub">
                            ${v.url ? `<a href="${escapeHTML(v.url)}" target="_blank" onclick="event.stopPropagation();">${escapeHTML(v.url)}</a>` : '<span class="no-url-text">Χωρίς Domain</span>'}
                        </div>
                    </div>
                </div>
            </td>
            <td class="col-cluster"><span class="badge badge-info">${escapeHTML(v.cluster_name)}</span></td>
            <td class="col-specs"><span style="font-size:0.8125rem;">${specsText}</span></td>
            <td class="col-ipv4"><code style="font-size: 0.8125rem;">${escapeHTML(v.ipv4 || '-')}</code></td>
            <td style="text-align: center;" onclick="event.stopPropagation();">
                <label class="switch switch-small" title="Αναβάθμιση Λειτουργικού (OS)" onclick="event.stopPropagation();">
                    <input type="checkbox" ${Number(v.os_upgrade) === 1 ? 'checked' : ''} onchange="toggleVMUpgrade(${v.id}, 'os_upgrade', this.checked)">
                    <span class="slider"></span>
                </label>
            </td>
            <td style="text-align: center;" onclick="event.stopPropagation();">
                <label class="switch switch-small" title="Αναβάθμιση Λογισμικού (Software)" onclick="event.stopPropagation();">
                    <input type="checkbox" ${Number(v.app_upgrade) === 1 ? 'checked' : ''} onchange="toggleVMUpgrade(${v.id}, 'app_upgrade', this.checked)">
                    <span class="slider"></span>
                </label>
            </td>
        `;
        tbody.appendChild(row);
    });

    lucide.createIcons({ nodes: [tbody] });
}

function toggleVMUpgrade(vmId, field, isChecked) {
    const vm = (state.vms || []).find(v => v.id === vmId);
    if (!vm) return;

    const newVal = isChecked ? 1 : 0;
    const patch = {};
    patch[field] = newVal;

    fetch(`/api/vms/${vmId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
    })
    .then(async res => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Σφάλμα κατά την ενημέρωση');
        
        vm.os_upgrade = Number(data.os_upgrade);
        vm.app_upgrade = Number(data.app_upgrade);

        renderUpgradesTab();
        renderDashboard();
        if (typeof renderVMs === 'function') renderVMs();
        showToast('Η κατάσταση αναβάθμισης ενημερώθηκε επιτυχώς', 'success');
        fetchStats();
    })
    .catch(err => {
        renderUpgradesTab();
        showToast(err.message || 'Αποτυχία ενημέρωσης στη βάση', 'error');
    });
}

// -------------------------------------------------------------
// Modals Open/Close/Save: Clusters
// -------------------------------------------------------------

function openClusterModal(id = null) {
    const _trigger = document.activeElement;
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
    openFocusTrap(modal.querySelector('.modal-box'), _trigger);
}

function closeClusterModal() {
    closeFocusTrap();
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
    .catch(err => showToast(err.message, 'error'));
}

// -------------------------------------------------------------
// Modals Open/Close/Save: VMs
// -------------------------------------------------------------

function openVMModal(id = null) {
    const _trigger = document.activeElement;
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
                document.getElementById('vm-vpn').checked = v.vpn === 1;
                document.getElementById('vm-backup').value = v.backup || '';
                document.getElementById('vm-contact').value = v.contact_person || '';
                document.getElementById('vm-desc').value = v.description || '';

                document.getElementById('vm-in-use').checked = v.in_use === 1;
                document.getElementById('vm-is-important').checked = v.is_important === 1;
                document.getElementById('vm-ansible').checked = v.ansible === 1;
                document.getElementById('vm-docker').checked = v.docker === 1;
                document.getElementById('vm-monitored').checked = v.monitored === 1;
                document.getElementById('vm-os-upgrade').checked = v.os_upgrade === 1;
                document.getElementById('vm-app-upgrade').checked = v.app_upgrade === 1;
                
                modal.classList.remove('hidden');
                openFocusTrap(modal.querySelector('.modal-box'), _trigger);
            })
            .catch(err => showToast('Αποτυχία φόρτωσης VM: ' + err.message, 'error'));
    } else {
        title.textContent = 'Καταγραφή Νέου Virtual Machine';
        
        document.getElementById('vm-vpn').checked = false;
        document.getElementById('vm-ansible').checked = false;
        document.getElementById('vm-docker').checked = false;
        document.getElementById('vm-os-upgrade').checked = false;
        document.getElementById('vm-app-upgrade').checked = false;

        // Pre-select active cluster filter if any
        const activeClusterFilter = document.getElementById('filter-cluster').value;
        if (activeClusterFilter) {
            document.getElementById('vm-cluster-id').value = activeClusterFilter;
        }
        
        modal.classList.remove('hidden');
        openFocusTrap(modal.querySelector('.modal-box'), _trigger);
    }
}

function closeVMModal() {
    closeFocusTrap();
    document.getElementById('vm-modal').classList.add('hidden');
}

function saveVM(e) {
    if (e) e.preventDefault();
    const id = document.getElementById('vm-id').value;
    
    const clusterIdVal = document.getElementById('vm-cluster-id').value;
    const nameVal = document.getElementById('vm-name').value.trim();

    const switchModalTab = (tabId) => {
        document.querySelectorAll('.modal-tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.modal-tab-content').forEach(c => c.classList.remove('active'));
        const tabBtn = document.querySelector(`[data-modaltab="${tabId}"]`);
        const tabContent = document.getElementById(tabId);
        if (tabBtn) tabBtn.classList.add('active');
        if (tabContent) tabContent.classList.add('active');
    };

    if (!clusterIdVal) {
        switchModalTab('vm-tab-basic');
        showToast('Παρακαλώ επιλέξτε Cluster', 'error');
        document.getElementById('vm-cluster-id').focus();
        return;
    }

    if (!nameVal) {
        switchModalTab('vm-tab-basic');
        showToast('Παρακαλώ συμπληρώστε το Όνομα VM', 'error');
        document.getElementById('vm-name').focus();
        return;
    }

    // Numeric specs validation & parsing
    const parseNumber = (val) => {
        const num = parseFloat(val);
        return isNaN(num) ? 0 : num;
    };

    const payload = {
        cluster_id: parseInt(clusterIdVal),
        name: nameVal,
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
        backup: document.getElementById('vm-backup').value.trim(),
        contact_person: document.getElementById('vm-contact').value.trim(),
        description: document.getElementById('vm-desc').value.trim(),

        in_use: document.getElementById('vm-in-use').checked ? 1 : 0,
        is_important: document.getElementById('vm-is-important').checked ? 1 : 0,
        ansible: document.getElementById('vm-ansible').checked ? 1 : 0,
        docker: document.getElementById('vm-docker').checked ? 1 : 0,
        monitored: document.getElementById('vm-monitored').checked ? 1 : 0,
        vpn: document.getElementById('vm-vpn').checked ? 1 : 0,
        os_upgrade: document.getElementById('vm-os-upgrade').checked ? 1 : 0,
        app_upgrade: document.getElementById('vm-app-upgrade').checked ? 1 : 0
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
        showToast('Το VM αποθηκεύτηκε επιτυχώς', 'success');
        fetchVMs();
        fetchStats();
    })
    .catch(err => showToast(err.message, 'error'));
}

// -------------------------------------------------------------
// Confirmation Delete Modal
// -------------------------------------------------------------

function openDeleteModal(type, id) {
    const _trigger = document.activeElement;
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
    lucide.createIcons({ nodes: [modal.querySelector('.modal-box')] });
    openFocusTrap(modal.querySelector('.modal-box'), _trigger);
}

function closeDeleteModal() {
    closeFocusTrap();
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
            showToast(err.message, 'error');
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

    lucide.createIcons({ nodes: [tbody] });
}

function openDNSModal(id = null) {
    const _trigger = document.activeElement;
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
    openFocusTrap(modal.querySelector('.modal-box'), _trigger);
}

function closeDNSModal() {
    closeFocusTrap();
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
    .catch(err => showToast(err.message, 'error'));
}

function openDNSImportModal() {
    const _trigger = document.activeElement;
    const modal = document.getElementById('dns-import-modal');
    const form = document.getElementById('dns-import-form');
    const alertBox = document.getElementById('dns-import-alert');
    form.reset();
    alertBox.classList.add('hidden');
    modal.classList.remove('hidden');
    openFocusTrap(modal.querySelector('.modal-box'), _trigger);
}

function closeDNSImportModal() {
    closeFocusTrap();
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
        showToast('Παρακαλώ επιλέξτε αρχείο zonefile ή επικολλήστε περιεχόμενο.', 'error');
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

function normalizeHost(str) {
    if (!str) return '';
    let s = str.trim().toLowerCase();
    s = s.replace(/^https?:\/\//, '');
    s = s.replace(/[\/\?#].*$/, '');
    s = s.replace(/:\d+$/, '');
    s = s.replace(/^www\./, '');
    s = s.replace(/\.$/, '');
    return s.trim();
}

function normalizeIP(ip) {
    if (!ip) return '';
    return ip.trim().toLowerCase();
}

function extractHostsFromURL(urlStr) {
    if (!urlStr) return [];
    const parts = urlStr.split(/[\s,;]+/);
    const hosts = [];
    parts.forEach(p => {
        const h = normalizeHost(p);
        if (h) hosts.push(h);
    });
    return hosts;
}

function isDNSRecordMatchedToVM(r, vms) {
    if (!vms || !Array.isArray(vms)) return false;

    const dnsValIP = normalizeIP(r.value);
    const dnsNameHost = normalizeHost(r.name);
    const dnsValHost = normalizeHost(r.value);

    for (const v of vms) {
        const vmIPv4 = normalizeIP(v.ipv4);
        const vmIPv6 = normalizeIP(v.ipv6);

        // 1. Primary Check: IP Matching (for A records or IP targets)
        if (dnsValIP && ((vmIPv4 && dnsValIP === vmIPv4) || (vmIPv6 && dnsValIP === vmIPv6))) {
            return true;
        }

        // 2. Secondary Check: Domain / Hostname Matching against VM URL
        const vmHosts = extractHostsFromURL(v.url);
        for (const vmHost of vmHosts) {
            if (!vmHost) continue;
            // Match DNS record name with VM URL domain
            if (dnsNameHost && (dnsNameHost === vmHost || dnsNameHost.endsWith('.' + vmHost) || vmHost.endsWith('.' + dnsNameHost))) {
                return true;
            }
            // Match CNAME target value with VM URL domain
            if (r.type === 'CNAME' && dnsValHost && (dnsValHost === vmHost || dnsValHost.endsWith('.' + vmHost) || vmHost.endsWith('.' + dnsValHost))) {
                return true;
            }
        }
    }

    return false;
}

function isVMMatchedToDNS(v, dnsRecords) {
    if (!dnsRecords || !Array.isArray(dnsRecords)) return false;

    const vmIPv4 = normalizeIP(v.ipv4);
    const vmIPv6 = normalizeIP(v.ipv6);
    const vmHosts = extractHostsFromURL(v.url);

    for (const r of dnsRecords) {
        const dnsValIP = normalizeIP(r.value);
        const dnsNameHost = normalizeHost(r.name);
        const dnsValHost = normalizeHost(r.value);

        // Match IP
        if (dnsValIP && ((vmIPv4 && dnsValIP === vmIPv4) || (vmIPv6 && dnsValIP === vmIPv6))) {
            return true;
        }

        // 2. Secondary Check: Domain / Host Match
        for (const vmHost of vmHosts) {
            if (!vmHost) continue;
            if (dnsNameHost && (vmHost === dnsNameHost || dnsNameHost.endsWith('.' + vmHost) || vmHost.endsWith('.' + dnsNameHost))) {
                return true;
            }
            if (r.type === 'CNAME' && dnsValHost && (vmHost === dnsValHost || dnsValHost.endsWith('.' + vmHost) || vmHost.endsWith('.' + dnsValHost))) {
                return true;
            }
        }


    }

    return false;
}

function applyReportPreset(preset, btnElem) {
    // Reset all filter options
    document.getElementById('report-cluster').value = '';
    document.getElementById('report-in-use').value = '';
    document.getElementById('report-important').value = '';
    document.getElementById('report-ansible').value = '';
    document.getElementById('report-docker').value = '';
    
    // Toggle active classes on preset buttons
    document.querySelectorAll('.presets-row .btn').forEach(btn => {
        btn.classList.remove('active');
    });

    if (btnElem) {
        btnElem.classList.add('active');
    }

    // Apply specific preset configurations
    if (preset === 'ansible-vms') {
        document.getElementById('report-ansible').value = '1';
    } else if (preset === 'docker-vms') {
        document.getElementById('report-docker').value = '1';
    } else if (preset === 'unmonitored') {
        document.getElementById('report-important').value = '';
    }
    
    state.activeReportPreset = preset;
    runReport();
}

function runReport() {
    const clusterId = document.getElementById('report-cluster').value;
    const inUse = document.getElementById('report-in-use').value;
    const important = document.getElementById('report-important').value;
    const ansible = document.getElementById('report-ansible').value;
    const docker = document.getElementById('report-docker').value;

    if (state.activeReportPreset === 'unmatched-dns') {
        Promise.all([
            fetch('/api/vms').then(r => r.json()),
            fetch('/api/dns').then(r => r.json())
        ])
        .then(([vms, dnsRecords]) => {
            const unmatchedDNS = (dnsRecords || []).filter(r => !isDNSRecordMatchedToVM(r, vms || []));
            renderUnmatchedDNSTable(unmatchedDNS);
        })
        .catch(err => console.error("Error running unmatched DNS report:", err));
        return;
    }

    if (state.activeReportPreset === 'unmatched-vms') {
        Promise.all([
            fetch('/api/vms').then(r => r.json()),
            fetch('/api/dns').then(r => r.json())
        ])
        .then(([vms, dnsRecords]) => {
            let unmatchedVMs = (vms || []).filter(v => !isVMMatchedToDNS(v, dnsRecords || []));
            
            if (clusterId) unmatchedVMs = unmatchedVMs.filter(v => v.cluster_id === parseInt(clusterId));
            if (inUse !== '') unmatchedVMs = unmatchedVMs.filter(v => v.in_use === parseInt(inUse));
            if (important !== '') unmatchedVMs = unmatchedVMs.filter(v => v.is_important === parseInt(important));
            if (ansible !== '') unmatchedVMs = unmatchedVMs.filter(v => v.ansible === parseInt(ansible));
            if (docker !== '') unmatchedVMs = unmatchedVMs.filter(v => v.docker === parseInt(docker));

            renderUnmatchedVMsTable(unmatchedVMs);
        })
        .catch(err => console.error("Error running unmatched VMs report:", err));
        return;
    }

    let queryParams = [];
    if (clusterId) queryParams.push(`cluster_id=${clusterId}`);
    if (inUse !== '') queryParams.push(`in_use=${inUse}`);
    if (important !== '') queryParams.push(`is_important=${important}`);

    const url = '/api/vms' + (queryParams.length ? '?' + queryParams.join('&') : '');

    fetch(url)
        .then(res => res.json())
        .then(data => {
            let vms = data || [];
            
            if (state.activeReportPreset === 'unmonitored') {
                vms = vms.filter(v => v.monitored === 0);
            }
            if (ansible !== '') {
                vms = vms.filter(v => v.ansible === parseInt(ansible));
            }
            if (docker !== '') {
                vms = vms.filter(v => v.docker === parseInt(docker));
            }

            renderReportTable(vms);
        })
        .catch(err => console.error("Error running report:", err));
}

function renderUnmatchedDNSTable(records) {
    const thead = document.querySelector('#report-table thead');
    const tbody = document.getElementById('reports-tbody');
    const resultsTitle = document.getElementById('report-results-title');
    const resultsCount = document.getElementById('report-results-count');

    resultsTitle.textContent = 'Εγγραφές DNS Χωρίς VM';
    resultsCount.textContent = `${records.length} Εγγραφές DNS`;

    thead.innerHTML = `
        <tr>
            <th>Domain / Hostname</th>
            <th>Τύπος</th>
            <th>Τιμή (IP / Target)</th>
            <th>Αιτιολογία Ελέγχου</th>
            <th>Κατάσταση</th>
            <th class="actions-col">Ενέργειες</th>
        </tr>
    `;

    tbody.innerHTML = '';

    if (records.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-secondary" style="text-align: center; padding: 2rem;">Όλες οι εγγραφές DNS αντιστοιχούν σε κάποιο Virtual Machine!</td></tr>`;
        return;
    }

    records.forEach(r => {
        const row = document.createElement('tr');
        row.classList.add('dns-table-row', 'clickable-row');
        row.setAttribute('title', 'Κάντε κλικ για επεξεργασία DNS');
        row.onclick = (e) => {
            if (e.target.closest('a') || e.target.closest('button')) return;
            openDNSModal(r.id);
        };
        row.innerHTML = `
            <td class="col-dns-info">
                <div class="vm-row-flex">
                    <div class="vm-main-details">
                        <div class="vm-name-title">${escapeHTML(r.name)}</div>
                        <div class="vm-url-sub"><code>${escapeHTML(r.value)}</code> (${r.type})</div>
                    </div>
                    <div class="mobile-chevron-icon">
                        <i data-lucide="chevron-right"></i>
                    </div>
                </div>
            </td>
            <td><span class="badge ${r.type === 'A' ? 'badge-info' : 'badge-warning'}">${escapeHTML(r.type)}</span></td>
            <td><code>${escapeHTML(r.value)}</code></td>
            <td><span style="font-size:0.8125rem; color:var(--text-secondary);">Δεν βρέθηκε VM με αυτή την IP ή URL</span></td>
            <td><span class="badge badge-warning">Χωρίς VM</span></td>
            <td class="actions-col">
                <button class="btn-icon-only text-danger" onclick="event.stopPropagation(); openDeleteModal('dns', ${r.id})" title="Διαγραφή Εγγραφής DNS"><i data-lucide="trash-2"></i></button>
            </td>
        `;
        tbody.appendChild(row);
    });

    lucide.createIcons({ nodes: [tbody] });
    state.currentReportData = records;
}

function renderUnmatchedVMsTable(vms) {
    const thead = document.querySelector('#report-table thead');
    const tbody = document.getElementById('reports-tbody');
    const resultsTitle = document.getElementById('report-results-title');
    const resultsCount = document.getElementById('report-results-count');

    resultsTitle.textContent = 'Virtual Machines Χωρίς Εγγραφή DNS';
    resultsCount.textContent = `${vms.length} VMs`;

    thead.innerHTML = `
        <tr>
            <th>Όνομα VM</th>
            <th>Cluster</th>
            <th>IPv4 / IPv6</th>
            <th>URL / Domain</th>
            <th>Κατάσταση</th>
            <th class="actions-col">Ενέργειες</th>
        </tr>
    `;

    tbody.innerHTML = '';

    if (vms.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-secondary" style="text-align: center; padding: 2rem;">Όλα τα Virtual Machines αντιστοιχούν σε κάποια εγγραφή DNS!</td></tr>`;
        return;
    }

    vms.forEach(v => {
        const row = document.createElement('tr');
        row.classList.add('vm-table-row', 'clickable-row');
        row.setAttribute('title', 'Κάντε κλικ για προβολή / επεξεργασία VM');
        row.onclick = (e) => {
            if (e.target.closest('a') || e.target.closest('button')) return;
            openVMModal(v.id);
        };
        row.innerHTML = `
            <td class="col-vm-info">
                <div class="vm-row-flex">
                    <div class="vm-main-details">
                        <div class="vm-name-title">${escapeHTML(v.name)}</div>
                        <div class="vm-url-sub">${v.url ? `<a href="${escapeHTML(v.url)}" target="_blank" onclick="event.stopPropagation();">${escapeHTML(v.url)}</a>` : '<span class="no-url-text">Χωρίς Domain</span>'}</div>
                    </div>
                    <div class="mobile-chevron-icon">
                        <i data-lucide="chevron-right"></i>
                    </div>
                </div>
            </td>
            <td><span class="badge badge-info">${escapeHTML(v.cluster_name)}</span></td>
            <td><code>${escapeHTML(v.ipv4 || v.ipv6 || '-')}</code></td>
            <td><span style="font-size:0.8125rem;">${v.url ? `<a href="${escapeHTML(v.url)}" target="_blank" onclick="event.stopPropagation();">${escapeHTML(v.url)}</a>` : '-'}</span></td>
            <td><span class="badge badge-warning">Χωρίς DNS</span></td>
            <td class="actions-col">
                <button class="btn-icon-only text-danger" onclick="event.stopPropagation(); openDeleteModal('vm', ${v.id})" title="Διαγραφή VM"><i data-lucide="trash-2"></i></button>
            </td>
        `;
        tbody.appendChild(row);
    });

    lucide.createIcons({ nodes: [tbody] });
    state.currentReportData = vms;
}

function renderReportTable(vms) {
    const thead = document.querySelector('#report-table thead');
    const tbody = document.getElementById('reports-tbody');
    
    thead.innerHTML = `
        <tr>
            <th>Όνομα VM</th>
            <th>Cluster</th>
            <th>Specs</th>
            <th>IPv4</th>
            <th>VPN / Backup</th>
            <th>Σε Χρήση</th>
            <th>Σημαντικό</th>
            <th>Docker / Ansible</th>
        </tr>
    `;

    tbody.innerHTML = '';
    
    document.getElementById('report-results-count').textContent = `${vms.length} VMs`;

    const resultsTitle = document.getElementById('report-results-title');
    if (state.activeReportPreset === 'ansible-vms') {
        resultsTitle.textContent = 'Virtual Machines Διαχειριζόμενα μέσω Ansible';
    } else if (state.activeReportPreset === 'docker-vms') {
        resultsTitle.textContent = 'Virtual Machines με Εγκατάσταση Docker';
    } else if (state.activeReportPreset === 'unmonitored') {
        resultsTitle.textContent = 'VMs Χωρίς Επίβλεψη (Unmonitored)';
    } else {
        resultsTitle.textContent = 'Καταγραφή VMs (Πλήρης Αναφορά)';
    }

    if (vms.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-secondary" style="text-align: center; padding: 2rem;">Δεν βρέθηκαν αποτελέσματα για αυτή την αναφορά.</td></tr>`;
        return;
    }

    vms.forEach(v => {
        const row = document.createElement('tr');
        row.classList.add('vm-table-row', 'clickable-row');
        row.setAttribute('title', 'Κάντε κλικ για προβολή / επεξεργασία VM');
        row.onclick = (e) => {
            if (e.target.closest('a') || e.target.closest('button')) return;
            openVMModal(v.id);
        };
        row.innerHTML = `
            <td class="col-vm-info">
                <div class="vm-row-flex">
                    <div class="vm-main-details">
                        <div class="vm-name-title">${escapeHTML(v.name)}</div>
                        <div class="vm-url-sub">${v.url ? `<a href="${escapeHTML(v.url)}" target="_blank" onclick="event.stopPropagation();">${escapeHTML(v.url)}</a>` : '<span class="no-url-text">Χωρίς Domain</span>'}</div>
                    </div>
                    <div class="mobile-chevron-icon">
                        <i data-lucide="chevron-right"></i>
                    </div>
                </div>
            </td>
            <td><span class="badge badge-info">${escapeHTML(v.cluster_name)}</span></td>
            <td><span style="font-size:0.75rem;">CPU: ${v.cpu} | RAM: ${v.ram} | Disk: ${v.disk}</span></td>
            <td><code>${escapeHTML(v.ipv4 || '-')}</code></td>
            <td>
                <div style="font-size: 0.75rem;">
                    <div>VPN: ${v.vpn === 1 ? 'Ναι' : 'Όχι'}</div>
                    <div>Backup: ${escapeHTML(v.backup || 'Όχι')}</div>
                </div>
            </td>
            <td><span class="badge ${v.in_use === 1 ? 'badge-success' : 'badge-danger'}">${v.in_use === 1 ? 'Ναι' : 'Όχι'}</span></td>
            <td><span class="badge ${v.is_important === 1 ? 'badge-danger' : 'badge-info'}">${v.is_important === 1 ? 'Ναι' : 'Όχι'}</span></td>
            <td>
                <div style="display:flex; gap:4px; flex-wrap:wrap;">
                    <span class="badge ${v.docker === 1 ? 'badge-primary' : 'badge-secondary'}" style="${v.docker === 0 ? 'opacity:0.6;' : ''}">Docker: ${v.docker === 1 ? 'Ναι' : 'Όχι'}</span>
                    <span class="badge ${v.ansible === 1 ? 'badge-info' : 'badge-secondary'}" style="${v.ansible === 0 ? 'opacity:0.6;' : ''}">Ansible: ${v.ansible === 1 ? 'Ναι' : 'Όχι'}</span>
                </div>
            </td>
        `;
        tbody.appendChild(row);
    });

    lucide.createIcons({ nodes: [tbody] });


    state.currentReportData = vms;
}

function exportReportCSV() {
    if (state.activeReportPreset === 'unmatched-dns' || state.activeReportPreset === 'unmatched-vms') {
        const items = state.currentReportData || [];
        if (items.length === 0) {
            showToast('Δεν υπάρχουν δεδομένα προς εξαγωγή.', 'error');
            return;
        }
        let csvContent = 'data:text/csv;charset=utf-8,\uFEFF';
        if (state.activeReportPreset === 'unmatched-dns') {
            csvContent += 'Domain / Hostname,Type,Value,Audit Status\n';
            items.forEach(r => {
                csvContent += `"${r.name}","${r.type}","${r.value}","Unmatched DNS - Candidate for Deletion"\n`;
            });
        } else {
            csvContent += 'VM Name,Cluster,IPv4,IPv6,URL,Audit Status\n';
            items.forEach(v => {
                csvContent += `"${v.name}","${v.cluster_name}","${v.ipv4 || ''}","${v.ipv6 || ''}","${v.url || ''}","Unmatched VM - Candidate for Deletion"\n`;
            });
        }
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement('a');
        link.setAttribute('href', encodedUri);
        link.setAttribute('download', `report_${state.activeReportPreset}_${new Date().toISOString().slice(0,10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        return;
    }

    const clusterId = document.getElementById('report-cluster').value;
    const inUse = document.getElementById('report-in-use').value;
    const important = document.getElementById('report-important').value;
    
    let queryParams = [];
    if (clusterId) queryParams.push(`cluster_id=${clusterId}`);
    if (inUse !== '') queryParams.push(`in_use=${inUse}`);
    if (important !== '') queryParams.push(`is_important=${important}`);
    
    const url = '/api/export/csv' + (queryParams.length ? '?' + queryParams.join('&') : '');
    window.open(url, '_blank');
}

function printReport() {
    window.print();
}

function openVMImportModal() {
    const _trigger = document.activeElement;
    const modal = document.getElementById('vm-import-modal');
    const form = document.getElementById('vm-import-form');
    const alertBox = document.getElementById('vm-import-alert');
    form.reset();
    alertBox.classList.add('hidden');
    modal.classList.remove('hidden');
    openFocusTrap(modal.querySelector('.modal-box'), _trigger);
}

function closeVMImportModal() {
    closeFocusTrap();
    document.getElementById('vm-import-modal').classList.add('hidden');
}

function submitVMImport(e) {
    e.preventDefault();
    const fileInput = document.getElementById('vm-file-input');
    const pasteInput = document.getElementById('vm-paste-input').value.trim();
    const alertBox = document.getElementById('vm-import-alert');

    const handleSuccess = (data) => {
        alertBox.className = 'alert alert-success';
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
    const _trigger = document.activeElement;
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
            openFocusTrap(modal.querySelector('.modal-box'), _trigger);
        })
        .catch(err => {
            showToast('Σφάλμα: ' + err.message, 'error');
        });
}

function closeProfileModal() {
    closeFocusTrap();
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

// -------------------------------------------------------------
// Toast Notification System
// -------------------------------------------------------------

function showToast(message, type = 'info', duration = 4000) {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        container.setAttribute('aria-live', 'polite');
        container.setAttribute('aria-atomic', 'false');
        document.body.appendChild(container);
    }

    const iconMap = { success: 'check-circle', error: 'alert-circle', info: 'info' };

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.setAttribute('role', 'status');
    toast.innerHTML = `
        <i data-lucide="${iconMap[type] || 'info'}" class="toast-icon"></i>
        <span class="toast-content">${escapeHTML(message)}</span>
        <button class="toast-close" aria-label="Κλείσιμο ειδοποίησης">
            <i data-lucide="x"></i>
        </button>
    `;

    const dismiss = () => {
        toast.classList.add('toast-exit');
        toast.addEventListener('animationend', () => toast.remove(), { once: true });
    };

    toast.querySelector('.toast-close').addEventListener('click', dismiss);
    container.appendChild(toast);
    lucide.createIcons({ nodes: [toast] });

    if (duration > 0) setTimeout(dismiss, duration);
}

// -------------------------------------------------------------
// Utility: Debounce
// -------------------------------------------------------------

function debounce(fn, delay = 300) {
    let timer;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

// -------------------------------------------------------------
// Utility: Focus Trap (WCAG 2.1.2)
// Captures focus inside a modal and returns it to the trigger
// element when the modal closes.
// -------------------------------------------------------------

let _focusTrap = null;

const FOCUSABLE = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
].join(',');

function openFocusTrap(dialogEl, triggerEl) {
    if (!dialogEl) return;

    // Remove any previous trap
    closeFocusTrap();

    const getFocusable = () =>
        [...dialogEl.querySelectorAll(FOCUSABLE)].filter(
            el => !el.closest('.hidden') && getComputedStyle(el).display !== 'none'
        );

    const handler = (e) => {
        if (e.key !== 'Tab') return;
        const els = getFocusable();
        if (els.length === 0) return;
        const first = els[0];
        const last  = els[els.length - 1];
        if (e.shiftKey) {
            if (document.activeElement === first) { e.preventDefault(); last.focus(); }
        } else {
            if (document.activeElement === last)  { e.preventDefault(); first.focus(); }
        }
    };

    dialogEl.addEventListener('keydown', handler);
    _focusTrap = { dialogEl, triggerEl, handler };

    // Move focus to first focusable element on next frame
    requestAnimationFrame(() => {
        const els = getFocusable();
        if (els.length > 0) els[0].focus();
    });
}

function closeFocusTrap() {
    if (!_focusTrap) return;
    _focusTrap.dialogEl.removeEventListener('keydown', _focusTrap.handler);
    const trigger = _focusTrap.triggerEl;
    _focusTrap = null;
    if (trigger && typeof trigger.focus === 'function') {
        requestAnimationFrame(() => trigger.focus());
    }
}
