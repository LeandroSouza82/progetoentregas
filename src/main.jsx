import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'           // O Dashboard do Gestor (usa Leaflet + OpenStreetMap)

// ✅ V10 Delivery usa Leaflet (gratuito) - Google Maps removido
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
