import { state } from '../state.js';
import { escapeHTML, showToast } from '../utils.js';
import { renderStatsDashboard } from './dashboard.js';

export function renderVMs() {
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
            window.openVMModal(v.id);
        };
        
        let badgesHtml = '';
        if (v.is_important === 1) badgesHtml += '<span class="badge badge-danger" style="margin-left:4px;">Important</span>';
        if (v.monitored === 1) badgesHtml += '<span class="badge badge-success" style="margin-left:4px;">Monitored</span>';
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

    if (window.lucide) window.lucide.createIcons({ nodes: [tbody] });
}

export function renderUpgradesTab() {
    const tbody = document.getElementById('upgrades-tbody');
    const summaryBadge = document.getElementById('upgrades-summary-badge');
    if (!tbody) return;

    if (state.vms === null) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-secondary" style="text-align: center; padding: 2.5rem;"><i data-lucide="loader-2" class="spin" style="margin-right: 0.5rem;"></i> Φόρτωση δεδομένων...</td></tr>`;
        if (summaryBadge) {
            summaryBadge.className = 'badge badge-info';
            summaryBadge.textContent = 'Φόρτωση...';
        }
        if (window.lucide) window.lucide.createIcons({ nodes: [tbody] });
        return;
    }

    tbody.innerHTML = '';

    const needingUpgrade = (state.vms || []).filter(v => Number(v.os_upgrade) === 1 || Number(v.app_upgrade) === 1);
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
            window.openVMModal(v.id);
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
                        <div class="mobile-only-sub" style="font-size:0.75rem; color:var(--text-secondary); margin-top:2px;">
                            ${escapeHTML(v.cluster_name)} ${v.ipv4 ? ' | <code>' + escapeHTML(v.ipv4) + '</code>' : ''}
                        </div>
                        <div class="upgrades-mobile-toggles" style="margin-top:6px; gap:0.75rem;">
                            <label class="switch switch-small" title="Αναβάθμιση OS" onclick="event.stopPropagation();">
                                <span style="font-size:0.75rem; margin-right:4px; color:var(--text-secondary);">OS:</span>
                                <input type="checkbox" ${Number(v.os_upgrade) === 1 ? 'checked' : ''} onchange="toggleVMUpgrade(${v.id}, 'os_upgrade', this.checked)">
                                <span class="slider"></span>
                            </label>
                            <label class="switch switch-small" title="Αναβάθμιση App" onclick="event.stopPropagation();">
                                <span style="font-size:0.75rem; margin-right:4px; color:var(--text-secondary);">App:</span>
                                <input type="checkbox" ${Number(v.app_upgrade) === 1 ? 'checked' : ''} onchange="toggleVMUpgrade(${v.id}, 'app_upgrade', this.checked)">
                                <span class="slider"></span>
                            </label>
                        </div>
                    </div>
                    <div class="mobile-chevron-icon">
                        <i data-lucide="chevron-right"></i>
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

    if (window.lucide) window.lucide.createIcons({ nodes: [tbody] });
}

export function toggleVMUpgrade(vmId, field, isChecked) {
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
        if (typeof renderStatsDashboard === 'function') renderStatsDashboard();
        if (typeof renderVMs === 'function') renderVMs();
        showToast('Η κατάσταση αναβάθμισης ενημερώθηκε επιτυχώς', 'success');
        if (window.fetchStats) window.fetchStats();
    })
    .catch(err => {
        renderUpgradesTab();
        showToast(err.message || 'Αποτυχία ενημέρωσης στη βάση', 'error');
    });
}
