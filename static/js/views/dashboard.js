import { state } from '../state.js';
import { escapeHTML } from '../utils.js';

export function renderStatsDashboard() {
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

    const allocatedCPU = stats.total_cpu || 0;
    const allocatedRAM = stats.total_ram || 0;
    const allocatedDisk = (stats.total_disk || 0) + (stats.total_extra_disk || 0);

    let usedIPs = 0;
    (state.vms || []).forEach(v => {
        if (v.ipv4 && v.ipv4.trim() !== '') usedIPs++;
    });

    const maxCPU = parseFloat(state.settings.capacity_cpu) || 0;
    const maxRAM = parseFloat(state.settings.capacity_ram) || 0;
    const maxDisk = parseFloat(state.settings.capacity_disk) || 0;
    const maxIPs = parseFloat(state.settings.capacity_ips) || 0;

    if (maxCPU > 0) {
        const cpuPct = Math.min(100, (allocatedCPU / maxCPU) * 100);
        document.getElementById('total-cpu-val').textContent = `${allocatedCPU.toFixed(1)} / ${maxCPU} Cores (${cpuPct.toFixed(1)}%)`;
        document.getElementById('total-cpu-fill').style.width = `${cpuPct}%`;
    } else {
        document.getElementById('total-cpu-val').textContent = `${allocatedCPU.toFixed(1)} Cores`;
        document.getElementById('total-cpu-fill').style.width = `100%`;
    }

    if (maxRAM > 0) {
        const ramPct = Math.min(100, (allocatedRAM / maxRAM) * 100);
        document.getElementById('total-ram-val').textContent = `${allocatedRAM.toFixed(1)} / ${maxRAM} GB (${ramPct.toFixed(1)}%)`;
        document.getElementById('total-ram-fill').style.width = `${ramPct}%`;
    } else {
        document.getElementById('total-ram-val').textContent = `${allocatedRAM.toFixed(1)} GB`;
        document.getElementById('total-ram-fill').style.width = `100%`;
    }

    if (maxDisk > 0) {
        const diskPct = Math.min(100, (allocatedDisk / maxDisk) * 100);
        document.getElementById('total-disk-val').textContent = `${allocatedDisk.toFixed(1)} / ${maxDisk} GB (${diskPct.toFixed(1)}%)`;
        document.getElementById('total-disk-fill').style.width = `${diskPct}%`;
    } else {
        document.getElementById('total-disk-val').textContent = `${allocatedDisk.toFixed(1)} GB`;
        document.getElementById('total-disk-fill').style.width = `100%`;
    }

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
                card.onclick = () => window.openVMModal(v.id);

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
    
    if (window.lucide) {
        window.lucide.createIcons({ nodes: [document.getElementById('tab-dashboard')] });
    }

    const tbody = document.getElementById('cluster-resources-tbody');
    if (tbody) {
        tbody.innerHTML = '';
        if (stats.cluster_distribution && stats.cluster_distribution.length > 0) {
            stats.cluster_distribution.forEach(dist => {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td><strong>${escapeHTML(dist.name)}</strong></td>
                    <td>${dist.vm_count}</td>
                    <td>${dist.in_use_count}</td>
                    <td>${(dist.cpu || 0).toFixed(1)}</td>
                    <td>${(dist.ram || 0).toFixed(1)}</td>
                    <td>${(dist.disk || 0).toFixed(1)}</td>
                    <td>${dist.important_count || 0}</td>
                `;
                tbody.appendChild(row);
            });
        } else {
            tbody.innerHTML = `<tr><td colspan="7" class="text-secondary" style="text-align: center;">Δεν υπάρχουν δεδομένα clusters.</td></tr>`;
        }
    }
}

export function renderClusters() {
    const container = document.getElementById('clusters-container');
    if (!container) return;
    container.innerHTML = '';

    if (state.clusters.length === 0) {
        container.innerHTML = `
            <div class="glass" style="padding: 3rem; text-align: center; grid-column: 1 / -1;">
                <i data-lucide="boxes" style="width: 48px; height: 48px; color: var(--text-muted); margin-bottom: 1rem;"></i>
                <h3>Δεν βρέθηκαν Clusters</h3>
                <p class="text-secondary" style="margin-top: 0.5rem;">Ξεκινήστε προσθέτοντας ένα νέο cluster διαχείρισης VM.</p>
            </div>
        `;
        if (window.lucide) window.lucide.createIcons({ nodes: [container] });
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

    if (window.lucide) window.lucide.createIcons({ nodes: [container] });
}

export function populateClusterDropdowns() {
    const filterDropdown = document.getElementById('filter-cluster');
    const formDropdown = document.getElementById('vm-cluster-id');
    const reportDropdown = document.getElementById('report-cluster');

    if (!filterDropdown || !formDropdown || !reportDropdown) return;

    const filterVal = filterDropdown.value;
    const reportVal = reportDropdown.value;

    filterDropdown.innerHTML = '<option value="">Όλα</option>';
    formDropdown.innerHTML = '<option value="">Επιλέξτε Cluster...</option>';
    reportDropdown.innerHTML = '<option value="">Όλα</option>';

    state.clusters.forEach(c => {
        filterDropdown.innerHTML += `<option value="${c.id}">${escapeHTML(c.name)}</option>`;
        formDropdown.innerHTML += `<option value="${c.id}">${escapeHTML(c.name)}</option>`;
        reportDropdown.innerHTML += `<option value="${c.id}">${escapeHTML(c.name)}</option>`;
    });

    filterDropdown.value = filterVal;
    reportDropdown.value = reportVal;
}
