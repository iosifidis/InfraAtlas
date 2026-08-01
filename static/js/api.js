// Centralized Fetch API Client Wrapper

export async function apiFetch(url, options = {}) {
    const defaultHeaders = {
        'Content-Type': 'application/json',
    };
    
    if (options.body instanceof FormData) {
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

    if (!response.ok) {
        const error = new Error(data.error || `HTTP error! Status: ${response.status}`);
        error.status = response.status;
        error.data = data;
        throw error;
    }

    return data;
}
