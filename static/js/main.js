import { state, defaultFields } from './state.js';
import { escapeHTML, debounce, togglePasswordVisibility, showAlert, showToast } from './utils.js';
import { renderStatsDashboard, renderClusters, populateClusterDropdowns } from './views/dashboard.js';
import { renderVMs, renderUpgradesTab, toggleVMUpgrade } from './views/vms.js';
import { fetchDNSRecords, renderDNSRecords, sortDNSTable, linkDNSToVM } from './views/dns.js';
import { runReport, applyReportPreset, exportReportCSV, printReport } from './views/reports.js';
import {
    openClusterModal, closeClusterModal, saveCluster,
    openVMModal, closeVMModal, saveVM,
    openDeleteModal, closeDeleteModal, confirmDeletion,
    openDNSModal, closeDNSModal, saveDNSRecord,
    openDNSImportModal, closeDNSImportModal, submitDNSImport,
    openVMImportModal, closeVMImportModal, submitVMImport,
    openProfileModal, closeProfileModal, submitProfileUpdate
} from './modals.js';

// --- Authentication & Setup Flows ---

export function checkAuthStatus() {
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

export function updateAuthUI() {
    const overlay = document.getElementById('auth-overlay');
    const appContainer = document.getElementById('app-container');
    const confirmGroup = document.getElementById('auth-confirm-group');
    const submitBtn = document.getElementById('auth-submit-btn');
    const title = document.getElementById('auth-title');
    const subtitle = document.getElementById('auth-subtitle');

    if (!state.setupCompleted) {
        overlay.classList.remove('hidden');
        appContainer.classList.add('hidden');
        confirmGroup.classList.remove('hidden');
        document.getElementById('auth-confirm-password').setAttribute('required', 'true');
        title.textContent = 'Αρχική Ρύθμιση InfraAtlas';
        subtitle.textContent = 'Δημιουργήστε τον πρώτο λογαριασμό διαχειριστή για να ξεκινήσετε.';
        submitBtn.innerHTML = `<span>Δημιουργία & Είσοδος</span><i data-lucide="shield-check"></i>`;
        if (window.lucide) window.lucide.createIcons({ nodes: [submitBtn] });
    } else if (!state.loggedIn) {
        overlay.classList.remove('hidden');
        appContainer.classList.add('hidden');
        confirmGroup.classList.add('hidden');
        document.getElementById('auth-confirm-password').removeAttribute('required');
        title.textContent = 'Σύνδεση στο InfraAtlas';
        subtitle.textContent = 'Παρακαλώ εισάγετε τα στοιχεία σας.';
        submitBtn.innerHTML = `<span>Είσοδος</span><i data-lucide="log-in"></i>`;
        if (window.lucide) window.lucide.createIcons({ nodes: [submitBtn] });
    } else {
        overlay.classList.add('hidden');
        appContainer.classList.remove('hidden');
        
        const username = document.getElementById('auth-username').value || 'Admin';
        document.getElementById('user-display-name').textContent = username;
        document.getElementById('user-avatar-char').textContent = username.substring(0, 1).toUpperCase();
    }
}

export function sendAuthRequest(url, payload) {
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

// --- App Initialization & Tab Navigation ---

export function initializeDashboard() {
    let hash = window.location.hash.substring(1);
    if (!['dashboard', 'clusters', 'vms', 'dns', 'upgrades', 'reports', 'settings'].includes(hash)) {
        hash = 'dashboard';
    }
    
    switchTab(hash);
    
    loadUserProfile();
    fetchSettings();
    fetchStats();
    fetchClusters();
    fetchVMs();
    fetchDNSRecords();
    
    setInterval(fetchStats, 60000);
}

export function openMobileSidebar() {
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    if (sidebar) sidebar.classList.add('mobile-open');
    if (backdrop) {
        backdrop.classList.remove('hidden');
        setTimeout(() => backdrop.classList.add('active'), 10);
    }
}

export function closeMobileSidebar() {
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    if (sidebar) sidebar.classList.remove('mobile-open');
    if (backdrop) {
        backdrop.classList.remove('active');
        setTimeout(() => backdrop.classList.add('hidden'), 300);
    }
}

export function switchTab(tabId) {
    state.activeTab = tabId;
    closeMobileSidebar();
    
    document.querySelectorAll('.menu-item').forEach(item => {
        if (item.getAttribute('data-tab') === tabId) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });

    document.querySelectorAll('.tab-pane').forEach(pane => {
        if (pane.id === `tab-${tabId}`) {
            pane.classList.add('active');
        } else {
            pane.classList.remove('active');
        }
    });

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

// --- Data Fetching APIs ---

export function fetchSettings() {
    fetch('/api/settings')
        .then(res => res.json())
        .then(data => {
            state.settings = data;
            applySettingsToUI();
        })
        .catch(err => console.error("Error loading settings:", err));
}

export function fetchStats() {
    fetch('/api/stats')
        .then(res => res.json())
        .then(data => {
            state.stats = data;
            renderStatsDashboard();
        })
        .catch(err => console.error("Error loading statistics:", err));
}

export function fetchClusters() {
    fetch('/api/clusters')
        .then(res => res.json())
        .then(data => {
            state.clusters = data || [];
            renderClusters();
            populateClusterDropdowns();
        })
        .catch(err => console.error("Error loading clusters:", err));
}

export function fetchVMs() {
    return fetch('/api/vms?t=' + Date.now())
        .then(res => res.json())
        .then(data => {
            state.vms = data || [];
            state.vmsLoaded = true;
            try { renderVMs(); } catch (e) { console.error("Error in renderVMs:", e); }
            try { renderStatsDashboard(); } catch (e) { console.error("Error in renderStatsDashboard:", e); }
            try { renderUpgradesTab(); } catch (e) { console.error("Error in renderUpgradesTab:", e); }
        })
        .catch(err => console.error("Error loading VMs:", err));
}

export function applySettingsToUI() {
    const capCpu = document.getElementById('setting-capacity_cpu');
    const capRam = document.getElementById('setting-capacity_ram');
    const capDisk = document.getElementById('setting-capacity_disk');
    const capIps = document.getElementById('setting-capacity_ips');

    if (capCpu) capCpu.value = state.settings.capacity_cpu || '';
    if (capRam) capRam.value = state.settings.capacity_ram || '';
    if (capDisk) capDisk.value = state.settings.capacity_disk || '';
    if (capIps) capIps.value = state.settings.capacity_ips || '';

    defaultFields.forEach(field => {
        const toggle = document.getElementById(`field-${field}`);
        if (toggle) {
            const isVisible = state.settings[field] !== '0';
            toggle.checked = isVisible;
        }
    });

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

export function saveSettings(e) {
    if (e) e.preventDefault();
    const payload = {};
    
    const capCpu = document.getElementById('setting-capacity_cpu');
    const capRam = document.getElementById('setting-capacity_ram');
    const capDisk = document.getElementById('setting-capacity_disk');
    const capIps = document.getElementById('setting-capacity_ips');

    if (capCpu) payload['capacity_cpu'] = capCpu.value.trim();
    if (capRam) payload['capacity_ram'] = capRam.value.trim();
    if (capDisk) payload['capacity_disk'] = capDisk.value.trim();
    if (capIps) payload['capacity_ips'] = capIps.value.trim();

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
    .then(() => {
        state.settings = payload;
        applySettingsToUI();
        fetchStats();
        showToast('Οι ρυθμίσεις αποθηκεύτηκαν με επιτυχία!', 'success');
    })
    .catch(err => showToast('Αποτυχία αποθήκευσης ρυθμίσεων: ' + err.message, 'error'));
}

export function loadUserProfile() {
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

export function setupEventListeners() {
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const closeSidebarBtn = document.getElementById('close-sidebar-btn');
    const sidebarBackdrop = document.getElementById('sidebar-backdrop');

    if (mobileMenuBtn) {
        mobileMenuBtn.addEventListener('click', openMobileSidebar);
    }
    if (closeSidebarBtn) {
        closeSidebarBtn.addEventListener('click', closeMobileSidebar);
    }
    if (sidebarBackdrop) {
        sidebarBackdrop.addEventListener('click', closeMobileSidebar);
    }

    window.addEventListener('resize', () => {
        if (window.innerWidth > 992) {
            closeMobileSidebar();
        }
    });

    document.querySelectorAll('.menu-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const tab = item.getAttribute('data-tab');
            window.location.hash = tab;
            switchTab(tab);
        });
    });

    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            closeMobileSidebar();
            fetch('/api/auth/logout', { method: 'POST' })
                .then(() => {
                    state.loggedIn = false;
                    updateAuthUI();
                    window.location.hash = '';
                })
                .catch(err => console.error("Logout failed:", err));
        });
    }

    const authForm = document.getElementById('auth-form');
    if (authForm) {
        authForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const username = document.getElementById('auth-username').value.trim();
            const password = document.getElementById('auth-password').value;
            const alertBox = document.getElementById('auth-alert');
            
            alertBox.classList.add('hidden');

            if (!state.setupCompleted) {
                const confirmPassword = document.getElementById('auth-confirm-password').value;
                if (password !== confirmPassword) {
                    showAlert('Οι κωδικοί πρόσβασης δεν ταιριάζουν.');
                    return;
                }
                sendAuthRequest('/api/auth/setup', { username, password });
            } else {
                sendAuthRequest('/api/auth/login', { username, password });
            }
        });
    }

    document.querySelectorAll('.modal-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.modal-tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.modal-tab-content').forEach(c => c.classList.remove('active'));
            
            btn.classList.add('active');
            const contentId = btn.getAttribute('data-modaltab');
            document.getElementById(contentId).classList.add('active');
        });
    });

    const deleteConfirmBtn = document.getElementById('delete-confirm-btn');
    if (deleteConfirmBtn) {
        deleteConfirmBtn.addEventListener('click', confirmDeletion);
    }

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        
        const sidebar = document.getElementById('sidebar');
        if (sidebar && sidebar.classList.contains('mobile-open')) {
            closeMobileSidebar();
            return;
        }

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

    const debouncedRenderVMs = debounce(renderVMs, 150);
    const debouncedFetchDNS  = debounce(fetchDNSRecords, 300);
    const vmSearch = document.getElementById('vm-search');
    const dnsSearch = document.getElementById('dns-search');
    if (vmSearch) vmSearch.addEventListener('input', debouncedRenderVMs);
    if (dnsSearch) dnsSearch.addEventListener('input', debouncedFetchDNS);
}

// Bind functions to window so inline HTML attributes continue working seamlessly
Object.assign(window, {
    state,
    togglePasswordVisibility,
    openClusterModal, closeClusterModal, saveCluster,
    openVMModal, closeVMModal, saveVM,
    openDeleteModal, closeDeleteModal, confirmDeletion,
    openDNSModal, closeDNSModal, saveDNSRecord,
    openDNSImportModal, closeDNSImportModal, submitDNSImport,
    openVMImportModal, closeVMImportModal, submitVMImport,
    openProfileModal, closeProfileModal, submitProfileUpdate,
    saveSettings, applySettingsToUI, switchTab, linkDNSToVM, sortDNSTable,
    renderVMs, fetchVMs, fetchClusters, fetchStats, fetchDNSRecords, runReport, applyReportPreset,
    exportReportCSV, printReport, toggleVMUpgrade
});

// App Startup on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
    checkAuthStatus();
    setupEventListeners();
});
