// Utility functions for string escaping, DOM alerts, toasts, debouncing, and focus trap

export function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export function debounce(fn, delay = 300) {
    let timer;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

export function togglePasswordVisibility(inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    const iconName = isPassword ? 'eye-off' : 'eye';
    btn.innerHTML = `<i data-lucide="${iconName}"></i>`;
    if (window.lucide) {
        window.lucide.createIcons({
            nodes: [btn]
        });
    }
}

export function showAlert(message, targetId = 'auth-alert') {
    const alertBox = document.getElementById(targetId);
    if (!alertBox) return;
    alertBox.innerHTML = `<i data-lucide="alert-circle"></i><span>${escapeHTML(message)}</span>`;
    alertBox.classList.remove('hidden');
    if (window.lucide) {
        window.lucide.createIcons({ nodes: [alertBox] });
    }
}

export function showToast(message, type = 'info', duration = 4000) {
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
    if (window.lucide) {
        window.lucide.createIcons({ nodes: [toast] });
    }

    if (duration > 0) setTimeout(dismiss, duration);
}

// Focus Trap (WCAG 2.1.2)
let _focusTrap = null;

const FOCUSABLE = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
].join(',');

export function openFocusTrap(dialogEl, triggerEl) {
    if (!dialogEl) return;

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

    requestAnimationFrame(() => {
        const els = getFocusable();
        if (els.length > 0) els[0].focus();
    });
}

export function closeFocusTrap() {
    if (!_focusTrap) return;
    _focusTrap.dialogEl.removeEventListener('keydown', _focusTrap.handler);
    const trigger = _focusTrap.triggerEl;
    _focusTrap = null;
    if (trigger && typeof trigger.focus === 'function') {
        requestAnimationFrame(() => trigger.focus());
    }
}
