import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 4000;

// ─── CORS ────────────────────────────────────────────────────────────────────
// Allow frontend origins (dev + production)
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:4173',  // Vite preview
  ],
  methods: ['GET', 'POST'],
}));

// ─── Health check ────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── NDLI Proxy ──────────────────────────────────────────────────────────────
// POST /api/search  →  forwards to NDLI's aiOverview.php
app.post('/api/search', async (req, res) => {
  try {
    // Read the incoming form data (query + domain)
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const bodyBuffer = Buffer.concat(chunks);

    // Forward the request to the NDLI API
    const ndliRes = await fetch(
      'https://test.ndl.iitkgp.ac.in/rest/aiOverview.php',
      {
        method: 'POST',
        headers: {
          'Content-Type': req.headers['content-type'],
        },
        body: bodyBuffer,
      }
    );

    if (!ndliRes.ok) {
      return res.status(ndliRes.status).json({
        error: `NDLI API error: ${ndliRes.status} ${ndliRes.statusText}`,
      });
    }

    const data = await ndliRes.json();
    res.json(data);
  } catch (err) {
    console.error('❌ Proxy error:', err.message);
    res.status(500).json({ error: 'Failed to reach NDLI API', details: err.message });
  }
});

// ─── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 NDLI Backend running on http://localhost:${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/health`);
  console.log(`   Search proxy: POST http://localhost:${PORT}/api/search\n`);
});
