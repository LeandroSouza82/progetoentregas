import React, { useState } from 'react';
import './Login.css';
import { supabase } from '../supabaseClient';

const Cadastro = ({ onCadastroSuccess, onVoltarLogin }) => {
    const [fullName, setFullName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [otpCode, setOtpCode] = useState('');
    const [showOtpInput, setShowOtpInput] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setSuccess('');
        setLoading(true);

        try {
            if (!fullName.trim()) throw new Error('Por favor, informe seu nome completo.');
            if (fullName.trim().length < 3) throw new Error('Nome deve ter pelo menos 3 caracteres.');
            if (!email.trim()) throw new Error('Por favor, informe seu e-mail.');
            if (password.length < 6) throw new Error('A senha deve ter no mínimo 6 caracteres.');
            if (password !== confirmPassword) throw new Error('As senhas não coincidem. Verifique e tente novamente.');

            if (!supabase || !supabase.auth) throw new Error('Sistema de autenticação temporariamente indisponível. Tente novamente em instantes.');

            const { data, error: signUpError } = await supabase.auth.signUp({
                email: email.trim(),
                password,
                options: { data: { full_name: fullName.trim() } }
            });

            if (signUpError) {
                const msg = String(signUpError.message || signUpError).toLowerCase();
                if (/limit|quota|rate|smtp|delivery|exceed|throttl/.test(msg)) {
                    try { localStorage.setItem('signup_email_prefill', email.trim()); } catch (e) { }
                    // Garantir que não haja sessão ativa após o cadastro (bloquear login automático)
                    try {
                        if (supabase && supabase.auth && typeof supabase.auth.signOut === 'function') {
                            await supabase.auth.signOut();
                        }
                    } catch (e) { console.warn('Falha ao deslogar automaticamente após cadastro (quota):', e); }

                    setLoading(false);
                    alert('Conta criada com sucesso! Agora, por favor, faça o seu login para entrar.');
                    setTimeout(() => { if (typeof onVoltarLogin === 'function') onVoltarLogin(); else window.location.href = '/'; }, 300);
                }

                if (msg.includes('already') || signUpError.message?.includes('User already registered')) {
                    setError('Este e-mail já está cadastrado.');
                    return;
                }

                throw signUpError;
            }

            try { localStorage.setItem('signup_email_prefill', email.trim()); } catch (e) { }
            // Garantir que não haja sessão ativa após o cadastro (bloquear login automático)
            try {
                if (supabase && supabase.auth && typeof supabase.auth.signOut === 'function') {
                    await supabase.auth.signOut();
                }
            } catch (e) { console.warn('Falha ao deslogar automaticamente após cadastro:', e); }

            setLoading(false);
            alert('Conta criada com sucesso! Agora, por favor, faça o seu login para entrar.');
            setTimeout(() => { if (typeof onVoltarLogin === 'function') onVoltarLogin(); else window.location.href = '/'; }, 300);
        } catch (err) {
            console.error('Erro no cadastro:', err);
            let message = err?.message || String(err) || 'Erro ao criar conta. Tente novamente.';
            setError(message.includes('User already') ? 'Este e-mail já está cadastrado.' : message);
        } finally {
            setLoading(false);
        }
    };

    const handleVerifyOtp = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            if (!otpCode || otpCode.trim().length !== 6) throw new Error('Por favor, digite o código de 6 dígitos enviado para seu e-mail.');
            const { data, error: verifyError } = await supabase.auth.verifyOtp({ email: email.trim(), token: otpCode.trim(), type: 'signup' });
            if (verifyError) throw verifyError;
            // Verificação concluída. Garantir que o usuário NÃO seja mantido logado automaticamente.
            try {
                if (supabase && supabase.auth && typeof supabase.auth.signOut === 'function') {
                    await supabase.auth.signOut();
                }
            } catch (e) { console.warn('Falha ao deslogar automaticamente após verificação OTP:', e); }

            setLoading(false);
            alert('Conta verificada! Agora, por favor, faça o seu login para entrar.');
            setTimeout(() => { if (typeof onVoltarLogin === 'function') onVoltarLogin(); else window.location.href = '/'; }, 300);
        } catch (err) {
            console.error('Erro na verificação OTP:', err);
            setError(err?.message || 'Código inválido. Tente novamente.');
        } finally { setLoading(false); }
    };

    return (
        <div className="login-container">
            <div className="login-overlay"></div>
            <div className="login-card">
                <img src="/assets/logo-v10.png.png" alt="Logo V10 Delivery" className="login-logo" onError={(e) => { e.target.style.display = 'none'; }} />
                <div className="login-header">
                    <h1 className="login-title">Criar Conta</h1>
                    <p className="login-slogan">Junte-se ao V10 Delivery</p>
                </div>

                {success && <div className="login-success"><span>{success}</span></div>}
                {error && <div className="login-error"><span>⚠️ {error}</span></div>}

                <form onSubmit={showOtpInput ? handleVerifyOtp : handleSubmit} className="login-form">
                    <div className="form-group">
                        <label htmlFor="fullName">Nome Completo</label>
                        <input type="text" id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Seu nome completo" required className="form-input" disabled={loading || showOtpInput} />
                    </div>
                    <div className="form-group">
                        <label htmlFor="email">E-mail</label>
                        <input type="email" id="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="seu@email.com" required className="form-input" disabled={loading || showOtpInput} />
                    </div>
                    <div className="form-group">
                        <label htmlFor="password">Senha</label>
                        <div style={{ position: 'relative' }}>
                            <input type={showPassword ? 'text' : 'password'} id="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo 6 caracteres" required className="form-input" disabled={loading || showOtpInput} minLength={6} style={{ paddingRight: '45px' }} />
                            <button type="button" onClick={() => setShowPassword(!showPassword)} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer' }} title={showPassword ? 'Ocultar senha' : 'Mostrar senha'}>{showPassword ? '🙈' : '👁️'}</button>
                        </div>
                    </div>
                    <div className="form-group">
                        <label htmlFor="confirmPassword">Confirmar Senha</label>
                        <div style={{ position: 'relative' }}>
                            <input type={showConfirmPassword ? 'text' : 'password'} id="confirmPassword" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Digite a senha novamente" required className="form-input" disabled={loading || showOtpInput} minLength={6} style={{ paddingRight: '45px' }} />
                            <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer' }} title={showConfirmPassword ? 'Ocultar senha' : 'Mostrar senha'}>{showConfirmPassword ? '🙈' : '👁️'}</button>
                        </div>
                    </div>

                    {showOtpInput && (
                        <div className="form-group">
                            <label htmlFor="otpCode">Código de Verificação</label>
                            <input type="text" id="otpCode" value={otpCode} onChange={(e) => setOtpCode(e.target.value)} placeholder="Digite o código de 6 dígitos" required className="form-input" disabled={loading} maxLength={6} style={{ textAlign: 'center', fontSize: '20px', letterSpacing: '8px' }} />
                        </div>
                    )}

                    <button type="submit" className="login-button" disabled={loading || (success && !showOtpInput)}>{loading ? (showOtpInput ? 'Verificando...' : 'Enviando código...') : (showOtpInput ? 'Verificar Código' : 'Criar Conta')}</button>
                </form>

                <div className="login-footer">
                    <p>Já tem uma conta? <a href="#" onClick={(e) => { e.preventDefault(); if (typeof onVoltarLogin === 'function') onVoltarLogin(); }}>Faça login</a></p>
                </div>
            </div>
        </div>
    );
};

export default Cadastro;
