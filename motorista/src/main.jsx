import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'           // O Dashboard do Gestor
import DriverApp from './DriverApp.jsx' // O App do Motorista

// --- LÓGICA DO GUARDA DE TRÂNSITO ---
// Verifica se na URL tem a palavra "motorista"
const url = window.location.href;
const isMotorista = url.includes('motorista');

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* Se for motorista, carrega o App. Se não, carrega o Dashboard */}
    {isMotorista ? <DriverApp /> : <App />}
  </React.StrictMode>,
)