import React, { useState } from 'react';
import './Login.css';
import { supabase } from '../supabaseClient';

const Login = ({ onLoginSuccess, onIrParaCadastro }) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [rememberMe, setRememberMe] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            // Verificar se o cliente Supabase está disponível
            if (!supabase || !supabase.auth) {
                throw new Error('Sistema de autenticação temporáriamente indisponível. Verifique as configurações do .env.local e reinicie o terminal.');
            }

            // Autenticar com Supabase
            const { data, error: authError } = await supabase.auth.signInWithPassword({
                email: email.trim(),
                password: password,
            });

            if (authError) {
                throw authError;
            }

            // Login bem-sucedido
            console.log('✅ [V10 Delivery] Login realizado com sucesso:', data.user?.email);
            console.log('ℹ️ [V10 Delivery] onAuthStateChange vai detectar login automaticamente');

            // NÃO chamar onLoginSuccess aqui - o onAuthStateChange no App.jsx vai lidar com isso
            // Isso previne o loop de login
            // O componente será re-renderizado automaticamente quando o estado mudar no App.jsx
        } catch (err) {
            console.error('❌ [V10 Delivery] Erro no login:', err);

            // Mensagens de erro amigáveis
            let errorMessage = 'Erro ao fazer login. Tente novamente.';

            if (err.message?.includes('Invalid login credentials')) {
                errorMessage = 'E-mail ou senha incorretos. Verifique seus dados e tente novamente.';
            } else if (err.message?.includes('Email not confirmed')) {
                errorMessage = 'E-mail não confirmado. Verifique sua caixa de entrada.';
            } else if (err.message?.includes('não disponível')) {
                errorMessage = err.message;
            } else if (err.message) {
                errorMessage = err.message;
            }

            setError(errorMessage);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="login-container">
            {/* Overlay Escuro Semi-Transparente */}
            <div className="login-overlay"></div>

            {/* Card de Login Centralizado */}
            <div className="login-card">
                {/* Logo */}
                <img
                    src="/assets/logo-v10.png.png"
                    alt="Logo V10 Delivery"
                    className="login-logo"
                    onError={(e) => { e.target.style.display = 'none'; console.warn('[V10 Delivery] Logo não encontrada'); }}
                />

                {/* Título e Slogan */}
                <div className="login-header">
                    <h1 className="login-title">V10 Delivery</h1>
                    <p className="login-slogan">Sua rota para excelência</p>
                </div>

                {/* Mensagem de Erro */}
                {error && (
                    <div className="login-error">
                        <span>⚠️ {error}</span>
                    </div>
                )}

                {/* Formulário */}
                <form onSubmit={handleSubmit} className="login-form">
                    <div className="form-group">
                        <label htmlFor="email">E-mail</label>
                        <input
                            type="email"
                            id="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="seu@email.com"
                            required
                            className="form-input"
                        />
                    </div>

                    <div className="form-group">
                        <label htmlFor="password">Senha</label>
                        <input
                            type="password"
                            id="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="••••••••"
                            required
                            className="form-input"
                        />
                    </div>

                    <div className="form-options">
                        <label className="checkbox-label">
                            <input
                                type="checkbox"
                                checked={rememberMe}
                                onChange={(e) => setRememberMe(e.target.checked)}
                            />
                            <span>Lembrar de mim</span>
                        </label>

                        <a href="#" className="forgot-password">
                            Esqueci minha senha
                        </a>
                    </div>

                    <button type="submit" className="login-button" disabled={loading}>
                        {loading ? 'Entrando...' : 'Entrar'}
                    </button>
                </form>

                {/* Footer */}
                <div className="login-footer">
                    <p>
                        Não tem uma conta?{' '}
                        <a
                            href="#"
                            onClick={(e) => {
                                e.preventDefault();
                                if (typeof onIrParaCadastro === 'function') {
                                    onIrParaCadastro();
                                }
                            }}
                        >
                            Cadastre-se
                        </a>
                    </p>
                </div>
            </div>
        </div>
    );
};

export default Login;
