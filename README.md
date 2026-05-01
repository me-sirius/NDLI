# NDLI Search — One India, One Library

A modern, AI-powered search interface for the **National Digital Library of India (NDLI)**. The app uses a backend RAG pipeline to turn NDLI rows into grounded summaries with extractive evidence, citations, and optional narrative overviews. Built as part of the **Design Lab** course (Spring 2026, Semester 8).

![Tech Stack](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-7-646CFF?logo=vite&logoColor=white)
![TailwindCSS](https://img.shields.io/badge/Tailwind-4-06B6D4?logo=tailwindcss&logoColor=white)
![Express](https://img.shields.io/badge/Express-4-000000?logo=express&logoColor=white)

---

## ✨ Features

- 🔍 **Live NDLI Search** — Real-time search across 8 educational domains
- 🤖 **AI Summaries with Evidence** — Extractive snippets, citations, and optional narrative generation
- 🎨 **Premium UI** — Modern design with animations, gradient borders, shimmer loaders
- ⚡ **Debounced Search** — Efficient API calls with 600ms debounce
- 🌐 **Backend-Only NDLI Access** — Frontend calls only Express backend, backend calls NDLI
- ☁️ **Current Deployment** — Frontend on Netlify, backend on Heroku, embedding service on HuggingFace Spaces
- 📱 **Responsive** — Works on desktop and mobile

## 🏗️ Project Structure

```
ndli-mock/
├── frontend/                 # React + Vite frontend
│   ├── src/
│   │   ├── pages/
│   │   │   └── Home.jsx      # Main search page
│   │   ├── services/
│   │   │   └── ndliSearch.js  # NDLI API service
│   │   ├── index.css          # Design system & animations
│   │   ├── App.jsx            # Root component
│   │   └── main.jsx           # Entry point
│   ├── vite.config.js         # Vite config with dev proxy
│   └── package.json
│
├── backend/                   # Express proxy backend + RAG summarizer
│   ├── server.js              # NDLI proxy API
│   ├── summarizer.js          # Semantic retrieval + narrative generation
│   ├── vercel.json            # Legacy deployment config
│   ├── package.json
│   └── .gitignore
│
├── embedding_service/         # FastAPI embedding + summarization service
│   ├── server.py              # /embed and /summarize endpoints
│   ├── requirements.txt
│   └── venv/                  # Local development environment
│
├── docs/                      # Internal engineering docs
├── experiments/               # Notebook experiments and prototyping
│
└── README.md                  # This file
```

## 🚀 Getting Started

### Prerequisites

- **Node.js** ≥ 18
- **npm** ≥ 9

### 1. Clone the repo

```bash
git clone <your-repo-url>
cd ndli-mock
```

### 2. Install dependencies

```bash
# Frontend
cd frontend
npm install

# Backend
cd ../backend
npm install
```

### 3. Configure environment

Create these env files manually:

`backend/.env`

```env
PORT=4000
NDLI_URL=https://test.ndl.iitkgp.ac.in/rest/aiOverview.php
NDLI_TIMEOUT_MS=25000
NDLI_RETRY_COUNT=1
NDLI_RETRY_DELAY_MS=350
CORS_ORIGINS=http://localhost:5173,http://localhost:4173,https://ndli-search.netlify.app
EMBEDDING_SERVICE_URL=https://your-huggingface-space-url
EMBEDDING_SERVICE_TIMEOUT_MS=4500
AI_OVERVIEW_SUMMARIZE_TIMEOUT_MS=45000
AI_OVERVIEW_MAX_ROWS=20
AI_OVERVIEW_RAG_EVIDENCE_SENTENCE_LIMIT=24
AI_OVERVIEW_RAG_MAX_NEW_TOKENS=800
AI_OVERVIEW_ALIGNMENT_THRESHOLD=0.55
AI_OVERVIEW_GENERATIVE=true
```

`frontend/.env`

```env
VITE_API_URL=http://localhost:4000
VITE_PREFER_LOCAL_BACKEND=true
```

### 4. Run in development

Start backend first:

```bash
cd backend
npm run dev
# → http://localhost:4000
```

Start frontend in another terminal:

```bash
cd frontend
npm run dev
# → http://localhost:5173
```

In local development, frontend still calls backend URL from `VITE_API_URL`.
Set `VITE_API_URL=http://localhost:4000` in `frontend/.env` to use local backend.

### 5. Run in production mode

```bash
# Build the frontend
cd frontend
npm run build

# Set the deployed backend URL and build
VITE_API_URL=https://your-backend-domain.com npm run build
npm run preview

# In another terminal, start the backend
cd ../backend
npm start
```

### 6. Deployment notes

Current deployment:

- Frontend: Netlify — https://ndli-search.netlify.app/
- Backend: Heroku — https://ndli-backend-eeb9df102f66.herokuapp.com/
- embedding_services: HuggingFace Spaces

The steps below are kept for local development reference.

Backend deploy (reference only):

1. Create a backend project from `backend/`.
2. Set backend environment variables in the hosting provider.
3. Deploy and verify:
- `GET https://ndli-backend-eeb9df102f66.herokuapp.com/health`
- `POST https://ndli-backend-eeb9df102f66.herokuapp.com/api/search`

Local frontend (continue development):

1. Set `frontend/.env`:

```env
VITE_API_URL=https://ndli-backend-eeb9df102f66.herokuapp.com
```

2. Run frontend locally:

```bash
cd frontend
npm run dev
```

3. Open local app and search; requests now go to the deployed backend.

Important:

- `CORS_ORIGINS` must include `http://localhost:5173` for local frontend dev.
- Add your deployed frontend origin in `CORS_ORIGINS` for production usage.
- `CORS_ORIGINS` supports wildcard entries for preview deployments.

## 🌐 Search Domains

| Key  | Domain                 |
|------|------------------------|
| `se` | School Education       |
| `he` | Higher Education       |
| `cd` | Career Development     |
| `rs` | Research               |
| `ps` | Patents & Standards    |
| `jr` | Judicial Resources     |
| `ca` | Cultural Archives      |
| `na` | Newspaper Archives     |

## 🔌 API

Application endpoint used by frontend:

```
POST /api/search
Content-Type: application/json

{
  "query": "<search term>",
  "domain": "<domain key>"
}
```

Backend forwards request to NDLI:

```
POST https://test.ndl.iitkgp.ac.in/rest/aiOverview.php
Content-Type: application/x-www-form-urlencoded
```

Backend responds with normalized JSON:

```
{
  "query": "...",
  "domain": "...",
  "count": 20,
  "aiSummary": {
    "snippet": "...",
    "snippetWithCitations": "...",
    "sentences": ["..."],
    "sentenceDetails": [
      {
        "text": "...",
        "confidence": 0.88,
        "sourceRef": 1,
        "citation": "[1]"
      }
    ],
    "sources": [
      {
        "title": "...",
        "url": "...",
        "author": "...",
        "ref": 1
      }
    ],
    "meta": {
      "status": "generated",
      "summarizer": "up",
      "alignment": "passed"
    }
  },
  "aiOverview": { ... },
  "rows": [ ... ]
}
```

## 🛠️ Tech Stack

| Layer      | Technology                              |
|------------|-----------------------------------------|
| Frontend   | React 19, Vite 7, Tailwind v4           |
| Backend    | Express 4 + RAG summarizer              |
| API        | NDLI REST API (IIT Kharagpur)           |
| Embedding  | FastAPI + SentenceTransformers + FLAN-T5 |
| Fonts      | Inter (Google Fonts)                    |

## 📝 Notes

- NDLI API communication is done only from backend to avoid browser CORS/network restrictions.
- Search is debounced at 600ms to prevent excessive API calls.
- The AI summary uses a RAG-style pipeline with extractive evidence and optional narrative generation.
- For local frontend + hosted backend, set `frontend/.env` with the backend URL via `VITE_API_URL`.
- The current production deployment is frontend on Netlify, backend on Heroku, and the embedding service on HuggingFace Spaces.

---

**Design Lab · Spring 2026 · Semester 8**
