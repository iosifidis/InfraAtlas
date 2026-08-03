import { state } from '../state.js';
import { escapeHTML } from '../utils.js';

export function fetchDNSRecords() {
    const searchInput = document.getElementById('dns-search');
    const typeSelect = document.getElementById('filter-dns-type');
    const search = searchInput ? searchInput.value.trim() : '';
    const type = typeSelect ? typeSelect.value : '';

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

export function sortDNSTable(col) {
    if (state.dnsSort.col === col) {
        state.dnsSort.dir = state.dnsSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
        state.dnsSort.col = col;
        state.dnsSort.dir = 'asc';
    }
    renderDNSRecords();
}

export function renderDNSRecords() {
    const tbody = document.getElementById('dns-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (state.dnsRecords.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-secondary" style="text-align: center; padding: 2rem;">Δεν βρέθηκαν εγγραφές DNS.</td></tr>`;
        return;
    }

    const { col, dir } = state.dnsSort;
    state.dnsRecords.sort((a, b) => {
        let valA = (a[col] || '').toString().toLowerCase();
        let valB = (b[col] || '').toString().toLowerCase();
        if (valA < valB) return dir === 'asc' ? -1 : 1;
        if (valA > valB) return dir === 'asc' ? 1 : -1;
        return 0;
    });

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
                        <div class="mobile-only-sub" style="margin-top:2px;"><code>${escapeHTML(r.value)}</code> &nbsp;<span class="badge ${badgeClass}" style="font-size:0.7rem;">${escapeHTML(r.type)}</span></div>
                        ${r.description ? `<div style="font-size: 0.75rem; color: var(--text-secondary); margin-top:2px;">${escapeHTML(r.description)}</div>` : ''}
                    </div>
                    <div class="mobile-chevron-icon">
                        <i data-lucide="chevron-right"></i>
                    </div>
                </div>
            </td>
            <td><span class="badge ${badgeClass}">${escapeHTML(r.type)}</span></td>
            <td><code>${escapeHTML(r.value)}</code></td>
            <td>
                <button class="btn btn-outline" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;" onclick="event.stopPropagation(); linkDNSToVM('${escapeHTML(r.value)}', '${escapeHTML(r.name)}')">
                    <i data-lucide="link" style="width:12px; height:12px;"></i>
                    <span>Σύνδεση / VM</span>
                </button>
            </td>
            <td class="actions-col">
                <div class="table-actions">
                    <button class="btn-icon-only" onclick="event.stopPropagation(); openDNSModal(${r.id})" title="Επεξεργασία"><i data-lucide="edit-3"></i></button>
                    <button class="btn-icon-only text-danger" onclick="event.stopPropagation(); openDeleteModal('dns', ${r.id})" title="Διαγραφή"><i data-lucide="trash-2"></i></button>
                </div>
            </td>
        `;
        tbody.appendChild(row);
    });

    if (window.lucide) window.lucide.createIcons({ nodes: [tbody] });
}

export function linkDNSToVM(val, hostname) {
    if (window.switchTab) window.switchTab('vms');
    window.location.hash = 'vms';
    
    const searchInput = document.getElementById('vm-search');
    if (searchInput) searchInput.value = val;
    if (window.fetchVMs) window.fetchVMs();
}
