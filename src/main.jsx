import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'           // O Dashboard do Gestor
import DriverApp from './DriverApp.jsx' // O App do Motorista
import Login from './Login.jsx'
import { isSupabaseConfigured, supabase } from './supabaseClient'

// --- LÓGICA DO GUARDA DE TRÂNSITO ---
// Verifica se o link tem a palavra "motorista" OU se está em um dispositivo móvel
const url = window.location.href;
const isMotoristaURL = url.includes('motorista');
const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
const isMotorista = isMotoristaURL || isMobile;
const isAuthenticated = !!localStorage.getItem('auth_user');

function AuthLoader() {
  // If Supabase is configured, try to retrieve current user and persist locally
  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        if (isSupabaseConfigured && supabase && supabase.auth && typeof supabase.auth.getUser === 'function') {
          const resp = await supabase.auth.getUser();
          if (mounted && resp && resp.data && resp.data.user) {
            localStorage.setItem('auth_user', JSON.stringify(resp.data.user));
            window.location.reload();
          }
        }
      } catch (e) {
        console.warn('AuthLoader error', e);
      }
    })();
    return () => { mounted = false };
  }, []);
  return <div style={{ padding: 24, fontFamily: 'Inter, sans-serif' }}>Verificando sessão...</div>;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* Se for motorista (URL ou celular), abre o DriverApp. Se não, abre o App (Dashboard) */}
    {isMotorista ? <DriverApp /> : (isAuthenticated ? <App /> : (isSupabaseConfigured ? <AuthLoader /> : <Login />))}
  </React.StrictMode>,
)