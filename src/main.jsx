import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import App from './App.jsx'           // O Dashboard do Gestor (usa Leaflet + OpenStreetMap)
import PrivacyPolicy from './components/PrivacyPolicy.jsx'
import TermsOfService from './components/TermsOfService.jsx'

// ✅ V10 Delivery usa Leaflet (gratuito) - Google Maps removido
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/privacy" element={<PrivacyPolicy />} />
        <Route path="/terms" element={<TermsOfService />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
