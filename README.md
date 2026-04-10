# NDLI Search — One India, One Library

A modern, AI-powered search interface for the **National Digital Library of India (NDLI)**. Built as part of the **Design Lab** course (Spring 2026, Semester 8).

![Tech Stack](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-7-646CFF?logo=vite&logoColor=white)
![TailwindCSS](https://img.shields.io/badge/Tailwind-4-06B6D4?logo=tailwindcss&logoColor=white)
![Express](https://img.shields.io/badge/Express-4-000000?logo=express&logoColor=white)

---

## ✨ Features

- 🔍 **Live NDLI Search** — Real-time search across 8 educational domains
- 🤖 **AI-Generated Summaries** — Extracts key insights from top results
- 🎨 **Premium UI** — Modern design with animations, gradient borders, shimmer loaders
- ⚡ **Debounced Search** — Efficient API calls with 600ms debounce
- 🌐 **Backend-Only NDLI Access** — Frontend calls only Express backend, backend calls NDLI
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
├── backend/                   # Express proxy backend
│   ├── server.js              # Proxy server (forwards to NDLI API)
│   ├── vercel.json            # Vercel routing/build config
│   ├── package.json
│   └── .gitignore
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
NDLI_TIMEOUT_MS=15000
CORS_ORIGINS=http://localhost:5173,http://localhost:4173,https://your-frontend-domain.vercel.app,https://your-frontend-domain-*.vercel.app
```

`frontend/.env`

```env
VITE_API_URL=http://localhost:4000
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

### 6. Deploy backend on Vercel and continue frontend locally

Backend deploy (Vercel):

1. Create a new Vercel project from `backend/`.
2. Keep framework preset as **Other**.
3. Vercel uses `backend/vercel.json` to route all requests to `server.js`.
4. Set backend environment variables in Vercel:

```env
NDLI_URL=https://test.ndl.iitkgp.ac.in/rest/aiOverview.php
NDLI_TIMEOUT_MS=15000
CORS_ORIGINS=http://localhost:5173,http://localhost:4173,https://your-frontend-domain.vercel.app,https://your-frontend-domain-*.vercel.app
```

5. Deploy and verify:
- `GET https://your-backend-domain.vercel.app/health`
- `POST https://your-backend-domain.vercel.app/api/search`

Local frontend (continue development):

1. Set `frontend/.env`:

```env
VITE_API_URL=https://your-backend-domain.vercel.app
```

2. Run frontend locally:

```bash
cd frontend
npm run dev
```

3. Open local app and search; requests now go to your Vercel backend.

Important:

- `CORS_ORIGINS` must include `http://localhost:5173` for local frontend dev.
- Add your deployed frontend origin (e.g. Vercel frontend URL) in `CORS_ORIGINS` for production usage.
- `CORS_ORIGINS` supports wildcard entries like `https://your-frontend-domain-*.vercel.app` for Vercel preview deployments.

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
  "rows": [ ... ]
}
```

## 🛠️ Tech Stack

| Layer    | Technology                     |
|----------|--------------------------------|
| Frontend | React 19, Vite 7, Tailwind v4  |
| Backend  | Express 4 (CORS proxy)         |
| API      | NDLI REST API (IIT Kharagpur)  |
| Fonts    | Inter (Google Fonts)           |

## 📝 Notes

- NDLI API communication is done only from backend to avoid browser CORS/network restrictions.
- Search is debounced at 600ms to prevent excessive API calls.
- The AI summary is an extractive summary from the top 3 results (not a generative AI model).
- For local frontend + hosted backend, set `frontend/.env` with hosted backend URL via `VITE_API_URL`.

---

**Design Lab · Spring 2026 · Semester 8**
