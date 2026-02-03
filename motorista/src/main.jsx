import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'           // O Dashboard do Gestor
import DriverApp from './DriverApp.jsx' // O App do Motorista
import { APIProvider } from '@vis.gl/react-google-maps'

const GOOGLE_MAPS_API_KEY = (typeof import.meta !== 'undefined' && import.meta.env) ? (import.meta.env.VITE_GOOGLE_MAPS_KEY || 'AIzaSyBeec8r4DWBdNIEFSEZg1CgRxIHjYMV9dM') : 'AIzaSyBeec8r4DWBdNIEFSEZg1CgRxIHjYMV9dM';

// --- LÓGICA DO GUARDA DE TRÂNSITO ---
// Verifica se a rota indica /motorista via pathname ou hash (suporta '#/motorista')
const path = (typeof window !== 'undefined' && window.location && window.location.pathname) ? window.location.pathname : '';
const hash = (typeof window !== 'undefined' && window.location && window.location.hash) ? window.location.hash : '';
const isMotorista = path.startsWith('/motorista') || hash.includes('/motorista') || hash.includes('motorista');

ReactDOM.createRoot(document.getElementById('root')).render(
  <APIProvider apiKey={GOOGLE_MAPS_API_KEY}>
    {isMotorista ? <DriverApp /> : <App />}
  </APIProvider>
);
