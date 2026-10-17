import React from 'react';
import ReactDOM from 'react-dom/client';
import { resolveEnvironment } from './environment.js';
import './index.css';

const root = ReactDOM.createRoot(document.getElementById('root'));

async function start() {
    let environment;
    try { environment = resolveEnvironment(import.meta.env); }
    catch (error) {
        root.render(<main style={{ maxWidth: 560, margin: '12vh auto', padding: 24, fontFamily: 'sans-serif' }}>
            <h1>V10 Teste — configuração pendente</h1>
            <p role="alert">{error.message}</p>
            <p>O painel não iniciou conexão com o banco. Configure o ambiente de homologação e reinicie.</p>
        </main>);
        return;
    }
    // Só carrega o aplicativo e seus serviços depois de validar o ambiente.
    await import('leaflet/dist/leaflet.css');
    const { default: App } = await import('./App.jsx');
    root.render(<React.StrictMode>
        {environment.isTest && <div role="status" style={{ background: '#fef3c7', color: '#78350f', padding: 10, textAlign: 'center', fontWeight: 700 }}>V10 Teste · Homologação · Dados de teste</div>}
        <App />
    </React.StrictMode>);
}
start();
