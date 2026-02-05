import React, { useState } from 'react';
import './Login.css'; // Reutiliza o mesmo CSS do Login
import { supabase } from '../supabaseClient';

const Cadastro = ({ onCadastroSuccess, onVoltarLogin }) => {
    const [fullName, setFullName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setSuccess('');
        setLoading(true);

        try {
            // Validações
            if (!fullName.trim()) {
                throw new Error('Por favor, informe seu nome completo.');
            }

            if (fullName.trim().length < 3) {
                throw new Error('Nome deve ter pelo menos 3 caracteres.');
            }

            if (!email.trim()) {
                throw new Error('Por favor, informe seu e-mail.');
            }

            if (password.length < 6) {
                throw new Error('A senha deve ter no mínimo 6 caracteres.');
            }

            // ✅ VERIFICAÇÃO DE SENHAS
            if (password !== confirmPassword) {
                throw new Error('As senhas não coincidem. Verifique e tente novamente.');
            }

            // Verificar se o cliente Supabase está disponível
            if (!supabase || !supabase.auth) {
                throw new Error('Sistema de autenticação temporariamente indisponível. Tente novamente em instantes.');
            }

            // 🎯 REGISTRO COM SUPABASE - Importante: enviar full_name em options.data
            const { data, error: signUpError } = await supabase.auth.signUp({
                email: email.trim(),
                password: password,
                options: {
                    data: {
                        full_name: fullName.trim() // ✅ Campo para o gatilho do banco
                    }
                }
            });

            if (signUpError) {
                throw signUpError;
            }

            // Cadastro bem-sucedido
            console.log('✅ [V10 Delivery] Cadastro realizado com sucesso:', data.user?.email);
            setSuccess('✅ Cadastro realizado com sucesso! Redirecionando...');

            // Aguardar 1.5s para mostrar mensagem de sucesso antes de redirecionar
            setTimeout(() => {
                if (typeof onCadastroSuccess === 'function') {
                    onCadastroSuccess(data.user);
                }
            }, 1500);

        } catch (err) {
            console.error('❌ [V10 Delivery] Erro no cadastro:', err);

            // Mensagens de erro amigáveis
            let errorMessage = 'Erro ao criar conta. Tente novamente.';

            if (err.message?.includes('User already registered')) {
                errorMessage = 'Este e-mail já está cadastrado. Faça login ou use outro e-mail.';
            } else if (err.message?.includes('Password should be')) {
                errorMessage = 'A senha deve ter no mínimo 6 caracteres.';
            } else if (err.message?.includes('Invalid email')) {
                errorMessage = 'E-mail inválido. Verifique e tente novamente.';
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

            {/* Card de Cadastro Centralizado */}
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
                    <h1 className="login-title">Criar Conta</h1>
                    <p className="login-slogan">Junte-se ao V10 Delivery</p>
                </div>

                {/* Mensagem de Sucesso */}
                {success && (
                    <div className="login-success">
                        <span>{success}</span>
                    </div>
                )}

                {/* Mensagem de Erro */}
                {error && (
                    <div className="login-error">
                        <span>⚠️ {error}</span>
                    </div>
                )}

                {/* Formulário */}
                <form onSubmit={handleSubmit} className="login-form">
                    <div className="form-group">
                        <label htmlFor="fullName">Nome Completo</label>
                        <input
                            type="text"
                            id="fullName"
                            value={fullName}
                            onChange={(e) => setFullName(e.target.value)}
                            placeholder="Seu nome completo"
                            required
                            className="form-input"
                            disabled={loading}
                        />
                    </div>

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
                            disabled={loading}
                        />
                    </div>

                    <div className="form-group">
                        <label htmlFor="password">Senha</label>
                        <input
                            type="password"
                            id="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Mínimo 6 caracteres"
                            required
                            className="form-input"
                            disabled={loading}
                            minLength={6}
                        />
                    </div>

                    <div className="form-group">
                        <label htmlFor="confirmPassword">Confirmar Senha</label>
                        <input
                            type="password"
                            id="confirmPassword"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            placeholder="Digite a senha novamente"
                            required
                            className="form-input"
                            disabled={loading}
                            minLength={6}
                        />
                    </div>

                    <button type="submit" className="login-button" disabled={loading || success}>
                        {loading ? 'Criando conta...' : success ? '✅ Sucesso!' : 'Criar Conta'}
                    </button>
                </form>

                {/* Footer com link para Login */}
                <div className="login-footer">
                    <p>
                        Já tem uma conta?{' '}
                        <a
                            href="#"
                            onClick={(e) => {
                                e.preventDefault();
                                if (typeof onVoltarLogin === 'function') {
                                    onVoltarLogin();
                                }
                            }}
                        >
                            Faça login
                        </a>
                    </p>
                </div>
            </div>
        </div>
    );
};

export default Cadastro;
