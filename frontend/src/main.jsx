import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

if (import.meta.hot) {
  import.meta.hot.on('vite:beforeUpdate', (payload) => {
    window.dispatchEvent(new CustomEvent('ndli:frontend-version-bump', {
      detail: {
        at: Date.now(),
        updateCount: payload?.updates?.length || 0,
      },
    }))
  })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
