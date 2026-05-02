# Quick Start: Local Embedding Service

## Three Terminal Approach

### Terminal 1: Local Embedding Service
```bash
cd embedding_service
source venv/bin/activate
python server.py
# Runs on http://127.0.0.1:8000
```

### Terminal 2: Backend
```bash
cd backend
npm start
# Automatically detects & uses local embedding service
# Falls back to hosted if local unavailable
```

### Terminal 3: Frontend
```bash
cd frontend
npm run dev
# Now at http://localhost:5173
```

## Verify It's Working

**Check local service is up:**
```bash
curl http://127.0.0.1:8000/health
# Returns: {"status":"ok","service":"embedding_service"}
```

**Check backend logs:**
Look for one of these messages:
- `✓ Local embedding service is available` → Using local
- `✗ Local embedding service unavailable, using hosted` → Using hosted

## Test Fallback

1. Stop embedding_service
2. Make a search request in frontend
3. Backend automatically uses hosted service
4. Start embedding_service again
5. Next request uses local (auto-switches!)

## Env Variables (in `backend/.env`)

| What | Where | Default |
|------|-------|---------|
| Local service | `LOCAL_EMBEDDING_SERVICE_URL` | `http://127.0.0.1:8000` |
| Hosted fallback | `HOSTED_EMBEDDING_SERVICE_URL` | Hugging Face Space |
| Health check timeout | `LOCAL_SERVICE_HEALTH_TIMEOUT_MS` | `2000` (ms) |

## Troubleshooting

**Local service not detected?**
```bash
curl http://127.0.0.1:8000/health  # Should return OK
ps aux | grep python  # Verify it's running
```

**Still using hosted when local is running?**
1. Check backend logs
2. Restart backend (health cache is 30 seconds)
3. Verify port matches in `.env`

## One-Liner to Start Everything

```bash
# In project root, start all three services:
(cd embedding_service && source venv/bin/activate && python server.py) &
(cd backend && npm start) &
(cd frontend && npm run dev) &
wait
```

---

**Need more help?** See `EMBEDDING_SERVICE_SETUP.md` for detailed guide.
