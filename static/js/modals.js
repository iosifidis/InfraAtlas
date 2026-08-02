import { state } from './state.js';
import { escapeHTML, showToast, openFocusTrap, closeFocusTrap } from './utils.js';
import { fetchClusters, fetchVMs } from './main.js';
import { fetchDNSRecords } from './views/dns.js';
import { renderStatsDashboard } from './views/dashboard.js';
import { normalizeHost } from './views/reports.js';

// --- Cluster Modal ---
export function openClusterModal(id = null) {
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

export function closeClusterModal() {
    closeFocusTrap();
    document.getElementById('cluster-modal').classList.add('hidden');
}

export function saveCluster(e) {
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
        if (window.fetchStats) window.fetchStats();
    })
    .catch(err => showToast(err.message, 'error'));
}

// --- VM Modal ---
export function openVMModal(id = null) {
    const _trigger = document.activeElement;
    const modal = document.getElementById('vm-modal');
    const title = document.getElementById('vm-modal-title');
    const form = document.getElementById('vm-form');
    
    form.reset();
    document.getElementById('vm-id').value = '';
    
    document.querySelectorAll('.modal-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.modal-tab-content').forEach(c => c.classList.remove('active'));
    document.querySelector('[data-modaltab="vm-tab-basic"]').classList.add('active');
    document.getElementById('vm-tab-basic').classList.add('active');

    if (window.applySettingsToUI) window.applySettingsToUI();

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

        const activeClusterFilter = document.getElementById('filter-cluster').value;
        if (activeClusterFilter) {
            document.getElementById('vm-cluster-id').value = activeClusterFilter;
        }
        
        modal.classList.remove('hidden');
        openFocusTrap(modal.querySelector('.modal-box'), _trigger);
    }
}

export function closeVMModal() {
    closeFocusTrap();
    document.getElementById('vm-modal').classList.add('hidden');
}

export function saveVM(e) {
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
        if (window.fetchStats) window.fetchStats();
    })
    .catch(err => showToast(err.message, 'error'));
}

// --- Delete Modal ---
export function openDeleteModal(type, id) {
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
    if (window.lucide) window.lucide.createIcons({ nodes: [modal.querySelector('.modal-box')] });
    openFocusTrap(modal.querySelector('.modal-box'), _trigger);
}

export function closeDeleteModal() {
    closeFocusTrap();
    document.getElementById('delete-modal').classList.add('hidden');
    state.deleteTarget = null;
}

export function confirmDeletion() {
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
            if (window.fetchStats) window.fetchStats();
        })
        .catch(err => {
            closeDeleteModal();
            showToast(err.message, 'error');
        });
}

// --- DNS Modal ---
export function openDNSModal(id = null) {
    const _trigger = document.activeElement;
    const modal = document.getElementById('dns-modal');
    const title = document.getElementById('dns-modal-title');
    const form = document.getElementById('dns-form');
    const bannerContainer = document.getElementById('dns-linked-vm-banner');
    
    form.reset();
    document.getElementById('dns-id').value = '';
    if (bannerContainer) bannerContainer.innerHTML = '';

    if (id) {
        title.textContent = 'Επεξεργασία Εγγραφής DNS';
        const record = state.dnsRecords.find(r => r.id === id);
        if (record) {
            document.getElementById('dns-id').value = record.id;
            document.getElementById('dns-name').value = record.name;
            document.getElementById('dns-type').value = record.type;
            document.getElementById('dns-value').value = record.value;
            document.getElementById('dns-desc').value = record.description || '';

            const linkedVm = (state.vms || []).find(v => 
                (v.ipv4 && v.ipv4 === record.value) || 
                (v.ipv6 && v.ipv6 === record.value) ||
                (v.url && normalizeHost(v.url) === normalizeHost(record.name)) ||
                (v.url && normalizeHost(v.url) === normalizeHost(record.value))
            );

            if (linkedVm && bannerContainer) {
                bannerContainer.innerHTML = `
                    <div style="padding: 0.75rem 1rem; margin-bottom: 1rem; background: rgba(59, 130, 246, 0.12); border: 1px solid var(--primary); border-radius: var(--radius-md); display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;">
                        <div style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.8125rem;">
                            <i data-lucide="server" style="color: var(--primary); width:16px; height:16px; flex-shrink:0;"></i>
                            <span>Συνδεδεμένο VM: <strong style="color:#ffffff;">${escapeHTML(linkedVm.name)}</strong> (${escapeHTML(linkedVm.ipv4 || '-')})</span>
                        </div>
                        <button type="button" class="btn btn-outline" style="padding: 0.25rem 0.6rem; font-size: 0.75rem; white-space:nowrap;" onclick="closeDNSModal(); openVMModal(${linkedVm.id});">
                            <i data-lucide="external-link" style="width:12px; height:12px;"></i>
                            <span>Καρτέλα VM</span>
                        </button>
                    </div>
                `;
            }
        }
    } else {
        title.textContent = 'Προσθήκη Εγγραφής DNS';
    }

    modal.classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons({ nodes: [modal] });
    openFocusTrap(modal.querySelector('.modal-box'), _trigger);
}

export function closeDNSModal() {
    closeFocusTrap();
    document.getElementById('dns-modal').classList.add('hidden');
}

export function saveDNSRecord(e) {
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

// --- DNS Import Modal ---
export function openDNSImportModal() {
    const _trigger = document.activeElement;
    const modal = document.getElementById('dns-import-modal');
    const form = document.getElementById('dns-import-form');
    const alertBox = document.getElementById('dns-import-alert');
    form.reset();
    alertBox.classList.add('hidden');
    modal.classList.remove('hidden');
    openFocusTrap(modal.querySelector('.modal-box'), _trigger);
}

export function closeDNSImportModal() {
    closeFocusTrap();
    document.getElementById('dns-import-modal').classList.add('hidden');
}

export function submitDNSImport(e) {
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

// --- VM Import Modal ---
export function openVMImportModal() {
    const _trigger = document.activeElement;
    const modal = document.getElementById('vm-import-modal');
    const form = document.getElementById('vm-import-form');
    const alertBox = document.getElementById('vm-import-alert');
    form.reset();
    alertBox.classList.add('hidden');
    modal.classList.remove('hidden');
    openFocusTrap(modal.querySelector('.modal-box'), _trigger);
}

export function closeVMImportModal() {
    closeFocusTrap();
    document.getElementById('vm-import-modal').classList.add('hidden');
}

export function submitVMImport(e) {
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
            if (window.fetchStats) window.fetchStats();
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

// --- Profile Modal ---
export function openProfileModal() {
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

export function closeProfileModal() {
    closeFocusTrap();
    document.getElementById('profile-modal').classList.add('hidden');
}

export function submitProfileUpdate(e) {
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
