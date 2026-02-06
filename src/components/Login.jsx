import React, { useState } from 'react';
import './Login.css';
import { supabase } from '../supabaseClient';

const Login = ({ onLoginSuccess, onIrParaCadastro }) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [rememberMe, setRememberMe] = useState(false);
    const [loading, setLoading] = useState(false);
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

    const handleForgotPassword = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            if (!email.trim()) {
                throw new Error('Por favor, informe seu e-mail para recuperar a senha.');
            }

            // Enviar código OTP por e-mail
            const { error: otpError } = await supabase.auth.signInWithOtp({
                email: email.trim(),
                options: {
                    shouldCreateUser: false
                }
            });

            if (otpError) {
                throw otpError;
            }

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
                type: 'email'
            });

            if (verifyError) {
                throw verifyError;
            }

            // Código verificado - mostrar campos de nova senha
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
            const { error: updateError } = await supabase.auth.updateUser({
                password: newPassword
            });

            if (updateError) {
                throw updateError;
            }

            alert('✅ Senha alterada com sucesso! Faça login com sua nova senha.');
            // Resetar formulário
            setShowForgotPassword(false);
            setResetEmailSent(false);
            setShowOtpInput(false);
            setShowNewPasswordInput(false);
            setOtpCode('');
            setNewPassword('');
            setConfirmNewPassword('');
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

            const { error: googleError } = await supabase.auth.signInWithOAuth({
                provider: 'google',
                options: {
                    redirectTo: 'https://v10delivery.vercel.app?v=1',
                    queryParams: {
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

                {/* Formulário de Recuperação de Senha */}
                {showForgotPassword ? (
                    <form onSubmit={showNewPasswordInput ? handleUpdatePassword : (showOtpInput ? handleVerifyOtp : handleForgotPassword)} className="login-form">
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
                                disabled={resetEmailSent || showOtpInput || showNewPasswordInput}
                            />
                        </div>

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
                            <div style={{ position: 'relative' }}>
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    id="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="••••••••"
                                    required
                                    className="form-input"
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
            </div>
        </div>
    );
};

export default Login;
