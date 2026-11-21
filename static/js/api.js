// Centralized Fetch API Client Wrapper

let _onUnauthorized = null;

export function setUnauthorizedHandler(fn) {
    _onUnauthorized = fn;
}

export async function apiFetch(url, options = {}) {
    const defaultHeaders = {
        'Content-Type': 'application/json',
    };

    if (options.body instanceof FormData || typeof options.body === 'string' && options.headers?.['Content-Type'] === 'text/csv') {
        delete defaultHeaders['Content-Type'];
    }

    const config = {
        ...options,
        headers: {
            ...defaultHeaders,
            ...options.headers,
        },
    };

    const response = await fetch(url, config);
    const data = await response.json().catch(() => ({}));

    if (response.status === 401 && _onUnauthorized && !url.startsWith('/api/auth/')) {
        _onUnauthorized();
    }

    if (!response.ok) {
        const error = new Error(data.error || `HTTP error! Status: ${response.status}`);
        error.status = response.status;
        error.data = data;
        throw error;
    }

    return data;
}
