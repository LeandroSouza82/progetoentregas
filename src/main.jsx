import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'           // O Dashboard do Gestor
import DriverApp from './DriverApp.jsx' // O App do Motorista

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* Sempre renderiza o Dashboard principal (Desktop fixo) */}
    <App />
  </React.StrictMode>,
)