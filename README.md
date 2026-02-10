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
- 🌐 **CORS Proxy** — Dev proxy (Vite) + production proxy (Express backend)
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

### 3. Run in development

**Frontend** (with Vite dev proxy — no backend needed):

```bash
cd frontend
npm run dev
# → http://localhost:5173
```

The Vite dev proxy automatically forwards `/api/ndli/*` requests to `https://test.ndl.iitkgp.ac.in/rest/*`, bypassing CORS.

**Backend** (needed for production builds):

```bash
cd backend
npm run dev
# → http://localhost:4000
```

### 4. Run in production mode

```bash
# Build the frontend
cd frontend
npm run build

# Set the backend URL and preview
VITE_API_URL=http://localhost:4000 npm run build
npm run preview

# In another terminal, start the backend
cd ../backend
npm start
```

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

The NDLI API endpoint used:

```
POST https://test.ndl.iitkgp.ac.in/rest/aiOverview.php
Content-Type: multipart/form-data

FormData:
  query  = <search term>
  domain = <domain key>
```

**Response** returns `{ rows: [...], ... }` with search results.

## 🛠️ Tech Stack

| Layer    | Technology                     |
|----------|--------------------------------|
| Frontend | React 19, Vite 7, Tailwind v4  |
| Backend  | Express 4 (CORS proxy)         |
| API      | NDLI REST API (IIT Kharagpur)  |
| Fonts    | Inter (Google Fonts)           |

## 📝 Notes

- The NDLI API has strict CORS headers that only allow their own domain. The Vite dev proxy and Express backend both solve this by making server-side requests.
- Search is debounced at 600ms to prevent excessive API calls.
- The AI summary is an extractive summary from the top 3 results (not a generative AI model).

---

**Design Lab · Spring 2026 · Semester 8**
