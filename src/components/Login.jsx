import React, { useState, useEffect } from 'react';
import './Login.css';
import { supabase } from '../supabaseClient';

const Login = ({ onLoginSuccess, onIrParaCadastro }) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [rememberMe, setRememberMe] = useState(false);
    const [loading, setLoading] = useState(false);
    const [connecting, setConnecting] = useState(false); // Estado para "Conectando..."
    const [error, setError] = useState('');
    const [showForgotPassword, setShowForgotPassword] = useState(false);
    const [resetEmailSent, setResetEmailSent] = useState(false);
    const [otpCode, setOtpCode] = useState('');
    const [showOtpInput, setShowOtpInput] = useState(false);
    const [newPassword, setNewPassword] = useState('');
    const [confirmNewPassword, setConfirmNewPassword] = useState('');
    const [showNewPasswordInput, setShowNewPasswordInput] = useState(false);

    // Estados para controlar visibilidade das senhas
    const [showPassword, setShowPassword] = useState(false);
    const [showNewPassword, setShowNewPassword] = useState(false);
    const [showConfirmNewPassword, setShowConfirmNewPassword] = useState(false);

    // Estados para Modais de Política e Termos
    const [showPrivacyPolicy, setShowPrivacyPolicy] = useState(false);
    const [showTermsOfService, setShowTermsOfService] = useState(false);

    // ✅ LIMPEZA INICIAL DOS CAMPOS E ERROS DE OAUTH AO CARREGAR
    useEffect(() => {
        // Tentar pré-preencher e-mail vindo do fluxo de cadastro
        try {
            const pref = localStorage.getItem('signup_email_prefill');
            if (pref && String(pref).trim().length > 0) {
                setEmail(String(pref).trim());
            } else {
                setEmail('');
            }
        } catch (e) {
            setEmail('');
        }

        // Limpar senha por segurança
        setPassword('');
        setRememberMe(false);
        console.log('🧹 [Login] Campos de login inicializados (prefill aplicado se disponível)');

        // Limpeza de chaves legadas de autenticação no localStorage para evitar conflitos de tokens
        try {
            const keys = Object.keys(localStorage || {});
            keys.forEach(k => {
                if (k === 'signup_email_prefill') return; // manter prefill útil
                if (/supabase|sb[:\-]/i.test(k)) {
                    console.log('🧹 [Login] Removendo chave legada do localStorage:', k);
                    try { localStorage.removeItem(k); } catch (e) { /* silent */ }
                }
            });
        } catch (e) {
            console.warn('⚠️ [Login] Falha ao limpar chaves legadas:', e);
        }
    }, []); // Executa apenas uma vez ao montar

    // ✅ LIMPEZA DE ERROS DE OAUTH AO CARREGAR
    useEffect(() => {
        const cleanupOAuthErrors = async () => {
            try {
                // Limpar parâmetros de erro da URL (como error_code, error_description)
                const currentUrl = new URL(window.location.href);
                const hasErrorParams = currentUrl.searchParams.has('error') ||
                    currentUrl.searchParams.has('error_code') ||
                    currentUrl.searchParams.has('error_description');

                if (hasErrorParams) {
                    console.log('🧹 [Login] Limpando parâmetros de erro OAuth da URL...');

                    // Remove parâmetros de erro
                    currentUrl.searchParams.delete('error');
                    currentUrl.searchParams.delete('error_code');
                    currentUrl.searchParams.delete('error_description');

                    // Atualiza URL sem reload
                    window.history.replaceState({}, '', currentUrl.toString());
                }

                // Limpar estado de erro local
                setError('');

                console.log('✅ [Login] Limpeza de erros OAuth concluída');
            } catch (err) {
                console.error('❌ [Login] Erro ao limpar erros OAuth:', err);
            }
        };

        cleanupOAuthErrors();
    }, []); // Executa apenas uma vez ao montar

    // Removido: verificação automática de sessão e listener que provocavam autenticação implícita.
    // Decidimos que o usuário deve sempre disparar o login explicitamente. OAuth redirections que
    // retornarem aqui podem ser tratadas manualmente via botão/fluxo explícito.


    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            // Verificar se o cliente Supabase está disponível
            if (!supabase || !supabase.auth) {
                throw new Error('Sistema de autenticação temporáriamente indisponível. Verifique as configurações do .env.local e reinicie o terminal.');
            }

            // Normalize credentials to avoid invisible whitespace or case issues
            const emailToSend = String(email || '').trim().toLowerCase();
            const passwordToSend = String(password || '').trim();

            // Autenticar com Supabase (storage fix: client uses localStorage)
            const { data, error: authError } = await supabase.auth.signInWithPassword({
                email: emailToSend,
                password: passwordToSend,
            });

            if (authError) {
                throw authError;
            }

            // Login bem-sucedido — tratamento explícito
            console.log('✅ [V10 Delivery] Login realizado com sucesso:', data.user?.email);
            if (typeof onLoginSuccess === 'function') {
                // Passar o usuário adiante para que o App.jsx atualize sessão/estado
                onLoginSuccess(data.user);
            }

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
                // Limpar campos e pedir que o usuário tente novamente sem espaços
                setEmail('');
                setPassword('');
                errorMessage = 'E-mail ou senha incorretos. Verifique seus dados (remova espaços) e tente novamente.';
            } else if (err.message?.includes('Email not confirmed')) {
                // Confirmação foi desativada no Supabase; tratar como falha genérica de credenciais
                setPassword('');
                errorMessage = 'E-mail ou senha incorretos. Verifique seus dados e tente novamente.';
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

    const handleForgotPassword = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            if (!email.trim()) {
                throw new Error('Por favor, informe seu e-mail para recuperar a senha.');
            }

            // Enviar e-mail de redefinição (usando template 'Reset password')
            const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim());

            if (resetError) {
                throw resetError;
            }

            // Mostrar feedback e avançar para a etapa de inserção do código
            setResetEmailSent(true);
            setShowOtpInput(true);
        } catch (err) {
            console.error('❌ Erro ao enviar código de recuperação:', err);
            setError(err.message || 'Erro ao enviar código de recuperação.');
        } finally {
            setLoading(false);
        }
    };

    const handleVerifyOtp = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            if (!otpCode || otpCode.trim().length !== 6) {
                throw new Error('Por favor, digite o código de 6 dígitos.');
            }

            // Verificar código OTP
            const { error: verifyError } = await supabase.auth.verifyOtp({
                email: email.trim(),
                token: otpCode.trim(),
                type: 'recovery'
            });

            if (verifyError) {
                throw verifyError;
            }

            // Código verificado - avançar para a etapa de redefinição de senha
            setShowOtpInput(false);
            setShowNewPasswordInput(true);
        } catch (err) {
            console.error('❌ Erro ao verificar código:', err);
            let errorMessage = 'Código inválido. Tente novamente.';
            if (err.message?.includes('Token has expired')) {
                errorMessage = 'Código expirado. Solicite um novo código.';
            } else if (err.message) {
                errorMessage = err.message;
            }
            setError(errorMessage);
        } finally {
            setLoading(false);
        }
    };

    const handleUpdatePassword = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            if (newPassword.length < 6) {
                throw new Error('A senha deve ter no mínimo 6 caracteres.');
            }

            if (newPassword !== confirmNewPassword) {
                throw new Error('As senhas não coincidem.');
            }

            // Atualizar senha
            const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });

            if (updateError) {
                throw updateError;
            }

            alert('✅ Senha alterada! Por favor, faça login com sua nova senha.');

            // Resetar formulário local e garantir que o usuário seja deslogado
            setShowForgotPassword(false);
            setResetEmailSent(false);
            setShowOtpInput(false);
            setShowNewPasswordInput(false);
            setOtpCode('');
            setNewPassword('');
            setConfirmNewPassword('');

            try {
                // Forçar sign out para garantir que o usuário precise logar novamente
                if (supabase && supabase.auth && typeof supabase.auth.signOut === 'function') {
                    await supabase.auth.signOut();
                }
            } catch (e) {
                console.warn('⚠️ Falha ao deslogar automaticamente após reset:', e);
            }
        } catch (err) {
            console.error('❌ Erro ao atualizar senha:', err);
            setError(err.message || 'Erro ao atualizar senha.');
        } finally {
            setLoading(false);
        }
    };

    const handleGoogleLogin = async () => {
        try {
            setError('');
            setLoading(true);

            // ✅ RESET DE NAVEGAÇÃO: Limpar parâmetros de erro antigos da URL
            const currentUrl = new URL(window.location.href);
            const hadErrorParams = currentUrl.searchParams.has('error') ||
                currentUrl.searchParams.has('error_code') ||
                currentUrl.searchParams.has('error_description');

            if (hadErrorParams) {
                currentUrl.searchParams.delete('error');
                currentUrl.searchParams.delete('error_code');
                currentUrl.searchParams.delete('error_description');
                window.history.replaceState({}, '', currentUrl.toString());
                console.log('🧹 [Login] Parâmetros de erro removidos antes do OAuth');
            }

            const { error: googleError } = await supabase.auth.signInWithOAuth({
                provider: 'google',
                options: {
                    redirectTo: 'https://v10delivery.vercel.app',
                    skipBrowserRedirect: false,
                    queryParams: {
                        access_type: 'offline',
                        prompt: 'select_account'
                    }
                }
            });

            if (googleError) {
                throw googleError;
            }
        } catch (err) {
            console.error('❌ Erro no login com Google:', err);
            setError('Erro ao fazer login com Google. Tente novamente.');
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

                {/* Informações Públicas sobre o App */}
                <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
                    <h1 style={{
                        color: '#ffffff',
                        fontSize: '28px',
                        fontWeight: '800',
                        margin: '0 0 10px 0',
                        textShadow: '0 2px 4px rgba(0,0,0,0.6)',
                        letterSpacing: '-0.5px'
                    }}>
                        V10 Delivery
                    </h1>
                    <p style={{
                        color: '#e2e8f0',
                        fontSize: '14px',
                        lineHeight: '1.6',
                        margin: '0',
                        textShadow: '0 1px 2px rgba(0,0,0,0.4)'
                    }}>
                        Sua plataforma de gestão de entregas
                    </p>
                    <p style={{
                        color: '#cbd5e1',
                        fontSize: '13px',
                        lineHeight: '1.5',
                        margin: '8px 0 0 0',
                        textShadow: '0 1px 2px rgba(0,0,0,0.3)'
                    }}>
                        Ajudamos empresas a gerenciarem suas rotas e pedidos de forma eficiente e rápida.
                    </p>
                </div>

                {/* Mensagem de Conectando */}
                {connecting && (
                    <div style={{
                        padding: '16px',
                        background: 'rgba(59, 130, 246, 0.1)',
                        border: '1px solid rgba(59, 130, 246, 0.3)',
                        borderRadius: '8px',
                        color: '#60a5fa',
                        fontSize: '14px',
                        marginBottom: '16px',
                        textAlign: 'center',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px'
                    }}>
                        <div style={{
                            width: '16px',
                            height: '16px',
                            border: '2px solid rgba(59, 130, 246, 0.3)',
                            borderTopColor: '#60a5fa',
                            borderRadius: '50%',
                            animation: 'spin 1s linear infinite'
                        }}></div>
                        <span>🚀 Conectando ao Dashboard...</span>
                    </div>
                )}

                {/* Mensagem de Erro */}
                {error && (
                    <div className="login-error">
                        <span>⚠️ {error}</span>
                    </div>
                )}

                {/* Formulário de Recuperação de Senha */}
                {showForgotPassword ? (
                    <form onSubmit={showNewPasswordInput ? handleUpdatePassword : (showOtpInput ? handleVerifyOtp : handleForgotPassword)} className="login-form">
                        {/* Mostrar campo de e-mail apenas antes do envio do código */}
                        {!(resetEmailSent || showOtpInput || showNewPasswordInput) && (
                            <div className="form-group">
                                <label htmlFor="email-reset">E-mail</label>
                                <input
                                    type="email"
                                    id="email-reset"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="seu@email.com"
                                    required
                                    className="form-input"
                                    autoComplete="off"
                                />
                            </div>
                        )}

                        {resetEmailSent && !showNewPasswordInput && (
                            <div style={{ padding: '12px', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: '8px', color: '#10b981', fontSize: '14px', marginBottom: '16px' }}>
                                📧 Código enviado para seu e-mail! Verifique sua caixa de entrada.
                            </div>
                        )}

                        {/* Campo de código OTP */}
                        {showOtpInput && (
                            <div className="form-group">
                                <label htmlFor="otp-code">Código de Verificação</label>
                                <input
                                    type="text"
                                    id="otp-code"
                                    value={otpCode}
                                    onChange={(e) => setOtpCode(e.target.value)}
                                    placeholder="Digite o código de 6 dígitos"
                                    required
                                    className="form-input"
                                    autoComplete="off"
                                    disabled={loading}
                                    maxLength={6}
                                    style={{ textAlign: 'center', fontSize: '20px', letterSpacing: '8px' }}
                                />
                            </div>
                        )}

                        {/* Campos de nova senha */}
                        {showNewPasswordInput && (
                            <>
                                <div className="form-group">
                                    <label htmlFor="new-password">Nova Senha</label>
                                    <div style={{ position: 'relative' }}>
                                        <input
                                            type={showNewPassword ? 'text' : 'password'}
                                            id="new-password"
                                            value={newPassword}
                                            onChange={(e) => setNewPassword(e.target.value)}
                                            placeholder="Mínimo 6 caracteres"
                                            required
                                            className="form-input"
                                            autoComplete="new-password"
                                            disabled={loading}
                                            minLength={6}
                                            style={{ paddingRight: '45px' }}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowNewPassword(!showNewPassword)}
                                            style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '20px', padding: '4px' }}
                                            title={showNewPassword ? 'Ocultar senha' : 'Mostrar senha'}
                                        >
                                            {showNewPassword ? '🙈' : '👁️'}
                                        </button>
                                    </div>
                                </div>
                                <div className="form-group">
                                    <label htmlFor="confirm-new-password">Confirmar Nova Senha</label>
                                    <div style={{ position: 'relative' }}>
                                        <input
                                            type={showConfirmNewPassword ? 'text' : 'password'}
                                            id="confirm-new-password"
                                            value={confirmNewPassword}
                                            onChange={(e) => setConfirmNewPassword(e.target.value)}
                                            placeholder="Digite a senha novamente"
                                            required
                                            className="form-input"
                                            autoComplete="new-password"
                                            disabled={loading}
                                            minLength={6}
                                            style={{ paddingRight: '45px' }}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowConfirmNewPassword(!showConfirmNewPassword)}
                                            style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '20px', padding: '4px' }}
                                            title={showConfirmNewPassword ? 'Ocultar senha' : 'Mostrar senha'}
                                        >
                                            {showConfirmNewPassword ? '🙈' : '👁️'}
                                        </button>
                                    </div>
                                </div>
                            </>
                        )}

                        <button type="submit" className="login-button" disabled={loading}>
                            {loading ? 'Processando...' : (showNewPasswordInput ? 'Alterar Senha' : (showOtpInput ? 'Verificar Código' : 'Enviar Código'))}
                        </button>

                        <button
                            type="button"
                            onClick={() => {
                                setShowForgotPassword(false);
                                setResetEmailSent(false);
                                setShowOtpInput(false);
                                setShowNewPasswordInput(false);
                                setOtpCode('');
                                setNewPassword('');
                                setConfirmNewPassword('');
                                setError('');
                            }}
                            style={{ marginTop: '12px', background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', color: '#94a3b8', padding: '12px', borderRadius: '8px', cursor: 'pointer', width: '100%' }}
                        >
                            Voltar ao Login
                        </button>
                    </form>
                ) : (
                    <form onSubmit={handleSubmit} className="login-form" autoComplete="off">
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
                                autoComplete="off"
                            />
                        </div>

                        <div className="form-group">
                            <label htmlFor="password">Senha</label>
                            <div style={{ position: 'relative' }}>
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    id="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="••••••••"
                                    required
                                    className="form-input"
                                    autoComplete="new-password"
                                    style={{ paddingRight: '45px' }}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '20px', padding: '4px' }}
                                    title={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                                >
                                    {showPassword ? '🙈' : '👁️'}
                                </button>
                            </div>
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

                            <a
                                href="#"
                                className="forgot-password"
                                onClick={(e) => {
                                    e.preventDefault();
                                    setShowForgotPassword(true);
                                    setError('');
                                    setResetStep('email');
                                }}
                            >
                                Esqueci minha senha
                            </a>
                        </div>

                        <button type="submit" className="login-button" disabled={loading}>
                            {loading ? 'Entrando...' : 'Entrar'}
                        </button>

                        {/* Divisor */}
                        <div style={{ display: 'flex', alignItems: 'center', margin: '20px 0', gap: '12px' }}>
                            <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.1)' }}></div>
                            <span style={{ color: '#94a3b8', fontSize: '14px' }}>ou</span>
                            <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.1)' }}></div>
                        </div>

                        {/* Botão de Login com Google */}
                        <button
                            type="button"
                            onClick={handleGoogleLogin}
                            disabled={loading}
                            style={{
                                width: '100%',
                                padding: '12px',
                                borderRadius: '8px',
                                border: '1px solid rgba(255,255,255,0.2)',
                                background: '#ffffff',
                                color: '#1f2937',
                                fontWeight: '600',
                                fontSize: '15px',
                                cursor: loading ? 'not-allowed' : 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '10px',
                                transition: 'all 0.2s',
                                opacity: loading ? 0.6 : 1
                            }}
                            onMouseEnter={(e) => { if (!loading) e.target.style.background = '#f9fafb'; }}
                            onMouseLeave={(e) => { e.target.style.background = '#ffffff'; }}
                        >
                            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4" />
                                <path d="M9.003 18c2.43 0 4.467-.806 5.956-2.184l-2.909-2.258c-.806.54-1.837.86-3.047.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9.003 18z" fill="#34A853" />
                                <path d="M3.964 10.712c-.18-.54-.282-1.117-.282-1.71 0-.593.102-1.17.282-1.71V4.96H.957C.347 6.175 0 7.55 0 9.002c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05" />
                                <path d="M9.003 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.464.891 11.426 0 9.003 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29c.708-2.127 2.692-3.71 5.036-3.71z" fill="#EA4335" />
                            </svg>
                            Continuar com Google
                        </button>
                    </form>
                )}

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

                {/* Links de Conformidade Google - Rodapé */}
                <div style={{
                    display: 'flex',
                    justifyContent: 'center',
                    gap: '15px',
                    marginTop: '20px',
                    paddingTop: '15px',
                    borderTop: '1px solid rgba(255,255,255,0.1)',
                    textAlign: 'center'
                }}>
                    <a
                        href="/privacy"
                        style={{
                            color: '#ffffff',
                            fontSize: '10px',
                            textDecoration: 'none',
                            opacity: 0.6,
                            transition: 'opacity 0.2s',
                            cursor: 'pointer',
                            textShadow: '0 1px 2px rgba(0,0,0,0.3)'
                        }}
                        onMouseEnter={(e) => e.target.style.opacity = '1'}
                        onMouseLeave={(e) => e.target.style.opacity = '0.6'}
                    >
                        Política de Privacidade
                    </a>
                    <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '10px' }}>•</span>
                    <a
                        href="/terms"
                        style={{
                            color: '#ffffff',
                            fontSize: '10px',
                            textDecoration: 'none',
                            opacity: 0.6,
                            transition: 'opacity 0.2s',
                            cursor: 'pointer',
                            textShadow: '0 1px 2px rgba(0,0,0,0.3)'
                        }}
                        onMouseEnter={(e) => e.target.style.opacity = '1'}
                        onMouseLeave={(e) => e.target.style.opacity = '0.6'}
                    >
                        Termos de Serviço
                    </a>
                </div>
            </div>
            {/* Modais de Política de Privacidade e Termos de Serviço */}
            {showPrivacyPolicy && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: 'rgba(0,0,0,0.7)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 10000,
                    padding: '20px'
                }}>
                    <div style={{
                        background: '#fff',
                        borderRadius: '16px',
                        padding: '30px',
                        maxWidth: '600px',
                        maxHeight: '80vh',
                        overflow: 'auto',
                        boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
                    }}>
                        <h2 style={{ margin: '0 0 20px 0', color: '#1e293b', fontSize: '24px', fontWeight: '800' }}>Política de Privacidade</h2>
                        <div style={{ lineHeight: '1.8', color: '#475569', fontSize: '14px' }}>
                            <p><strong>Última atualização:</strong> 6 de fevereiro de 2026</p>

                            <h3 style={{ fontSize: '18px', marginTop: '20px', color: '#334155' }}>1. Coleta de Dados</h3>
                            <p>O V10 Delivery coleta informações necessárias para o funcionamento do serviço de entregas, incluindo:</p>
                            <ul>
                                <li>Nome completo e informações de contato</li>
                                <li>Endereços de entrega e recolha</li>
                                <li>Localização em tempo real dos motoristas (GPS)</li>
                                <li>Histórico de entregas realizadas</li>
                            </ul>

                            <h3 style={{ fontSize: '18px', marginTop: '20px', color: '#334155' }}>2. Uso dos Dados</h3>
                            <p>Os dados coletados são utilizados exclusivamente para:</p>
                            <ul>
                                <li>Gerenciar e otimizar rotas de entrega</li>
                                <li>Comunicação entre gestores e motoristas</li>
                                <li>Melhorar a qualidade do serviço prestado</li>
                                <li>Gerar relatórios e estatísticas operacionais</li>
                            </ul>

                            <h3 style={{ fontSize: '18px', marginTop: '20px', color: '#334155' }}>3. Segurança</h3>
                            <p>Todos os dados são armazenados de forma segura no Supabase (PostgreSQL), com criptografia end-to-end e proteção contra acessos não autorizados. Utilizamos as melhores práticas de segurança da indústria.</p>

                            <h3 style={{ fontSize: '18px', marginTop: '20px', color: '#334155' }}>4. Compartilhamento</h3>
                            <p>Seus dados <strong>não são compartilhados</strong> com terceiros. Mantemos total privacidade das informações coletadas.</p>

                            <h3 style={{ fontSize: '18px', marginTop: '20px', color: '#334155' }}>5. Seus Direitos</h3>
                            <p>Você tem direito a acessar, corrigir ou solicitar a exclusão de seus dados a qualquer momento. Entre em contato conosco para exercer esses direitos.</p>
                        </div>
                        <button
                            onClick={() => setShowPrivacyPolicy(false)}
                            style={{
                                marginTop: '30px',
                                padding: '12px 30px',
                                background: 'linear-gradient(135deg, #3b82f6, #1e40af)',
                                color: '#fff',
                                border: 'none',
                                borderRadius: '8px',
                                fontSize: '14px',
                                fontWeight: '700',
                                cursor: 'pointer',
                                width: '100%'
                            }}
                        >
                            Fechar
                        </button>
                    </div>
                </div>
            )}

            {showTermsOfService && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: 'rgba(0,0,0,0.7)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 10000,
                    padding: '20px'
                }}>
                    <div style={{
                        background: '#fff',
                        borderRadius: '16px',
                        padding: '30px',
                        maxWidth: '600px',
                        maxHeight: '80vh',
                        overflow: 'auto',
                        boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
                    }}>
                        <h2 style={{ margin: '0 0 20px 0', color: '#1e293b', fontSize: '24px', fontWeight: '800' }}>Termos de Serviço</h2>
                        <div style={{ lineHeight: '1.8', color: '#475569', fontSize: '14px' }}>
                            <p><strong>Última atualização:</strong> 6 de fevereiro de 2026</p>

                            <h3 style={{ fontSize: '18px', marginTop: '20px', color: '#334155' }}>1. Aceitação dos Termos</h3>
                            <p>Ao utilizar o V10 Delivery, você concorda com estes Termos de Serviço. Se não concordar, não utilize a plataforma.</p>

                            <h3 style={{ fontSize: '18px', marginTop: '20px', color: '#334155' }}>2. Uso do Serviço</h3>
                            <p>O V10 Delivery é uma plataforma de gerenciamento de entregas. Você se compromete a:</p>
                            <ul>
                                <li>Fornecer informações verdadeiras e precisas</li>
                                <li>Manter a confidencialidade de sua conta</li>
                                <li>Não utilizar o serviço para fins ilegais</li>
                                <li>Respeitar as diretrizes operacionais estabelecidas</li>
                            </ul>

                            <h3 style={{ fontSize: '18px', marginTop: '20px', color: '#334155' }}>3. Responsabilidades</h3>
                            <p><strong>Do Usuário:</strong></p>
                            <ul>
                                <li>Garantir informações corretas de entrega</li>
                                <li>Manter horários e compromissos agendados</li>
                                <li>Tratar motoristas e equipe com respeito</li>
                            </ul>
                            <p><strong>Do V10 Delivery:</strong></p>
                            <ul>
                                <li>Fornecer plataforma estável e segura</li>
                                <li>Manter privacidade dos dados</li>
                                <li>Garantir comunicação eficiente entre partes</li>
                            </ul>

                            <h3 style={{ fontSize: '18px', marginTop: '20px', color: '#334155' }}>4. Limitação de Responsabilidade</h3>
                            <p>O V10 Delivery não se responsabiliza por:</p>
                            <ul>
                                <li>Atrasos causados por fatores externos (trânsito, clima)</li>
                                <li>Danos a mercadorias mal embaladas</li>
                                <li>Informações incorretas fornecidas pelo usuário</li>
                            </ul>

                            <h3 style={{ fontSize: '18px', marginTop: '20px', color: '#334155' }}>5. Cancelamento</h3>
                            <p>Reservamo-nos o direito de suspender ou cancelar contas que violem estes termos sem aviso prévio.</p>

                            <h3 style={{ fontSize: '18px', marginTop: '20px', color: '#334155' }}>6. Alterações</h3>
                            <p>Podemos modificar estes termos a qualquer momento. Alterações significativas serão comunicadas aos usuários.</p>
                        </div>
                        <button
                            onClick={() => setShowTermsOfService(false)}
                            style={{
                                marginTop: '30px',
                                padding: '12px 30px',
                                background: 'linear-gradient(135deg, #3b82f6, #1e40af)',
                                color: '#fff',
                                border: 'none',
                                borderRadius: '8px',
                                fontSize: '14px',
                                fontWeight: '700',
                                cursor: 'pointer',
                                width: '100%'
                            }}
                        >
                            Fechar
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Login;
