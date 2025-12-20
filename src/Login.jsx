import React, { useState } from 'react';
import { supabase, isSupabaseConfigured } from './supabaseClient';

export default function Login() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [mensagem, setMensagem] = useState('');
    const [erro, setErro] = useState('');
    const [recoveryMode, setRecoveryMode] = useState(false);

    async function handleLogin(e) {
        e.preventDefault();
        setErro('');
        if (!email || !password) return setErro('Preencha e-mail e senha.');
        try {
            if (isSupabaseConfigured && supabase && supabase.auth && typeof supabase.auth.signInWithPassword === 'function') {
                const resp = await supabase.auth.signInWithPassword({ email, password });
                if (resp.error) return setErro(resp.error.message || 'Falha ao autenticar');
                const user = resp.data && resp.data.user ? resp.data.user : { email };
                localStorage.setItem('auth_user', JSON.stringify(user));
                window.location.reload();
            } else {
                // fallback: accept any credentials (mock)
                const user = { email, loggedAt: Date.now() };
                localStorage.setItem('auth_user', JSON.stringify(user));
                window.location.reload();
            }
        } catch (err) {
            console.error('login error', err);
            setErro('Erro desconhecido ao autenticar');
        }
    }

    async function handleRecover(e) {
        e.preventDefault();
        setErro('');
        if (!email) return setErro('Informe seu e-mail para recuperar a senha.');
        try {
            if (isSupabaseConfigured && supabase && supabase.auth && typeof supabase.auth.resetPasswordForEmail === 'function') {
                const resp = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
                if (resp.error) return setErro(resp.error.message || 'Falha ao enviar instruções');
                setMensagem('Enviamos um link de recuperação para o seu e‑mail.');
            } else {
                setMensagem('Enviamos um link de recuperação para o seu e‑mail (simulado). Verifique sua caixa de entrada.');
            }
        } catch (err) {
            console.error('recover error', err);
            setErro('Erro ao tentar recuperar senha');
        }
        setPassword('');
    }

    return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f3f4f6', fontFamily: 'Inter, sans-serif' }}>
            <div style={{ width: 420, background: '#fff', padding: 28, borderRadius: 12, boxShadow: '0 8px 30px rgba(2,6,23,0.08)' }}>
                <h2 style={{ marginTop: 0, marginBottom: 6 }}>Entrar no Dashboard</h2>
                <p style={{ marginTop: 0, color: '#6b7280', marginBottom: 20 }}>Acesse a central de despacho e monitoramento.</p>

                {mensagem && <div style={{ background: '#ecfdf5', color: '#065f46', padding: 10, borderRadius: 8, marginBottom: 12 }}>{mensagem}</div>}
                {erro && <div style={{ background: '#fff1f2', color: '#991b1b', padding: 10, borderRadius: 8, marginBottom: 12 }}>{erro}</div>}

                {!recoveryMode ? (
                    <form onSubmit={handleLogin}>
                        <label style={{ display: 'block', fontSize: 13, color: '#374151', marginBottom: 6 }}>E‑mail</label>
                        <input value={email} onChange={e => setEmail(e.target.value)} placeholder="seu@exemplo.com" style={{ width: '100%', padding: '10px 12px', marginBottom: 12, borderRadius: 8, border: '1px solid #e6e9ef' }} />

                        <label style={{ display: 'block', fontSize: 13, color: '#374151', marginBottom: 6 }}>Senha</label>
                        <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" style={{ width: '100%', padding: '10px 12px', marginBottom: 12, borderRadius: 8, border: '1px solid #e6e9ef' }} />

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                            <label style={{ fontSize: 13, color: '#6b7280' }}><input type="checkbox" style={{ marginRight: 8 }} /> Lembrar</label>
                            <button type="button" onClick={() => setRecoveryMode(true)} style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer' }}>Esqueci minha senha</button>
                        </div>

                        <button type="submit" style={{ width: '100%', padding: 12, background: '#111827', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}>ENTRAR</button>
                    </form>
                ) : (
                    <form onSubmit={handleRecover}>
                        <label style={{ display: 'block', fontSize: 13, color: '#374151', marginBottom: 6 }}>E‑mail cadastrado</label>
                        <input value={email} onChange={e => setEmail(e.target.value)} placeholder="seu@exemplo.com" style={{ width: '100%', padding: '10px 12px', marginBottom: 12, borderRadius: 8, border: '1px solid #e6e9ef' }} />
                        <div style={{ display: 'flex', gap: 10 }}>
                            <button type="submit" style={{ flex: 1, padding: 12, background: '#10b981', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}>ENVIAR INSTRUÇÕES</button>
                            <button type="button" onClick={() => setRecoveryMode(false)} style={{ flex: 1, padding: 12, background: '#efefef', color: '#374151', border: 'none', borderRadius: 8, cursor: 'pointer' }}>VOLTAR</button>
                        </div>
                    </form>
                )}

                <div style={{ marginTop: 14, fontSize: 13, color: '#9ca3af' }}>
                    <div>Não tem conta? Peça cadastro ao administrador.</div>
                </div>
            </div>
        </div>
    );
}
