// Frontend prefers local backend when running locally and it is reachable.
const API_BASE = (import.meta.env.VITE_API_URL || '').trim().replace(/\/$/, '');
const LOCAL_API_BASE = (import.meta.env.VITE_LOCAL_API_URL || 'http://localhost:4000').trim().replace(/\/$/, '');
const REQUEST_TIMEOUT_MS = parsePositiveInt(import.meta.env.VITE_REQUEST_TIMEOUT_MS, 32000);
const HEALTHCHECK_TIMEOUT_MS = parsePositiveInt(import.meta.env.VITE_HEALTHCHECK_TIMEOUT_MS, 4500);
const LOCAL_BACKEND_PING_TIMEOUT_MS = parsePositiveInt(import.meta.env.VITE_LOCAL_BACKEND_PING_TIMEOUT_MS, 850);
const SEARCH_RETRY_COUNT = parseNonNegativeInt(import.meta.env.VITE_SEARCH_RETRY_COUNT, 1);
const SEARCH_RETRY_DELAY_MS = parsePositiveInt(import.meta.env.VITE_SEARCH_RETRY_DELAY_MS, 400);
const PREFER_LOCAL_BACKEND = parseBoolean(import.meta.env.VITE_PREFER_LOCAL_BACKEND, import.meta.env.DEV);
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

function parseBoolean(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  }
  return fallback;
}

function normalizeBaseUrl(url) {
  return String(url || '').trim().replace(/\/$/, '');
}

function toApiInfo(baseUrl) {
  const normalized = normalizeBaseUrl(baseUrl);
  const searchEndpoint = normalized ? `${normalized}/api/search` : '';
  const healthEndpoint = normalized ? `${normalized}/health` : '';

  let host = '';
  if (normalized) {
    try {
      host = new URL(normalized).host;
    } catch {
      host = normalized;
    }
  }

  return {
    baseUrl: normalized,
    host,
    searchEndpoint,
    healthEndpoint,
  };
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

function withApiInfo(extras, apiInfo) {
  return {
    ...extras,
    apiInfo,
  };
}

export function getBackendApiInfo() {
  const preferredBase = (PREFER_LOCAL_BACKEND && LOCAL_API_BASE) ? LOCAL_API_BASE : (API_BASE || LOCAL_API_BASE);
  return toApiInfo(preferredBase);
}

async function isBackendHealthy(baseUrl, timeoutMs = HEALTHCHECK_TIMEOUT_MS) {
  const { healthEndpoint } = toApiInfo(baseUrl);
  if (!healthEndpoint) return false;

  try {
    const healthRes = await fetchWithTimeout(healthEndpoint, {
      method: 'GET',
      cache: 'no-store',
    }, timeoutMs);

    return healthRes.ok;
  } catch {
    return false;
  }
}

async function resolveBackendApiInfo() {
  if (PREFER_LOCAL_BACKEND && LOCAL_API_BASE) {
    const localHealthy = await isBackendHealthy(LOCAL_API_BASE, LOCAL_BACKEND_PING_TIMEOUT_MS);
    if (localHealthy) return toApiInfo(LOCAL_API_BASE);
  }

  if (API_BASE) return toApiInfo(API_BASE);
  if (LOCAL_API_BASE) return toApiInfo(LOCAL_API_BASE);

  throw new Error('No backend URL configured. Set VITE_API_URL or VITE_LOCAL_API_URL.');
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

async function diagnoseTypeError(apiInfo) {
  const { healthEndpoint } = apiInfo;
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
  const apiInfo = await resolveBackendApiInfo();

  try {
    const res = await fetchWithTimeout(apiInfo.searchEndpoint, {
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
          ...withApiInfo({
            status: res.status,
            backendMessage: message,
            details,
          }, apiInfo),
        });
      }

      throw createNdliError(`${message} (HTTP ${res.status})`, 'BACKEND_API_ERROR', {
        ...withApiInfo({
          status: res.status,
          backendMessage: message,
          details,
        }, apiInfo),
      });
    }

    const data = await res.json();
    if (data && typeof data === 'object') {
      data._requestMeta = {
        baseUrl: apiInfo.baseUrl,
        host: apiInfo.host,
        searchEndpoint: apiInfo.searchEndpoint,
        healthEndpoint: apiInfo.healthEndpoint,
      };
    }

    return data;
  } catch (err) {
    if (err?.code) {
      throw err;
    }

    if (err.name === 'AbortError') {
      throw createNdliError(
        `Backend API did not respond within ${REQUEST_TIMEOUT_MS}ms.`,
        'BACKEND_TIMEOUT',
        withApiInfo({}, apiInfo),
      );
    }

    if (err.name === 'TypeError') {
      const causeCode = await diagnoseTypeError(apiInfo);

      if (causeCode === 'CORS_BLOCKED') {
        throw createNdliError(
          'Backend rejected this frontend origin (CORS). Add your frontend URL to CORS_ORIGINS and redeploy backend.',
          'CORS_BLOCKED',
          withApiInfo({}, apiInfo),
        );
      }

      if (causeCode === 'BACKEND_SEARCH_ROUTE_ISSUE') {
        throw createNdliError(
          'Backend is reachable, but /api/search failed. Check backend logs and route deployment.',
          'BACKEND_SEARCH_ROUTE_ISSUE',
          withApiInfo({}, apiInfo),
        );
      }

      throw createNdliError(
        'Unable to reach backend API from this network. Check backend URL/deployment and network path.',
        causeCode || 'BACKEND_UNREACHABLE',
        withApiInfo({}, apiInfo),
      );
    }

    throw createNdliError(
      err?.message || 'Search failed. Please try again.',
      'UNKNOWN_ERROR',
      withApiInfo({}, apiInfo),
    );
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