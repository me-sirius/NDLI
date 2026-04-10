import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { buildExtractiveOverview } from './summarizer.js';

const app = express();
const PORT = Number(process.env.PORT) || 4000;
const NDLI_URL = process.env.NDLI_URL || 'https://test.ndl.iitkgp.ac.in/rest/aiOverview.php';
const NDLI_TIMEOUT_MS = parsePositiveInt(process.env.NDLI_TIMEOUT_MS, 25000);
const NDLI_RETRY_COUNT = parseNonNegativeInt(process.env.NDLI_RETRY_COUNT, 1);
const NDLI_RETRY_DELAY_MS = parsePositiveInt(process.env.NDLI_RETRY_DELAY_MS, 350);
const ALLOWED_DOMAINS = new Set(['se', 'he', 'cd', 'rs', 'ps', 'jr', 'ca', 'na']);
const DEFAULT_CORS_ORIGINS = ['http://localhost:5173', 'http://localhost:4173'];
const RETRYABLE_UPSTREAM_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ECONNRESET',
  'EHOSTUNREACH',
]);

const CORS_ORIGINS = (process.env.CORS_ORIGINS || DEFAULT_CORS_ORIGINS.join(','))
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const CORS_ORIGIN_RULES = CORS_ORIGINS.map((rule) => ({
  rule,
  matcher: rule.includes('*')
    ? new RegExp(`^${rule
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\\\*/g, '.*')}$`)
    : null,
}));
const CURRENT_FILE = fileURLToPath(import.meta.url);

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parseNonNegativeInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableUpstreamStatus(status) {
  return status === 429 || status >= 500;
}

function isRetryableUpstreamError(error) {
  const causeCode = error?.cause?.code;
  return error?.name === 'AbortError' || RETRYABLE_UPSTREAM_CODES.has(causeCode);
}

function createRequestId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function previewQuery(query, max = 80) {
  return query.length > max ? `${query.slice(0, max)}...` : query;
}

function pickFirstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function normalizeRow(row, index) {
  const title = pickFirstString(row?.title, row?.name);
  const author = pickFirstString(row?.author, row?.creator, row?.authors);
  const desc = pickFirstString(row?.desc, row?.description, row?.text, row?.content, row?.snippet);
  const type = pickFirstString(row?.type, row?.doctype, row?.resourceType).toLowerCase();
  const url = pickFirstString(row?.url, row?.link, row?.source_url) || '#';
  const year = pickFirstString(
    String(row?.year ?? ''),
    String(row?.publishYear ?? ''),
    String(row?.publication_year ?? ''),
  );

  return {
    id: row?.id ?? `result-${index + 1}`,
    title: title || 'Untitled',
    author: author || 'NDLI',
    desc,
    type,
    year,
    url,
  };
}

function isAllowedOrigin(origin) {
  return CORS_ORIGIN_RULES.some(({ rule, matcher }) => {
    if (rule === '*') return true;
    if (matcher) return matcher.test(origin);
    return rule === origin;
  });
}

async function fetchFromNdliWithRetry({ requestId, payload, domain }) {
  const totalAttempts = NDLI_RETRY_COUNT + 1;

  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), NDLI_TIMEOUT_MS);
    const upstreamStartMs = Date.now();

    try {
      console.info(`[${requestId}] /api/search: forwarding to NDLI`, {
        ndliUrl: NDLI_URL,
        domain,
        attempt,
        totalAttempts,
      });

      const ndliRes = await fetch(NDLI_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: payload,
        signal: controller.signal,
      });

      console.info(`[${requestId}] /api/search: NDLI responded`, {
        status: ndliRes.status,
        statusText: ndliRes.statusText,
        upstreamDurationMs: Date.now() - upstreamStartMs,
        attempt,
        totalAttempts,
      });

      if (attempt < totalAttempts && isRetryableUpstreamStatus(ndliRes.status)) {
        console.warn(`[${requestId}] /api/search: retrying NDLI after upstream status`, {
          status: ndliRes.status,
          attempt,
          totalAttempts,
        });

        try {
          await ndliRes.arrayBuffer();
        } catch {
          // Ignore response drain issues before retrying.
        }

        await wait(NDLI_RETRY_DELAY_MS * attempt);
        continue;
      }

      return ndliRes;
    } catch (error) {
      const causeCode = error?.cause?.code;
      const retryable = isRetryableUpstreamError(error);

      console.warn(`[${requestId}] /api/search: NDLI call failed`, {
        message: error?.message,
        name: error?.name,
        causeCode,
        upstreamDurationMs: Date.now() - upstreamStartMs,
        attempt,
        totalAttempts,
        retryable,
      });

      if (!retryable || attempt >= totalAttempts) {
        throw error;
      }

      await wait(NDLI_RETRY_DELAY_MS * attempt);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw new Error('NDLI request failed after retries');
}

// ─── Middleware ───────────────────────────────────────────────────────────────
app.set('trust proxy', true);

app.use(cors({
  origin: (origin, callback) => {
    // Allow non-browser and server-to-server requests.
    if (!origin) return callback(null, true);
    if (isAllowedOrigin(origin)) return callback(null, true);

    return callback(new Error(`Origin not allowed by CORS: ${origin}`));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
}));

// Parse URL-encoded bodies (e.g. from standard HTML forms)
app.use(express.urlencoded({ extended: true }));

// Parse JSON bodies
app.use(express.json());

// ─── Health check ────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── NDLI Proxy ──────────────────────────────────────────────────────────────
// POST /api/search  →  forwards to NDLI's aiOverview.php
app.post('/api/search', async (req, res) => {
  const requestId = createRequestId();
  const startMs = Date.now();

  try {
    const query = String(req.body?.query ?? '').trim();
    const requestedDomain = String(req.body?.domain ?? 'se').trim().toLowerCase();
    const domain = ALLOWED_DOMAINS.has(requestedDomain) ? requestedDomain : 'se';

    console.info(`[${requestId}] /api/search: request received`, {
      ip: req.ip,
      requestedDomain,
      resolvedDomain: domain,
      queryPreview: previewQuery(query),
      queryLength: query.length,
    });

    if (!query) {
      console.warn(`[${requestId}] /api/search: missing query`);
      return res.status(400).json({ error: 'Missing required field: query' });
    }

    const payload = new URLSearchParams({ query, domain });
    const ndliRes = await fetchFromNdliWithRetry({ requestId, payload, domain });

    if (!ndliRes.ok) {
      console.error(`[${requestId}] /api/search: NDLI request failed`, {
        status: ndliRes.status,
        statusText: ndliRes.statusText,
      });
      return res.status(ndliRes.status).json({
        error: `NDLI API error: ${ndliRes.status} ${ndliRes.statusText}`,
      });
    }

    const raw = await ndliRes.json();
    const rows = Array.isArray(raw?.rows) ? raw.rows : [];
    const normalizedRows = rows.map(normalizeRow).filter((r) => r.title || r.desc);
    const aiOverview = buildExtractiveOverview({
      query,
      rows: normalizedRows,
      minSentences: 2,
      maxSentences: 4,
    });

    res.json({
      query,
      domain,
      count: normalizedRows.length,
      aiOverview,
      rows: normalizedRows,
    });

    console.info(`[${requestId}] /api/search: response sent`, {
      resultCount: normalizedRows.length,
      aiSentenceCount: aiOverview?.sentences?.length || 0,
      totalDurationMs: Date.now() - startMs,
    });
  } catch (err) {
    const causeCode = err?.cause?.code;

    console.error(`[${requestId}] /api/search: unexpected error`, {
      message: err.message,
      causeCode,
      totalDurationMs: Date.now() - startMs,
    });

    if (err.name === 'AbortError') {
      return res.status(504).json({
        error: `NDLI request timed out after ${NDLI_TIMEOUT_MS}ms`,
        details: err.message,
      });
    }

    if (causeCode === 'ENOTFOUND' || causeCode === 'EAI_AGAIN') {
      return res.status(502).json({
        error: 'Unable to resolve NDLI host from this network',
        details: err.message,
      });
    }

    if (causeCode === 'ECONNREFUSED' || causeCode === 'ETIMEDOUT') {
      return res.status(502).json({
        error: 'Unable to connect to NDLI from this network',
        details: err.message,
      });
    }

    res.status(500).json({ error: 'Failed to reach NDLI API', details: err.message });
  }
});

app.use((err, _req, res, next) => {
  if (typeof err?.message === 'string' && err.message.startsWith('Origin not allowed by CORS:')) {
    return res.status(403).json({ error: err.message });
  }

  return next(err);
});

function startServer() {
  app.listen(PORT, () => {
    console.log(`\n🚀 NDLI Backend running on http://localhost:${PORT}`);
    console.log(`   Health check: http://localhost:${PORT}/health`);
    console.log(`   Search proxy: POST http://localhost:${PORT}/api/search\n`);
    console.log(`   NDLI URL: ${NDLI_URL}`);
    console.log(`   NDLI timeout: ${NDLI_TIMEOUT_MS}ms`);
    console.log(`   NDLI retries: ${NDLI_RETRY_COUNT}`);
    console.log(`   NDLI retry delay: ${NDLI_RETRY_DELAY_MS}ms`);
    console.log(`   CORS origins: ${CORS_ORIGINS.join(', ')}\n`);
  });
}

if (process.argv[1] === CURRENT_FILE) {
  startServer();
}

export default app;
