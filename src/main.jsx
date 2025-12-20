import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'           // O Dashboard do Gestor
import DriverApp from './DriverApp.jsx' // O App do Motorista

// --- LÓGICA DO GUARDA DE TRÂNSITO ---
// Verifica se o link tem a palavra "motorista" OU se está em um dispositivo móvel
const url = window.location.href;
const isMotoristaURL = url.includes('motorista');
const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
const isMotorista = isMotoristaURL || isMobile;

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* Se for motorista (URL ou celular), abre o DriverApp. Se não, abre o App (Dashboard) */}
    {isMotorista ? <DriverApp /> : <App />}
  </React.StrictMode>,
)