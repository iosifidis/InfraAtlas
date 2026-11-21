import { state, defaultFields } from './state.js';
import { apiFetch, setUnauthorizedHandler } from './api.js';
import { escapeHTML, debounce, togglePasswordVisibility, showAlert, showToast } from './utils.js';
import { renderStatsDashboard, renderClusters, populateClusterDropdowns } from './views/dashboard.js';
import { renderVMs, renderUpgradesTab, toggleVMUpgrade, toggleSelectAllVMs, updateSelectedVMsCount, getSelectedVMIDs } from './views/vms.js';
import { fetchDNSRecords, renderDNSRecords, sortDNSTable, linkDNSToVM } from './views/dns.js';
import { runReport, applyReportPreset, exportReportCSV, printReport } from './views/reports.js';
import {
    openClusterModal, closeClusterModal, saveCluster,
    openVMModal, closeVMModal, saveVM,
    openDeleteModal, closeDeleteModal, confirmDeletion,
    openDNSModal, closeDNSModal, saveDNSRecord,
    openDNSImportModal, closeDNSImportModal, submitDNSImport,
    openProfileModal, closeProfileModal, submitProfileUpdate,
    addSoftwareRow, removeSoftwareRow
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
    apiFetch(url, {
        method: 'POST',
        body: JSON.stringify(payload)
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
    fetchAnsibleStatus();
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
    apiFetch('/api/settings')
        .then(data => {
            state.settings = data;
            applySettingsToUI();
        })
        .catch(err => console.error("Error loading settings:", err));
}

export function fetchStats() {
    apiFetch('/api/stats')
        .then(data => {
            state.stats = data;
            renderStatsDashboard();
        })
        .catch(err => console.error("Error loading statistics:", err));
}

export function fetchClusters() {
    apiFetch('/api/clusters')
        .then(data => {
            state.clusters = data || [];
            renderClusters();
            populateClusterDropdowns();
        })
        .catch(err => console.error("Error loading clusters:", err));
}

export function fetchVMs() {
    return apiFetch('/api/vms?t=' + Date.now())
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

    const apiTokenEl = document.getElementById('setting-api_token');
    const sshUserEl = document.getElementById('setting-ansible_ssh_user');
    const sshKeyEl = document.getElementById('setting-ansible_ssh_key');
    if (apiTokenEl) apiTokenEl.value = state.settings.api_token || '';
    if (sshUserEl) sshUserEl.value = state.settings.ansible_ssh_user || '';
    if (sshKeyEl) sshKeyEl.value = state.settings.ansible_ssh_key || '';

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

    const sshUserEl = document.getElementById('setting-ansible_ssh_user');
    const sshKeyEl = document.getElementById('setting-ansible_ssh_key');
    if (sshUserEl) payload['ansible_ssh_user'] = sshUserEl.value.trim();
    if (sshKeyEl) payload['ansible_ssh_key'] = sshKeyEl.value.trim();

    defaultFields.forEach(field => {
        const toggle = document.getElementById(`field-${field}`);
        if (toggle) {
            payload[field] = toggle.checked ? '1' : '0';
        }
    });

    apiFetch('/api/settings', {
        method: 'POST',
        body: JSON.stringify(payload)
    })
        .then(() => {
            state.settings = payload;
            applySettingsToUI();
            fetchStats();
            showToast('Οι ρυθμίσεις αποθηκεύτηκαν με επιτυχία!', 'success');
        })
        .catch(err => showToast('Αποτυχία αποθήκευσης ρυθμίσεων: ' + err.message, 'error'));
}

export function loadUserProfile() {
    apiFetch('/api/auth/profile')
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
        if (id === 'cluster-modal') closeClusterModal();
        else if (id === 'vm-modal') closeVMModal();
        else if (id === 'dns-modal') closeDNSModal();
        else if (id === 'dns-import-modal') closeDNSImportModal();
        else if (id === 'ansible-sync-modal') closeAnsibleSyncModal();
        else if (id === 'profile-modal') closeProfileModal();
        else if (id === 'delete-modal') closeDeleteModal();
    });

    const debouncedRenderVMs = debounce(renderVMs, 150);
    const debouncedFetchDNS = debounce(fetchDNSRecords, 300);
    const vmSearch = document.getElementById('vm-search');
    const dnsSearch = document.getElementById('dns-search');
    if (vmSearch) vmSearch.addEventListener('input', debouncedRenderVMs);
    if (dnsSearch) dnsSearch.addEventListener('input', debouncedFetchDNS);
}

export function fetchAnsibleStatus() {
    apiFetch('/api/ansible/status')
        .then(data => {
            state.ansibleAvailable = !!data.available;
            const statusEl = document.getElementById('ansible-server-status');
            if (statusEl) {
                if (data.available) {
                    statusEl.innerHTML = `<span class="badge badge-success">Ansible Διαθέσιμο στον Server</span> <span style="margin-left:0.5rem;"><code>${escapeHTML(data.binary_path)}</code> — Μπορείτε να τρέξετε συγχρονισμό απευθείας από την καρτέλα VMs.</span>`;
                } else {
                    statusEl.innerHTML = `<span class="badge badge-info">Αυτόνομη Λειτουργία (Standalone)</span> <span style="margin-left:0.5rem;">Το <code>ansible-playbook</code> δεν είναι εγκατεστημένο στον server. Μπορείτε να τρέξετε το <code>ansible/sync-infraatlas.yml</code> από το workstation σας με το API Token.</span>`;
                }
            }
        })
        .catch(() => {});
}

export function generateAPIToken() {
    apiFetch('/api/settings/token', { method: 'POST' })
        .then(data => {
            state.settings.api_token = data.api_token;
            const el = document.getElementById('setting-api_token');
            if (el) el.value = data.api_token;
            showToast('Δημιουργήθηκε νέο API Token!', 'success');
        })
        .catch(err => showToast(err.message, 'error'));
}

export function copyAPIToken() {
    const el = document.getElementById('setting-api_token');
    if (!el || !el.value) {
        showToast('Δεν υπάρχει API Token. Πατήστε πρώτα "Δημιουργία Token".', 'info');
        return;
    }
    navigator.clipboard.writeText(el.value)
        .then(() => showToast('Το API Token αντιγράφηκε!', 'success'))
        .catch(() => showToast('Αποτυχία αντιγραφής στο clipboard.', 'error'));
}

export function closeAnsibleSyncModal() {
    document.getElementById('ansible-sync-modal')?.classList.add('hidden');
}

export function syncSelectedVMsWithAnsible() {
    const vmIDs = getSelectedVMIDs();
    if (vmIDs.length === 0) {
        showToast('Επιλέξτε τουλάχιστον ένα VM.', 'info');
        return;
    }

    const modal = document.getElementById('ansible-sync-modal');
    const statusEl = document.getElementById('ansible-sync-status');
    const outputEl = document.getElementById('ansible-sync-output');
    if (!modal || !statusEl || !outputEl) return;

    modal.classList.remove('hidden');

    if (!state.ansibleAvailable) {
        const origin = window.location.origin;
        const token = state.settings.api_token || '<API_TOKEN_ΑΠΟ_ΡΥΘΜΙΣΕΙΣ>';
        statusEl.innerHTML = `<span class="badge badge-info">Εξωτερική Εκτέλεση Ansible</span> Το <code>ansible-playbook</code> δεν είναι εγκατεστημένο σε αυτόν τον server. Τρέξτε την παρακάτω εντολή από το control node σας:`;
        outputEl.textContent =
            `INFRAATLAS_URL="${origin}" \\\n` +
            `INFRAATLAS_TOKEN="${token}" \\\n` +
            `ansible-playbook -i "${origin}/api/ansible/inventory?all=1" ansible/sync-infraatlas.yml`;
        return;
    }

    statusEl.innerHTML = `<i data-lucide="loader-2" class="spin" style="width:16px;height:16px;vertical-align:middle;margin-right:6px;"></i> Εκτέλεση Ansible playbook σε ${vmIDs.length} VM(s)... Παρακαλώ περιμένετε.`;
    outputEl.textContent = 'Running ansible-playbook...';
    if (window.lucide) window.lucide.createIcons({ nodes: [statusEl] });

    apiFetch('/api/ansible/sync', {
        method: 'POST',
        body: JSON.stringify({ vm_ids: vmIDs })
    })
    .then(data => {
        if (data.success) {
            statusEl.innerHTML = `<span class="badge badge-success">Επιτυχία</span> ${escapeHTML(data.message)}`;
            fetchVMs();
            fetchStats();
        } else {
            statusEl.innerHTML = `<span class="badge badge-danger">Σφάλμα</span> ${escapeHTML(data.message)}`;
        }
        outputEl.textContent = data.output || '';
    })
    .catch(err => {
        statusEl.innerHTML = `<span class="badge badge-danger">Αποτυχία</span> ${escapeHTML(err.message)}`;
        outputEl.textContent = err.message;
    });
}

export function downloadBackup() {
    window.open('/api/backup', '_blank');
}

export function restoreBackup() {
    const fileInput = document.getElementById('backup-restore-file');
    if (!fileInput || fileInput.files.length === 0) {
        showToast('Παρακαλώ επιλέξτε ένα αρχείο backup (.db).', 'error');
        return;
    }
    if (!confirm('Η επαναφορά θα αντικαταστήσει όλα τα τρέχοντα δεδομένα με το επιλεγμένο backup. Συνέχεια;')) {
        return;
    }

    const formData = new FormData();
    formData.append('backup', fileInput.files[0]);

    apiFetch('/api/backup/restore', {
        method: 'POST',
        body: formData
    })
    .then(data => {
        showToast(data.message || 'Η επαναφορά ολοκληρώθηκε!', 'success');
        fileInput.value = '';
        checkAuthStatus();
    })
    .catch(err => showToast(err.message, 'error'));
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
    openProfileModal, closeProfileModal, submitProfileUpdate,
    addSoftwareRow, removeSoftwareRow,
    downloadBackup, restoreBackup,
    toggleSelectAllVMs, updateSelectedVMsCount, syncSelectedVMsWithAnsible, closeAnsibleSyncModal,
    generateAPIToken, copyAPIToken,
    saveSettings, applySettingsToUI, switchTab, linkDNSToVM, sortDNSTable,
    renderVMs, fetchVMs, fetchClusters, fetchStats, fetchDNSRecords, runReport, applyReportPreset,
    exportReportCSV, printReport, toggleVMUpgrade
});

// App Startup on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
    setUnauthorizedHandler(() => {
        if (state.loggedIn) {
            state.loggedIn = false;
            updateAuthUI();
            showToast('Η συνεδρία σας έληξε. Παρακαλώ συνδεθείτε ξανά.', 'info');
        }
    });
    checkAuthStatus();
    setupEventListeners();
});
