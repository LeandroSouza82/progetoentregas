import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'           // O Dashboard do Gestor
import DriverApp from './DriverApp.jsx' // O App do Motorista
import { APIProvider } from '@vis.gl/react-google-maps'

const GOOGLE_MAPS_API_KEY = (typeof import.meta !== 'undefined' && import.meta.env) ? (import.meta.env.VITE_GOOGLE_MAPS_KEY || 'AIzaSyBeec8r4DWBdNIEFSEZg1CgRxIHjYMV9dM') : 'AIzaSyBeec8r4DWBdNIEFSEZg1CgRxIHjYMV9dM';

// --- REGISTRO DO SERVICE WORKER ---
// Registra o SW para permitir notificações push em background
if ('serviceWorker' in navigator && window.location.pathname.includes('/motorista')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/service-worker.js')
      .then((registration) => {
        console.log('✅ Service Worker registrado com sucesso:', registration.scope);

        // Verifica se há atualização do SW
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          console.log('🔄 Nova versão do Service Worker encontrada');

          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              console.log('✨ Nova versão disponível. Recarregue a página.');
              // Poderia mostrar um toast/alerta aqui
            }
          });
        });
      })
      .catch((error) => {
        console.error('❌ Erro ao registrar Service Worker:', error);
      });
  });
}

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
