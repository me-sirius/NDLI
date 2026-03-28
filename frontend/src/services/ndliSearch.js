// Frontend should only call backend URL from env (for example, ngrok URL).
const API_BASE = (import.meta.env.VITE_API_URL || '').trim().replace(/\/$/, '');
const REQUEST_TIMEOUT_MS = 15000;

function getSearchEndpoint() {
  if (!API_BASE) {
    throw new Error('VITE_API_URL is missing. Set it in frontend/.env');
  }

  return `${API_BASE}/api/search`;
}

async function fetchWithTimeout(url, options, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function ndliSearch(query, domain = 'se') {
  try {
    const res = await fetchWithTimeout(getSearchEndpoint(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, domain }),
    });

    if (!res.ok) {
      let message = 'NDLI search failed';
      try {
        const err = await res.json();
        if (err?.error) message = err.error;
      } catch {
        // Keep fallback message when response is not JSON.
      }
      throw new Error(message);
    }

    return res.json();
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Search request timed out after ${REQUEST_TIMEOUT_MS}ms.`);
    }

    if (err.name === 'TypeError') {
      throw new Error('Unable to reach backend. Check VITE_API_URL and backend CORS settings.');
    }

    throw err;
  }
}