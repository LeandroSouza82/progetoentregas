import React, { useState, useEffect, useRef } from 'react';
import supabase, { subscribeToTable } from '../../src/supabaseClient';

export default function AppMotorista() {
    // Sessão do motorista (persistida)
    const [loggedIn, setLoggedIn] = useState(() => {
        try {
            const s = JSON.parse(localStorage.getItem('motorista')) || null;
            // garantir que `aprovado` exista no estado local
            if (s && typeof s.aprovado === 'undefined') s.aprovado = false;
            return s;
        } catch (e) { return null; }
    });
    const [entregas, setEntregas] = useState([]);
    const [status, setStatus] = useState("Localizando...");

    // Campos temporários do formulário de login
    const [formNome, setFormNome] = useState(loggedIn ? loggedIn.nome : '');
    const [formEmail, setFormEmail] = useState(loggedIn ? loggedIn.email || '' : '');
    const [formPlaca, setFormPlaca] = useState(loggedIn ? loggedIn.veiculo : '');
    const [formFoto, setFormFoto] = useState(loggedIn ? (loggedIn.foto || '') : '');
    const [loginLoading, setLoginLoading] = useState(false);
    const [loginError, setLoginError] = useState('');
    const [loginVisible, setLoginVisible] = useState(false); // animação modal
    const [session, setSession] = useState(null);

    // evitar logs repetidos ao carregar rota
    const carregarRotaLogRef = useRef(false);

    // estilo de gradiente para a palavra DASHBOARD (declarado antes do uso)
    const gradientStyle = {
        background: 'linear-gradient(to right, #3B82F6, #FFFFFF)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent'
    };

    // Solicita permissão de geolocalização (força o prompt onde suportado)
    const solicitarPermissaoGPS = async () => {
        try {
            if (!navigator || !navigator.geolocation || !navigator.geolocation.getCurrentPosition) return;
            return await new Promise((resolve, reject) => {
                try {
                    navigator.geolocation.getCurrentPosition(
                        (p) => resolve(p),
                        (err) => reject(err),
                        { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
                    );
                } catch (e) { reject(e); }
            });
        } catch (e) { /* swallow */ }
    };

    // If we have an email but no id, try to resolve the full motorista record (id, aprovado) by email
    useEffect(() => {
        if (!loggedIn) return;
        if (loggedIn && !loggedIn.id && loggedIn.email) {
            (async () => {
                try {
                    const res = await supabase.from('motoristas').select('*').eq('email', loggedIn.email).limit(1);
                    const found = res && res.data ? res.data[0] : null;
                    if (found && found.id) {
                        const updated = { ...(loggedIn || {}), id: found.id, aprovado: !!found.aprovado };
                        try { localStorage.setItem('motorista', JSON.stringify(updated)); } catch (e) { }
                        try { setLoggedIn(updated); } catch (e) { }
                    }
                } catch (e) { console.warn('Falha ao resolver motorista por email:', e); }
            })();
        }
        setLoginVisible(false);
        const t = setTimeout(() => setLoginVisible(true), 20);
        return () => clearTimeout(t);
    }, [loggedIn]);

    async function fazerLogin(e) {
        e.preventDefault();
        setLoginError('');
        if (!formNome.trim() || !formPlaca.trim()) {
            setLoginError('Nome e Veículo/Placa são obrigatórios.');
            return;
        }
        setLoginLoading(true);
        try {
            // If an email was provided, attempt to create a Supabase Auth user so
            // the DB trigger can read `options.data.nome`. Use a short-lived
            // generated password (user can recover/reset later). Failure here
            // should not block the normal app flow, so swallow errors.
            if (formEmail && formEmail.trim() && supabase && supabase.auth && typeof supabase.auth.signUp === 'function') {
                try {
                    const genPassword = (() => {
                        const rnd = Math.random().toString(36).slice(-8);
                        return `V10-${Date.now().toString(36)}-${rnd}A!`;
                    })();
                    const signRes = await supabase.auth.signUp({
                        email: formEmail.trim(),
                        password: genPassword,
                        options: {
                            data: {
                                nome: formNome.trim()
                            }
                        }
                    });
                    // Nota: não marcar automaticamente como online aqui — controlaremos o flag de `esta_online` apenas após
                    // login concluído e com motorista aprovado. Escrita automática aqui foi removida conforme regra de ouro.
                    // (Se houver necessidade futura, marcar online deve ser ação explícita do motorista.)
                } catch (e) {
                    console.warn('supabase.auth.signUp failed (non-fatal):', e && e.message ? e.message : e);
                }
            }
            // procura por placa primeiro
            // Try to find existing motorista by name
            let existing = null;
            try {
                const res = await supabase.from('motoristas').select('*').eq('nome', formNome.trim()).limit(1);
                existing = res && res.data ? res.data[0] : null;
            } catch (err) { existing = null; }

            let driver = null;
            if (existing && existing.id) {
                // Atualiza apenas campos de perfil — NÃO alteramos `esta_online` automaticamente aqui
                const upd = await supabase.from('motoristas').update({ nome: formNome.trim(), email: formEmail.trim() || existing.email, avatar_path: formFoto }).eq('id', existing.id);
                driver = Array.isArray(upd.data) ? upd.data[0] : upd.data;
            } else {
                // Garantir que novo motorista comece com `aprovado: false` e `esta_online: false` (não iremos marcar online automaticamente)
                const ins = await supabase.from('motoristas').insert([{ nome: formNome.trim(), email: formEmail.trim() || null, avatar_path: formFoto, esta_online: false, aprovado: false }]);
            }

            const sess = { id: driver.id, nome: driver.nome, avatar_path: driver.avatar_path, email: driver.email || formEmail.trim(), aprovado: !!driver.aprovado, esta_online: !!driver.esta_online };
            localStorage.setItem('motorista', JSON.stringify(sess));
            try { if (sess.email) localStorage.setItem('v10_email', sess.email); } catch (e) { }
            setLoggedIn(sess);
            setLoginVisible(false);
            setStatus('Online (logado)');
            try { if (window.Notification && Notification.permission === 'granted') new Notification('Bem vindo, ' + sess.nome); } catch (e) { }

            // Marcar online de forma explícita **apenas** se já estiver aprovado pelo gestor
            if (sess.aprovado === true) {
                (async () => {
                    try {
                        await supabase.from('motoristas').update({ esta_online: true }).eq('id', sess.id);
                    } catch (e) { console.warn('Falha ao marcar online após login (non-fatal):', e && e.message ? e.message : e); }
                })();
            }

            // Forçar prompt de permissão GPS ao fazer login e alertar se negado
            try {
                if (typeof navigator !== 'undefined' && navigator.permissions && typeof navigator.permissions.query === 'function') {
                    const perm = await navigator.permissions.query({ name: 'geolocation' });
                    if (perm.state === 'denied') {
                        alert('Permissão de Localização negada. O app do motorista precisa de GPS para funcionar. Por favor, ative a permissão nas configurações.');
                        setStatus('GPS negado');
                    } else if (perm.state === 'prompt') {
                        try {
                            await solicitarPermissaoGPS();
                        } catch (e) {
                            alert('Permissão de Localização necessária. Ative o GPS para que o app funcione corretamente.');
                            setStatus('GPS negado');
                        }
                    }
                } else {
                    // Fallback: tentar obter posição imediatamente
                    try {
                        await solicitarPermissaoGPS();
                    } catch (e) {
                        alert('Permissão de Localização necessária. Ative o GPS para que o app funcione corretamente.');
                        setStatus('GPS negado');
                    }
                }
            } catch (e) { /* ignore */ }
        } catch (err) {
            console.error('Erro no login:', err);
            setLoginError('Erro ao realizar login. Tente novamente.');
        } finally {
            setLoginLoading(false);
        }
    }

    async function fazerLogout() {
        const userEmail = loggedIn?.email || (typeof localStorage !== 'undefined' ? localStorage.getItem('v10_email') : null);
        const userId = loggedIn?.id || null;

        console.log('Iniciando processo de logout...');

        // Build double-filter (id,email)
        const filters = [];
        if (userId) filters.push(`id.eq.${userId}`);
        if (userEmail) filters.push(`email.eq.${userEmail}`);
        const orFilter = filters.join(',');

        if (orFilter) {
            try {
                // STRICT SEQUENTIAL: aguarda o update completar antes de signOut
                const { data, error } = await supabase.from('motoristas').update({ esta_online: false }).or(orFilter).select();
                if (error) {
                    console.error('Erro ao avisar o banco (update retornou erro):', error);
                } else {
                    console.log('Banco atualizado com sucesso para offline.', data);
                }
            } catch (e) {
                console.error('Erro inesperado ao atualizar motoristas:', e);
            }
        } else {
            console.warn('Nenhum id/email disponível para marcar offline; prosseguindo com logout');
        }

        // 2. Agora encerra a sessão
        try {
            if (supabase && supabase.auth && typeof supabase.auth.signOut === 'function') {
                await supabase.auth.signOut();
            }
        } catch (e) {
            console.warn('signOut falhou (não bloqueante):', e);
        }

        try { localStorage.removeItem('v10_email'); } catch (e) { }
        try { localStorage.removeItem('motorista'); } catch (e) { }
        setLoggedIn(null);
        setEntregas([]);
        setStatus('Desconectado');

        try { window.location.reload(); } catch (e) { /* ignore */ }
    }
    // Função para buscar os dados (usa tabela correta `entregas` e filtra por motorista)
    const carregarRota = async () => {
        try {
            // logar apenas na primeira execução para evitar piscar no console
            if (!carregarRotaLogRef.current) {
                console.log("[motorista] carregarRota: iniciando fetch de entregas (mock supabase)");
            }
            const motoristaId = loggedIn && loggedIn.id ? loggedIn.id : null;
            if (!motoristaId) {
                if (!carregarRotaLogRef.current) console.warn('[motorista] carregarRota: motoristaId ausente, abortando fetch');
                setEntregas([]);
                return;
            }
            const res = await supabase
                .from('entregas')
                .select('*')
                .eq('motorista_id', motoristaId)
                .order('created_at', { ascending: false });
            const data = res && res.data ? res.data : [];
            setEntregas(Array.isArray(data) ? data : []);
            if (!carregarRotaLogRef.current) {
                console.log("[motorista] carregarRota: resultado", { preview: data.slice ? data.slice(0, 5) : data });
                carregarRotaLogRef.current = true;
            }
        } catch (error) {
            console.error("Erro ao carregar rota:", error);
        } finally {
            if (!carregarRotaLogRef.current) console.log("[motorista] carregarRota: fim");
        }
    };

    // carregar rota apenas uma vez ao montar a página (evita re-execuções infinitas)
    useEffect(() => {
        if (!loggedIn?.id) return; // ensure we have an id before attempting to load
        // Se não aprovado, não carrega rota nem ativa GPS; mostra mensagem de análise
        if (!loggedIn.aprovado) {
            setEntregas([]);
            setStatus('Cadastro em análise. Aguarde a liberação do gestor.');
            return;
        }

        carregarRota();

        // pedir permissão de notificações (opcional)
        if (window.Notification && Notification.permission !== 'granted') {
            Notification.requestPermission().catch(() => { });
        }

        setStatus('GPS desativado');
        return () => { /* limpeza não necessária sem watchPosition */ };
        // rodar somente no mount conforme correção cirúrgica
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Sincroniza sessão (quando disponível) para usar em chamadas keepalive
    useEffect(() => {
        let mounted = true;
        let listener = null;
        (async () => {
            try {
                if (!supabase || !supabase.auth || !supabase.auth.getSession) return;
                const res = await supabase.auth.getSession();
                if (!mounted) return;
                setSession(res?.data?.session || null);
            } catch (e) { /* ignore */ }
        })();

        // Listen for auth state changes to mark auth-signed users as online when they sign in
        try {
            if (supabase && supabase.auth && typeof supabase.auth.onAuthStateChange === 'function') {
                const sub = supabase.auth.onAuthStateChange((event, sess) => {
                    try {
                        if (event === 'SIGNED_IN' && sess && sess.user && sess.user.id) {
                            const authId = sess.user.id;
                            // Só marcar online automaticamente se o cliente local já tem esse motorista logado e ele está aprovado
                            let stored = null;
                            try { stored = JSON.parse(localStorage.getItem('motorista') || 'null'); } catch (e) { stored = null; }
                            if (stored && stored.id && String(stored.id) === String(authId) && stored.aprovado === true) {
                                supabase.from('motoristas').update({ esta_online: true }).eq('id', authId).catch(() => { /* swallow */ });
                            }
                        }
                    } catch (e) { /* swallow */ }
                });
                // manter referência para cleanup (sub pode ter .data / .subscription)
                listener = sub && sub.data ? sub.data : sub;
            }
        } catch (e) { /* ignore */ }

        return () => {
            mounted = false;
            // cleanup do listener, se disponível
            try {
                if (listener) {
                    if (typeof listener.unsubscribe === 'function') listener.unsubscribe();
                    else if (typeof listener.subscription === 'object' && typeof listener.subscription.unsubscribe === 'function') listener.subscription.unsubscribe();
                }
            } catch (e) { /* ignore */ }
        };
        // rodar apenas no mount para evitar re-execuções
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Realtime: escuta atualizações do motorista logado (aprovação em tempo real)
    useEffect(() => {
        if (!loggedIn) return;
        const id = loggedIn.id;
        const email = loggedIn.email;
        const channels = [];

        try {
            // Prefer native realtime if available
            if (supabase && typeof supabase.channel === 'function') {
                if (id) {
                    const chanId = `motorista-updates-id-${id}`;
                    const chId = supabase.channel(chanId).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'motoristas', filter: `id=eq.${id}` }, (payload) => {
                        try {
                            const rec = payload.new || payload.record || null;
                            if (!rec) return;

                            // Sincroniza flag de aprovação
                            if (rec.aprovado === true && !(loggedIn && loggedIn.aprovado)) {
                                const updated = { ...(loggedIn || {}), aprovado: true };
                                try { localStorage.setItem('motorista', JSON.stringify(updated)); } catch (e) { }
                                try { setLoggedIn(updated); } catch (e) { }
                                try { setStatus('Online (aprovado)'); } catch (e) { }
                                try { carregarRota(); } catch (e) { }
                            }

                            // Sincroniza explicitamente o flag esta_online — se gestor marcar false, refletir localmente e não sobrescrever
                            if (typeof rec.esta_online !== 'undefined' && loggedIn && String(loggedIn.id) === String(rec.id)) {
                                const updated = { ...(loggedIn || {}), esta_online: rec.esta_online === true };
                                try { localStorage.setItem('motorista', JSON.stringify(updated)); } catch (e) { }
                                try { setLoggedIn(updated); } catch (e) { }
                                try { setStatus(rec.esta_online === true ? 'Online (aprovado)' : 'Offline (bloqueado)'); } catch (e) { }
                            }
                        } catch (e) { /* ignore */ }
                    }).subscribe();
                    channels.push(chId);
                }

                if (email) {
                    const chanEmail = `motorista-updates-email-${email}`;
                    const chEmail = supabase.channel(chanEmail).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'motoristas', filter: `email=eq.${email}` }, (payload) => {
                        try {
                            const rec = payload.new || payload.record || null;
                            if (!rec) return;

                            if (rec.aprovado === true && !(loggedIn && loggedIn.aprovado)) {
                                const updated = { ...(loggedIn || {}), aprovado: true, id: rec.id };
                                try { localStorage.setItem('motorista', JSON.stringify(updated)); } catch (e) { }
                                try { setLoggedIn(updated); } catch (e) { }
                                try { setStatus('Online (aprovado)'); } catch (e) { }
                                try { carregarRota(); } catch (e) { }
                            }

                            // Sincroniza explicitamente o flag esta_online — se gestor marcar false, refletir localmente e não sobrescrever
                            if (typeof rec.esta_online !== 'undefined') {
                                const updated = { ...(loggedIn || {}), esta_online: rec.esta_online === true, id: rec.id || (loggedIn && loggedIn.id) };
                                try { localStorage.setItem('motorista', JSON.stringify(updated)); } catch (e) { }
                                try { setLoggedIn(updated); } catch (e) { }
                                try { setStatus(rec.esta_online === true ? 'Online (aprovado)' : 'Offline (bloqueado)'); } catch (e) { }
                            }

                        } catch (e) { /* ignore */ }
                    }).subscribe();
                    channels.push(chEmail);
                }
            } else {
                // fallback polling: subscribeToTable if available
                try {
                    if (typeof subscribeToTable === 'function') {
                        if (id) {
                            const stop = subscribeToTable('motoristas', (res) => {
                                (res && res.data || []).filter(r => String(r.id) === String(id)).forEach(r => {
                                    // emulate payload format
                                    const rec = r;
                                    if (rec.aprovado === true && !(loggedIn && loggedIn.aprovado)) {
                                        const updated = { ...(loggedIn || {}), aprovado: true };
                                        try { localStorage.setItem('motorista', JSON.stringify(updated)); } catch (e) { }
                                        try { setLoggedIn(updated); } catch (e) { }
                                        try { setStatus('Online (aprovado)'); } catch (e) { }
                                        try { carregarRota(); } catch (e) { }
                                    }
                                    if (typeof rec.esta_online !== 'undefined' && loggedIn && String(loggedIn.id) === String(rec.id)) {
                                        const updated = { ...(loggedIn || {}), esta_online: rec.esta_online === true };
                                        try { localStorage.setItem('motorista', JSON.stringify(updated)); } catch (e) { }
                                        try { setLoggedIn(updated); } catch (e) { }
                                        try { setStatus(rec.esta_online === true ? 'Online (aprovado)' : 'Offline (bloqueado)'); } catch (e) { }
                                    }
                                });
                            }, { pollMs: 1500 });
                            channels.push({ stop });
                        }

                        if (email) {
                            const stopE = subscribeToTable('motoristas', (res) => {
                                (res && res.data || []).filter(r => String(r.email) === String(email)).forEach(r => {
                                    const rec = r;
                                    if (rec.aprovado === true && !(loggedIn && loggedIn.aprovado)) {
                                        const updated = { ...(loggedIn || {}), aprovado: true, id: rec.id };
                                        try { localStorage.setItem('motorista', JSON.stringify(updated)); } catch (e) { }
                                        try { setLoggedIn(updated); } catch (e) { }
                                        try { setStatus('Online (aprovado)'); } catch (e) { }
                                        try { carregarRota(); } catch (e) { }
                                    }
                                    if (typeof rec.esta_online !== 'undefined') {
                                        const updated = { ...(loggedIn || {}), esta_online: rec.esta_online === true, id: rec.id || (loggedIn && loggedIn.id) };
                                        try { localStorage.setItem('motorista', JSON.stringify(updated)); } catch (e) { }
                                        try { setLoggedIn(updated); } catch (e) { }
                                        try { setStatus(rec.esta_online === true ? 'Online (aprovado)' : 'Offline (bloqueado)'); } catch (e) { }
                                    }
                                });
                            }, { pollMs: 1500 });
                            channels.push({ stop: stopE });
                        }
                    }
                } catch (e) { /* ignore */ }
            }
        } catch (e) { /* ignore */ }

        return () => {
            try { channels.forEach(c => { if (c && typeof c.unsubscribe === 'function') c.unsubscribe(); }); } catch (e) { }
        };
    }, [loggedIn && loggedIn.id, loggedIn && loggedIn.email]);
    // GPS: força prompt e inicia watchPosition para enviar lat/lng ao Supabase
    // GPS: força prompt e inicia watchPosition para enviar lat/lng ao Supabase
    useEffect(() => {
        if (!loggedIn) return;
        // Somente iniciar captura de posição quando motorista estiver aprovado
        if (!loggedIn.aprovado) return;
        // Se gestor marcou motorista como offline/blocked, não devemos iniciar captura de posição nem sobrescrever o flag
        if (loggedIn.esta_online === false) {
            try { setStatus('Offline (bloqueado pelo gestor)'); } catch (e) { }
            return;
        }
        if (typeof navigator === 'undefined' || !navigator.geolocation) {
            console.warn('[motorista] Geolocation API não disponível no navegador');
            return;
        }

        let watchId = null;

        const sendPosition = async (lat, lng) => {
            try {
                const driverId = loggedIn?.id || null;
                if (!driverId) return;
                await supabase.from('motoristas').update({ lat, lng, ultima_atualizacao: new Date().toISOString() }).eq('id', driverId);
            } catch (e) {
                console.warn('[motorista] Falha ao enviar posição para Supabase:', e && e.message ? e.message : e);
            }
        };

        const handleWatch = (pos) => {
            try {
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;
                sendPosition(lat, lng);
                try { setStatus('GPS ativo'); } catch (e) { /* ignore */ }
            } catch (e) { /* ignore */ }
        };

        const handleError = (err) => {
            console.warn('[motorista] watchPosition erro:', err && err.message ? err.message : err);
            try { setStatus('GPS indisponível'); } catch (e) { /* ignore */ }
        };

        // Trigger permission prompt once using getCurrentPosition
        try {
            navigator.geolocation.getCurrentPosition((p) => {
                // permission granted, start watchPosition
                try {
                    watchId = navigator.geolocation.watchPosition(handleWatch, handleError, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
                    console.log('GPS Ativado com sucesso para o ID:', loggedIn?.id);
                } catch (e) {
                    console.warn('[motorista] Falha ao iniciar watchPosition:', e && e.message ? e.message : e);
                }
            }, (err) => {
                // permission denied or error
                try {
                    alert('O V10 não funciona sem GPS. Por favor, ative nas configurações do seu navegador/celular');
                    setStatus('GPS negado');
                } catch (e) { /* ignore */ }
            }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
        } catch (e) {
            console.warn('[motorista] getCurrentPosition falhou ao solicitar permissão:', e && e.message ? e.message : e);
        }

        return () => {
            try {
                if (watchId != null && navigator.geolocation && navigator.geolocation.clearWatch) navigator.geolocation.clearWatch(watchId);
            } catch (e) { /* ignore */ }
        };
    }, [loggedIn]);

    // Failsafe: quando aba é fechada/atualizada, tentar marcar motorista como offline
    useEffect(() => {
        const handleBeforeUnload = () => {
            try {
                if (!loggedIn || !loggedIn.id) return;

                const savedEmail = (loggedIn && loggedIn.email) ? loggedIn.email : (typeof localStorage !== 'undefined' ? localStorage.getItem('v10_email') : null);

                // tentativa via fetch keepalive (preferível ao client SDK neste momento de unload)
                try {
                    const supabaseUrl = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env.VITE_SUPABASE_URL : undefined;
                    const anonKey = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env.VITE_SUPABASE_ANON_KEY : undefined;
                    if (supabaseUrl) {
                        const identifier = savedEmail ? `email=eq.${encodeURIComponent(savedEmail)}` : `id=eq.${encodeURIComponent(loggedIn.id)}`;
                        const url = `${supabaseUrl}/rest/v1/motoristas?${identifier}`;
                        const body = JSON.stringify({ esta_online: false, ultimo_sinal: new Date().toISOString() });
                        try {
                            fetch(url, {
                                method: 'PATCH',
                                keepalive: true,
                                headers: {
                                    'Content-Type': 'application/json',
                                    'apikey': anonKey || '',
                                    'Authorization': anonKey ? `Bearer ${anonKey}` : ''
                                },
                                body
                            }).catch(() => { /* swallow */ });
                        } catch (e) {
                            // fallback para sendBeacon quando fetch não for permitido
                            try {
                                if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
                                    const beaconUrl = `${supabaseUrl}/rest/v1/motoristas?${identifier}&apikey=${encodeURIComponent(anonKey || '')}`;
                                    navigator.sendBeacon(beaconUrl, body);
                                }
                            } catch (e2) { /* swallow */ }
                        }
                    }
                } catch (e) { /* swallow */ }
            } catch (e) { /* swallow */ }
        };

        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [loggedIn]);

    // Desconexão resiliente: usar fetch keepalive / pagehide / visibilitychange
    useEffect(() => {
        if (!loggedIn || !loggedIn.id) return;

        const marcarOfflineGarantido = async () => {
            try {
                const supabaseUrl = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env.VITE_SUPABASE_URL : undefined;
                const anonKey = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env.VITE_SUPABASE_ANON_KEY : undefined;

                const userId = loggedIn.id;
                if (!supabaseUrl || !userId) return;

                // Tentar obter token de sessão se disponível
                let accessToken = anonKey || '';
                try {
                    const sessRes = await (supabase.auth && supabase.auth.getSession ? supabase.auth.getSession() : Promise.resolve(null));
                    const session = sessRes?.data?.session || sessRes?.session || null;
                    if (session && session.access_token) accessToken = session.access_token;
                } catch (e) { /* ignore */ }

                const fallbackEmail = (loggedIn && loggedIn.email) ? loggedIn.email : (typeof localStorage !== 'undefined' ? localStorage.getItem('v10_email') : null);
                const identifier = fallbackEmail ? `email=eq.${encodeURIComponent(fallbackEmail)}` : `id=eq.${encodeURIComponent(userId)}`;
                const url = `${supabaseUrl}/rest/v1/motoristas?${identifier}`;
                const body = JSON.stringify({ esta_online: false, ultimo_sinal: new Date().toISOString() });

                // Fetch com keepalive: ideal para garantir requisição em background/unload
                try {
                    fetch(url, {
                        method: 'PATCH',
                        keepalive: true,
                        headers: {
                            'apikey': anonKey || '',
                            'Authorization': `Bearer ${accessToken || anonKey || ''}`,
                            'Content-Type': 'application/json',
                            'Prefer': 'return=minimal'
                        },
                        body
                    }).catch(() => { /* swallow */ });
                    return;
                } catch (e) {
                    /* fallback below */
                }

                // fallback para sendBeacon (quando fetch keepalive não suportado)
                try {
                    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
                        const beaconUrl = `${supabaseUrl}/rest/v1/motoristas?${identifier}&apikey=${encodeURIComponent(anonKey || '')}`;
                        navigator.sendBeacon(beaconUrl, body);
                        return;
                    }
                } catch (e) { }

                // último recurso: XHR síncrono (pode ser bloqueado em alguns navegadores)
                try {
                    if (typeof XMLHttpRequest !== 'undefined') {
                        const xhr = new XMLHttpRequest();
                        xhr.open('PATCH', `${supabaseUrl}/rest/v1/motoristas?${identifier}`, false);
                        xhr.setRequestHeader('Content-Type', 'application/json');
                        if (anonKey) xhr.setRequestHeader('apikey', anonKey);
                        if (accessToken) xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
                        xhr.send(body);
                    }
                } catch (e) { /* swallow */ }

            } catch (e) {
                /* swallow */
            }
        };

        const onVisibility = () => { if (document.visibilityState === 'hidden') marcarOfflineGarantido(); };

        document.addEventListener('visibilitychange', onVisibility);
        // adicionar pagehide diretamente com a função marcada
        window.addEventListener('pagehide', marcarOfflineGarantido);

        return () => {
            document.removeEventListener('visibilitychange', onVisibility);
            window.removeEventListener('pagehide', marcarOfflineGarantido);
        };
    }, [loggedIn, session]);

    return (
        <div style={{ padding: '20px', background: '#121212', color: '#fff', minHeight: '100vh', fontFamily: 'sans-serif' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
                <div>
                    <div style={{ fontSize: '24px', fontWeight: 'bold' }}>
                        <span style={gradientStyle}>DASHBOARD</span>
                    </div>
                    <div style={{ fontSize: '11px', color: '#888', textTransform: 'uppercase', letterSpacing: '1px' }}>App Motorista</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    {loggedIn ? (
                        <>
                            {loggedIn.foto && <img src={loggedIn.foto} alt="foto" style={{ width: '44px', height: '44px', borderRadius: '50%', objectFit: 'cover', border: '2px solid #222' }} />}
                            <div style={{ textAlign: 'right' }}>
                                <div style={{ fontSize: '13px', fontWeight: '700' }}>{loggedIn.nome}</div>
                                <div style={{ fontSize: '11px', color: '#aaa' }}>{status}</div>
                            </div>
                            <button onClick={fazerLogout} style={{ marginLeft: '12px', background: '#ff5252', border: 'none', color: '#fff', padding: '8px 10px', borderRadius: '10px', fontWeight: '700', cursor: 'pointer' }}>Sair</button>
                        </>
                    ) : (
                        <div style={{ fontSize: '12px', color: '#888' }}>{status}</div>
                    )}
                </div>
            </div>

            {loggedIn && !loggedIn.aprovado && (
                <div style={{ marginTop: '60px', textAlign: 'center', color: '#fff' }}>
                    <div style={{ fontSize: '20px', fontWeight: '700', color: '#00e676' }}>Cadastro em análise</div>
                    <p style={{ color: '#ccc', marginTop: '10px' }}>Aguarde a liberação do gestor.</p>
                    <div style={{ marginTop: '18px' }}>
                        <button onClick={fazerLogout} style={{ padding: '12px 18px', borderRadius: '10px', border: 'none', background: '#ff5252', color: '#fff', cursor: 'pointer', fontWeight: 700 }}>Sair</button>
                    </div>
                </div>
            )}

            {!loggedIn && (
                <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(180deg, rgba(0,0,0,0.6), rgba(0,0,0,0.7))', zIndex: 999 }}>
                    <form onSubmit={fazerLogin} style={{ background: '#0f1724', color: '#fff', padding: '28px', borderRadius: '14px', width: '360px', boxShadow: '0 12px 40px rgba(0,0,0,0.6)', transform: loginVisible ? 'translateY(0)' : 'translateY(10px)', opacity: loginVisible ? 1 : 0, transition: 'all 300ms ease' }}>
                        <h2 style={{ margin: '0 0 8px 0', fontSize: '20px' }}>Entrar como Motorista</h2>
                        <p style={{ margin: '0 0 18px 0', color: '#9aa4b2' }}>Insira seus dados para acessar o app</p>
                        {loginError && <div style={{ marginBottom: '10px', color: '#ffb4b4', background: '#2b1010', padding: '8px', borderRadius: '8px' }}>{loginError}</div>}
                        <div style={{ color: '#000', fontWeight: 700, marginBottom: '6px' }}>Nome</div>
                        <input id="input-nome" value={formNome} onChange={e => setFormNome(e.target.value)} placeholder="Nome" style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #223344', marginBottom: '10px', background: '#0b1220', color: '#fff' }} />

                        <div style={{ color: '#000', fontWeight: 700, marginBottom: '6px' }}>Email (opcional)</div>
                        <input id="input-email" value={formEmail} onChange={e => setFormEmail(e.target.value)} placeholder="Email (opcional, usado para logout resiliente)" style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #223344', marginBottom: '10px', background: '#0b1220', color: '#fff' }} />

                        <div style={{ color: '#000', fontWeight: 700, marginBottom: '6px' }}>Veículo / Placa</div>
                        <input id="input-placa" value={formPlaca} onChange={e => setFormPlaca(e.target.value)} placeholder="Veículo / Placa" style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #223344', marginBottom: '10px', background: '#0b1220', color: '#fff' }} />

                        <div style={{ color: '#000', fontWeight: 700, marginBottom: '6px' }}>URL da foto (opcional)</div>
                        <input id="input-foto" value={formFoto} onChange={e => setFormFoto(e.target.value)} placeholder="URL da foto (opcional)" style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #223344', marginBottom: '16px', background: '#0b1220', color: '#fff' }} />
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button type="submit" disabled={loginLoading} style={{ flex: 1, padding: '12px', borderRadius: '10px', border: 'none', background: loginLoading ? '#7be79a' : '#00e676', color: '#000', fontWeight: '800', cursor: loginLoading ? 'wait' : 'pointer' }}>{loginLoading ? 'Entrando...' : 'Entrar'}</button>
                            <button type="button" onClick={() => { setFormNome(''); setFormPlaca(''); setFormFoto(''); setLoginError(''); }} style={{ padding: '12px', borderRadius: '10px', border: '1px solid #223344', background: 'transparent', color: '#fff', cursor: 'pointer' }}>Limpar</button>
                        </div>
                    </form>
                </div>
            )}

            {loggedIn && (entregas.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#444', marginTop: '100px' }}>
                    <div style={{ fontSize: '60px' }}>🚛</div>
                    <p>Aguardando novas entregas...</p>
                </div>
            ) : (
                entregas.map((e, i) => (
                    <div key={e.id || i} style={mCard}>
                        <div style={{ color: '#00e676', fontWeight: 'bold', fontSize: '12px' }}>PARADA {i + 1}</div>
                        <div style={{ fontSize: '20px', margin: '5px 0' }}>{e.cliente || 'Cliente'}</div>
                        <div style={{ color: '#aaa', fontSize: '14px', marginBottom: '20px' }}>📍 {e.endereco || 'Endereço não informado'}</div>
                        <button
                            onClick={() => setEntregas(p => p.filter((_, index) => index !== i))}
                            style={mBtn}
                        >
                            CONCLUIR ENTREGA
                        </button>
                    </div>
                ))
            ))}
        </div>
    );
}

const mCard = { background: '#1e1e1e', padding: '20px', borderRadius: '15px', marginBottom: '15px', boxShadow: '0 4px 15px rgba(0,0,0,0.5)' };
const mBtn = { width: '100%', padding: '15px', background: '#00e676', color: '#000', border: 'none', borderRadius: '10px', fontWeight: 'bold', fontSize: '16px', cursor: 'pointer' };