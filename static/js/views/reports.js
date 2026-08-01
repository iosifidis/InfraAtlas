import { state } from '../state.js';
import { escapeHTML, showToast } from '../utils.js';

export function normalizeHost(str) {
    if (!str) return '';
    let s = str.trim().toLowerCase();
    s = s.replace(/^https?:\/\//, '');
    s = s.replace(/[\/\?#].*$/, '');
    s = s.replace(/:\d+$/, '');
    s = s.replace(/^www\./, '');
    s = s.replace(/\.$/, '');
    return s.trim();
}

export function normalizeIP(ip) {
    if (!ip) return '';
    return ip.trim().toLowerCase();
}

export function extractHostsFromURL(urlStr) {
    if (!urlStr) return [];
    const parts = urlStr.split(/[\s,;]+/);
    const hosts = [];
    parts.forEach(p => {
        const h = normalizeHost(p);
        if (h) hosts.push(h);
    });
    return hosts;
}

export function isDNSRecordMatchedToVM(r, vms) {
    if (!vms || !Array.isArray(vms)) return false;

    const dnsValIP = normalizeIP(r.value);
    const dnsNameHost = normalizeHost(r.name);
    const dnsValHost = normalizeHost(r.value);

    for (const v of vms) {
        const vmIPv4 = normalizeIP(v.ipv4);
        const vmIPv6 = normalizeIP(v.ipv6);

        if (dnsValIP && ((vmIPv4 && dnsValIP === vmIPv4) || (vmIPv6 && dnsValIP === vmIPv6))) {
            return true;
        }

        const vmHosts = extractHostsFromURL(v.url);
        for (const vmHost of vmHosts) {
            if (!vmHost) continue;
            if (dnsNameHost && (dnsNameHost === vmHost || dnsNameHost.endsWith('.' + vmHost) || vmHost.endsWith('.' + dnsNameHost))) {
                return true;
            }
            if (r.type === 'CNAME' && dnsValHost && (dnsValHost === vmHost || dnsValHost.endsWith('.' + vmHost) || vmHost.endsWith('.' + dnsValHost))) {
                return true;
            }
        }
    }

    return false;
}

export function isVMMatchedToDNS(v, dnsRecords) {
    if (!dnsRecords || !Array.isArray(dnsRecords)) return false;

    const vmIPv4 = normalizeIP(v.ipv4);
    const vmIPv6 = normalizeIP(v.ipv6);
    const vmHosts = extractHostsFromURL(v.url);

    for (const r of dnsRecords) {
        const dnsValIP = normalizeIP(r.value);
        const dnsNameHost = normalizeHost(r.name);
        const dnsValHost = normalizeHost(r.value);

        if (dnsValIP && ((vmIPv4 && dnsValIP === vmIPv4) || (vmIPv6 && dnsValIP === vmIPv6))) {
            return true;
        }

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

export function applyReportPreset(preset, btnElem) {
    document.getElementById('report-cluster').value = '';
    document.getElementById('report-in-use').value = '';
    document.getElementById('report-important').value = '';
    document.getElementById('report-ansible').value = '';
    document.getElementById('report-docker').value = '';
    
    document.querySelectorAll('.presets-row .btn').forEach(btn => {
        btn.classList.remove('active');
    });

    if (btnElem) {
        btnElem.classList.add('active');
    }

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

export function runReport() {
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

export function renderUnmatchedDNSTable(records) {
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
            window.openDNSModal(r.id);
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

    if (window.lucide) window.lucide.createIcons({ nodes: [tbody] });
    state.currentReportData = records;
}

export function renderUnmatchedVMsTable(vms) {
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
            window.openVMModal(v.id);
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

    if (window.lucide) window.lucide.createIcons({ nodes: [tbody] });
    state.currentReportData = vms;
}

export function renderReportTable(vms) {
    const thead = document.querySelector('#report-table thead');
    const tbody = document.getElementById('reports-tbody');
    
    thead.innerHTML = `
        <tr>
            <th style="max-width: 180px;">Όνομα VM</th>
            <th>Cluster</th>
            <th>Specs</th>
            <th>IPv4</th>
            <th>Σε Χρήση</th>
            <th>Σημαντικό</th>
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
        tbody.innerHTML = `<tr><td colspan="6" class="text-secondary" style="text-align: center; padding: 2rem;">Δεν βρέθηκαν αποτελέσματα για αυτή την αναφορά.</td></tr>`;
        return;
    }

    vms.forEach(v => {
        const row = document.createElement('tr');
        row.classList.add('vm-table-row', 'clickable-row');
        row.setAttribute('title', 'Κάντε κλικ για προβολή / επεξεργασία VM');
        row.onclick = (e) => {
            if (e.target.closest('a') || e.target.closest('button')) return;
            window.openVMModal(v.id);
        };

        let badgesHtml = '';
        badgesHtml += `<span class="badge ${v.in_use === 1 ? 'badge-success' : 'badge-danger'}" style="margin-right:4px;">Σε Χρήση: ${v.in_use === 1 ? 'Ναι' : 'Όχι'}</span>`;
        badgesHtml += `<span class="badge ${v.is_important === 1 ? 'badge-success' : 'badge-danger'}" style="margin-right:4px;">Σημαντικό: ${v.is_important === 1 ? 'Ναι' : 'Όχι'}</span>`;
        if (v.vpn === 1) badgesHtml += '<span class="badge badge-info" style="margin-right:4px;">VPN</span>';
        if (v.backup) badgesHtml += '<span class="badge badge-success" style="margin-right:4px;">Backup</span>';
        if (v.ansible === 1) badgesHtml += '<span class="badge badge-info" style="margin-right:4px;">Ansible</span>';
        if (v.docker === 1) badgesHtml += '<span class="badge badge-primary" style="margin-right:4px;">Docker</span>';

        const specsText = `CPU: ${v.cpu} | RAM: ${v.ram} | Disk: ${v.disk}${v.extra_disk > 0 ? ' +' + v.extra_disk : ''}`;

        row.innerHTML = `
            <td class="col-vm-info" style="max-width: 170px; word-break: break-word; white-space: normal;">
                <div class="vm-row-flex">
                    <div class="vm-main-details" style="max-width: 100%;">
                        <div class="vm-name-title" style="word-break: break-word; white-space: normal; overflow-wrap: break-word;">${escapeHTML(v.name)}</div>
                        <div class="vm-url-sub" style="word-break: break-all; white-space: normal;">${v.url ? `<a href="${escapeHTML(v.url)}" target="_blank" onclick="event.stopPropagation();">${escapeHTML(v.url)}</a>` : '<span class="no-url-text">Χωρίς Domain</span>'}</div>
                        <div class="mobile-only-sub" style="font-size:0.75rem; margin-top:4px; color:var(--text-secondary);">
                            <span>${escapeHTML(v.cluster_name)}</span> &bull; <span>${specsText}</span> &bull; <code>${escapeHTML(v.ipv4 || '-')}</code>
                            <div style="margin-top:4px; display:flex; flex-wrap:wrap; gap:4px;">${badgesHtml}</div>
                        </div>
                    </div>
                    <div class="mobile-chevron-icon">
                        <i data-lucide="chevron-right"></i>
                    </div>
                </div>
            </td>
            <td><span class="badge badge-info">${escapeHTML(v.cluster_name)}</span></td>
            <td><span style="font-size:0.75rem; white-space:nowrap;">CPU: ${v.cpu} | RAM: ${v.ram} | Disk: ${v.disk}</span></td>
            <td><code>${escapeHTML(v.ipv4 || '-')}</code></td>
            <td style="text-align: center;"><span class="badge ${v.in_use === 1 ? 'badge-success' : 'badge-danger'}">${v.in_use === 1 ? 'Ναι' : 'Όχι'}</span></td>
            <td style="text-align: center;"><span class="badge ${v.is_important === 1 ? 'badge-success' : 'badge-danger'}">${v.is_important === 1 ? 'Ναι' : 'Όχι'}</span></td>
        `;
        tbody.appendChild(row);
    });

    if (window.lucide) window.lucide.createIcons({ nodes: [tbody] });
    state.currentReportData = vms;
}

export function exportReportCSV() {
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

export function printReport() {
    window.print();
}
