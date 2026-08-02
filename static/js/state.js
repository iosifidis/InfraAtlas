// Global Application State
export const state = {
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
export const defaultFields = [
    'default_password', 'url', 'cpu', 'ram', 'disk', 'extra_disk',
    'ipv4', 'ipv6', 'vpn', 'backup', 'monitored', 'os_upgrade', 'app_upgrade', 'os', 'os_version',
    'contact_person', 'description'
];
