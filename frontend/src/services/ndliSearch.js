// Frontend should only call backend URL from env (for example, ngrok URL).
const API_BASE = (import.meta.env.VITE_API_URL || '').trim().replace(/\/$/, '');
const REQUEST_TIMEOUT_MS = parsePositiveInt(import.meta.env.VITE_REQUEST_TIMEOUT_MS, 32000);
const HEALTHCHECK_TIMEOUT_MS = parsePositiveInt(import.meta.env.VITE_HEALTHCHECK_TIMEOUT_MS, 4500);
const SEARCH_RETRY_COUNT = parseNonNegativeInt(import.meta.env.VITE_SEARCH_RETRY_COUNT, 1);
const SEARCH_RETRY_DELAY_MS = parsePositiveInt(import.meta.env.VITE_SEARCH_RETRY_DELAY_MS, 400);
const RETRYABLE_ERROR_CODES = new Set([
  'BACKEND_TIMEOUT',
  'BACKEND_UNREACHABLE',
  'NDLI_UPSTREAM_TIMEOUT',
  'NDLI_UPSTREAM_UNREACHABLE',
  'BACKEND_SEARCH_ROUTE_ISSUE',
]);

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parseNonNegativeInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createNdliError(message, code, extras = {}) {
  const error = new Error(message);
  error.name = 'NdliSearchError';
  error.code = code;
  Object.assign(error, extras);
  return error;
}

export function getBackendApiInfo() {
  const baseUrl = API_BASE;
  const searchEndpoint = baseUrl ? `${baseUrl}/api/search` : '';
  const healthEndpoint = baseUrl ? `${baseUrl}/health` : '';

  let host = '';
  if (baseUrl) {
    try {
      host = new URL(baseUrl).host;
    } catch {
      host = baseUrl;
    }
  }

  return {
    baseUrl,
    host,
    searchEndpoint,
    healthEndpoint,
  };
}

function getSearchEndpoint() {
  const { searchEndpoint } = getBackendApiInfo();
  if (!searchEndpoint) {
    throw new Error('VITE_API_URL is missing. Set it in frontend/.env');
  }

  return searchEndpoint;
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

function classifyBackendHttpError(status, message = '', details = '') {
  const combined = `${message} ${details}`.toLowerCase();

  if (status === 403 && combined.includes('origin not allowed by cors')) {
    return {
      code: 'CORS_BLOCKED',
      message: 'Backend rejected this frontend origin (CORS). Add your frontend URL to CORS_ORIGINS and redeploy backend.',
    };
  }

  if (status === 504 || combined.includes('timed out after')) {
    return {
      code: 'NDLI_UPSTREAM_TIMEOUT',
      message: 'Backend API is reachable, but NDLI upstream timed out. Please retry in a moment.',
    };
  }

  if (status === 502 && (combined.includes('unable to resolve ndli host') || combined.includes('unable to connect to ndli'))) {
    return {
      code: 'NDLI_UPSTREAM_UNREACHABLE',
      message: 'Backend API is reachable, but it cannot connect to NDLI upstream right now.',
    };
  }

  return null;
}

function shouldRetrySearchError(error) {
  if (!error?.code) return false;
  if (RETRYABLE_ERROR_CODES.has(error.code)) return true;
  if (error.code === 'BACKEND_API_ERROR') return Number(error.status) >= 500;
  return false;
}

async function diagnoseTypeError() {
  const { healthEndpoint } = getBackendApiInfo();
  if (!healthEndpoint) return 'BACKEND_CONFIG_MISSING';

  try {
    const healthRes = await fetchWithTimeout(healthEndpoint, {
      method: 'GET',
      cache: 'no-store',
    }, HEALTHCHECK_TIMEOUT_MS);

    if (healthRes.ok) {
      return 'BACKEND_SEARCH_ROUTE_ISSUE';
    }
  } catch {
    // If CORS request fails, probe with no-cors to distinguish network from CORS.
  }

  try {
    await fetchWithTimeout(healthEndpoint, {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
    }, HEALTHCHECK_TIMEOUT_MS);
    return 'CORS_BLOCKED';
  } catch {
    return 'BACKEND_UNREACHABLE';
  }
}

async function runSearchRequest(query, domain = 'se') {
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
      let details = '';
      try {
        const err = await res.json();
        if (err?.error) message = err.error;
        if (err?.details) details = err.details;
      } catch {
        // Keep fallback message when response is not JSON.
      }

      const classified = classifyBackendHttpError(res.status, message, details);
      if (classified) {
        throw createNdliError(classified.message, classified.code, {
          status: res.status,
          backendMessage: message,
          details,
        });
      }

      throw createNdliError(`${message} (HTTP ${res.status})`, 'BACKEND_API_ERROR', {
        status: res.status,
        backendMessage: message,
        details,
      });
    }

    return res.json();
  } catch (err) {
    if (err?.code) {
      throw err;
    }

    if (err.name === 'AbortError') {
      throw createNdliError(`Backend API did not respond within ${REQUEST_TIMEOUT_MS}ms.`, 'BACKEND_TIMEOUT');
    }

    if (err.name === 'TypeError') {
      const causeCode = await diagnoseTypeError();

      if (causeCode === 'CORS_BLOCKED') {
        throw createNdliError('Backend rejected this frontend origin (CORS). Add your frontend URL to CORS_ORIGINS and redeploy backend.', 'CORS_BLOCKED');
      }

      if (causeCode === 'BACKEND_SEARCH_ROUTE_ISSUE') {
        throw createNdliError('Backend is reachable, but /api/search failed. Check backend logs and route deployment.', 'BACKEND_SEARCH_ROUTE_ISSUE');
      }

      throw createNdliError('Unable to reach backend API from this network. Check backend URL/deployment and network path.', causeCode || 'BACKEND_UNREACHABLE');
    }

    throw createNdliError(err?.message || 'Search failed. Please try again.', 'UNKNOWN_ERROR');
  }
}

export async function ndliSearch(query, domain = 'se') {
  const totalAttempts = SEARCH_RETRY_COUNT + 1;
  let lastError = null;

  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    try {
      return await runSearchRequest(query, domain);
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt >= totalAttempts;

      if (isLastAttempt || !shouldRetrySearchError(error)) {
        throw error;
      }

      await delay(SEARCH_RETRY_DELAY_MS * attempt);
    }
  }

  throw lastError || createNdliError('Search failed. Please try again.', 'UNKNOWN_ERROR');
}