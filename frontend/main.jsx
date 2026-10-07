import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// Ensure relative /api calls work under Electron (file:// origin)
if (typeof window !== 'undefined' && window.location && window.location.protocol === 'file:') {
  const API_BASE = 'http://localhost:3001';
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    let url = typeof input === 'string' ? input : input && input.url;
    if (typeof url === 'string' && (url.startsWith('/api/') || url.startsWith('/health'))) {
      const full = API_BASE + url;
      if (typeof input === 'string') return originalFetch(full, init);
      return originalFetch(new Request(full, input), init);
    }
    return originalFetch(input, init);
  };
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
