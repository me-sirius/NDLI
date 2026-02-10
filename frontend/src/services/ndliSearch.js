// In development: Vite proxy rewrites /api/ndli/* → https://test.ndl.iitkgp.ac.in/rest/*
// In production:  Requests go to the Express backend at VITE_API_URL (e.g. http://localhost:4000)

const API_BASE = import.meta.env.VITE_API_URL || '';

export async function ndliSearch(query, domain = 'se') {
  const formData = new FormData();
  formData.append('query', query);
  formData.append('domain', domain);

  // Dev  → /api/ndli/aiOverview.php  (Vite proxy handles it)
  // Prod → http://localhost:4000/api/search  (Express backend)
  const url = API_BASE
    ? `${API_BASE}/api/search`
    : '/api/ndli/aiOverview.php';

  const res = await fetch(url, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    throw new Error('NDLI search failed');
  }

  return res.json();
}