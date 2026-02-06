import React, { useState, useEffect, useRef, useMemo } from 'react';
import supabase, { onSupabaseReady } from '../../src/supabaseClient'; // Usar o Supabase real do projeto
import MapaLogistica from '../../src/MapaLogistica';
import { enviarNotificacaoSW, solicitarPermissaoNotificacao } from './notificationHelper';
// keep imports minimal for map rendering via MapaLogistica

const GOOGLE_MAPS_API_KEY = (typeof import.meta !== 'undefined' && import.meta.env) ? (import.meta.env.VITE_GOOGLE_MAPS_KEY || 'AIzaSyBeec8r4DWBdNIEFSEZg1CgRxIHjYMV9dM') : 'AIzaSyBeec8r4DWBdNIEFSEZg1CgRxIHjYMV9dM';

function numberedIconUrl(number) {
    const n = number || '';
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='30' height='30'><circle cx='15' cy='15' r='15' fill='%232563eb' stroke='%23fff' stroke-width='2'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-size='12' fill='%23fff' font-family='Arial' font-weight='700'>${n}</text></svg>`;
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

// --- ESTILOS MOBILE (CSS-in-JS) ---
const themes = {
    light: {
        bg: '#f3f4f6',
        header: '#111827',
        card: '#ffffff',
        primary: '#2563eb',
        secondary: '#10b981',
        textMain: '#1f2937',
        textLight: '#6b7280',
        maps: '#34a853'
    },
    dark: {
        bg: '#18181b',
        header: '#27272a',
        card: '#23232b',
        primary: '#60a5fa',
        secondary: '#22d3ee',
        textMain: '#f3f4f6',
        textLight: '#a1a1aa',
        maps: '#34a853'
    }
};

// numberedIcon replaced by numberedIconUrl (SVG data URL) for Google Maps

function isValidSC(lat, lng) {
    const latN = Number(lat);
    const lngN = Number(lng);
    return latN >= -29.5 && latN <= -25.8 && lngN >= -54.0 && lngN <= -48.3;
}

function InternalMobileApp() {
    // Estado da bateria (simulado)
    const [battery, setBattery] = useState({ level: 0.85, charging: false });

    // Simulação de atualização da bateria removida para evitar processos em background (estabilidade)
    // Mantemos um nível estático para exibição
    useEffect(() => { setBattery({ level: 0.85, charging: false }); }, []);
    // Estado do Motorista: inicializa a partir da sessão persistida (localStorage)
    const [motorista, setMotorista] = useState(() => {
        try {
            const raw = localStorage.getItem('motorista');
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    });
    const [entregas, setEntregas] = useState([]);
    const [selectedId, setSelectedId] = useState(null);
    const [carregando, setCarregando] = useState(true);
    const [darkMode, setDarkMode] = useState(false);
    const [lastUpdateTimestamp, setLastUpdateTimestamp] = useState(Date.now()); // 🔥 Força re-render
    const theme = darkMode ? themes.dark : themes.light;

    // Estado do chat rápido
    const [chatOpen, setChatOpen] = useState(false);
    const [chatMsg, setChatMsg] = useState('');
    const [chatLog, setChatLog] = useState([]);

    // Função para enviar mensagem (simulação)
    function enviarMsgGestor() {
        if (!chatMsg.trim()) return;
        setChatLog(log => [...log, { autor: 'Motorista', texto: chatMsg, ts: new Date().toLocaleTimeString() }]);
        setChatMsg('');
        // Simula resposta do gestor
        setTimeout(() => {
            setChatLog(log => [...log, { autor: 'Gestor', texto: 'Recebido! 👍', ts: new Date().toLocaleTimeString() }]);
        }, 1200);
    }

    // Carrega entregas do Supabase e fixa a conexão ao mount (sem polling) → evita "pisca-pisca" de status
    useEffect(() => {
        let mounted = true;
        async function init() {
            // Marca uma vez como online
            try { await markOnline(); } catch (e) { /* ignore */ }

            // Busca entregas uma vez (force load independent of auth/user)
            try { await carregarRota(); } catch (e) { /* ignore */ }

            // Also log raw motoristas for debugging mapping issues (if reachable)
            try {
                const { data: mf, error: mErr } = await supabase.from('motoristas').select('*').limit(50);
                if (mErr) console.error('[motorista] erro fetch motoristas:', mErr);
                try { console.log('Motoristas Brutos (motorista app):', mf); } catch (e) { }
            } catch (e) { console.error('[motorista] fetch motoristas failed', e); }

            // Busca dados frescos do motorista (lat/lng) apenas uma vez para garantir que o mapa mostre a moto
            try {
                if (motorista && motorista.id) {
                    const { data: mData, error } = await supabase.from('motoristas').select('*').eq('id', motorista.id).limit(1).maybeSingle();
                    if (!error && mData && mounted) {
                        setMotorista(prev => {
                            // Only update when id or coordinates have actually changed to avoid excessive rerenders
                            const prevId = prev && prev.id ? String(prev.id) : null;
                            const newId = mData && mData.id ? String(mData.id) : null;
                            const prevLat = prev && typeof prev.lat !== 'undefined' ? Number(prev.lat) : null;
                            const prevLng = prev && typeof prev.lng !== 'undefined' ? Number(prev.lng) : null;
                            const newLat = mData && typeof mData.lat !== 'undefined' ? Number(mData.lat) : null;
                            const newLng = mData && typeof mData.lng !== 'undefined' ? Number(mData.lng) : null;
                            if (prevId !== newId || prevLat !== newLat || prevLng !== newLng) {
                                return { ...(prev || {}), ...mData };
                            }
                            return prev;
                        });
                    }
                }
            } catch (err) { /* ignore */ }
        }
        init();
        return () => { mounted = false; };
    }, []);

    // 📡 ATIVAÇÃO DO REALTIME: Atualiza a lista quando houver mudanças no banco de dados
    useEffect(() => {
        const mId = motorista && motorista.id ? String(motorista.id) : null;
        if (!mId || !supabase || typeof supabase.channel !== 'function') return;

        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📡 [CELULAR] Ativando Realtime para entregas do motorista:', mId);
        console.log('🔔 Escutando mudanças na tabela entregas...');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

        const channel = supabase.channel(`entregas_motorista_${mId}`)
            .on('postgres_changes',
                {
                    event: '*', // Sincronia total para qualquer mudança (Insert, Update, Delete)
                    schema: 'public',
                    table: 'entregas',
                    filter: `motorista_id=eq.${mId}`
                },
                (payload) => {
                    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                    console.log('🔔 [REALTIME] Mudança detectada no banco!');
                    console.log('📦 Tipo de evento:', payload.eventType);

                    if (payload.new) {
                        console.log('📝 Dados novos:', {
                            id: payload.new.id,
                            cliente: payload.new.cliente,
                            ordem_logistica: payload.new.ordem_logistica,
                            status: payload.new.status
                        });
                    }

                    if (payload.old) {
                        console.log('🗑️ Dados antigos:', {
                            id: payload.old.id,
                            cliente: payload.old.cliente,
                            ordem_logistica: payload.old.ordem_logistica
                        });
                    }

                    console.log('🔄 Recarregando lista completa do banco...');
                    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

                    // 🔥 FORÇA REFRESH COMPLETO: Busca do banco + atualiza timestamp
                    carregarRota(true);
                    setLastUpdateTimestamp(Date.now());
                }
            ).subscribe();

        return () => {
            console.log('🔌 [CELULAR] Desconectando Realtime...');
            if (channel) channel.unsubscribe();
        };
    }, [motorista?.id]);

    // 📣 LISTENER DE NOTIFICAÇÕES PUSH via Supabase Realtime
    useEffect(() => {
        const mId = motorista && motorista.id ? String(motorista.id) : null;
        if (!supabase || typeof supabase.channel !== 'function') return;

        console.log('📣 [CELULAR] Ativando listener de notificações push...');

        // Solicitar permissão para notificações (se ainda não tiver)
        solicitarPermissaoNotificacao();

        const pushChannel = supabase.channel('avisos-push')
            .on('broadcast', { event: 'nova-notificacao' }, async (payload) => {
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                console.log('📣 [PUSH] Nova notificação recebida!');
                console.log('📦 Payload:', payload);
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

                const { titulo, mensagem, motorista_id } = payload.payload || {};

                // Verificar se a notificação é para este motorista ou para todos
                const isForMe = !motorista_id || String(motorista_id) === String(mId);

                if (isForMe) {
                    try {
                        // 🔔 TENTA USAR SERVICE WORKER PRIMEIRO (funciona em background)
                        await enviarNotificacaoSW({
                            titulo: titulo || 'V10 Delivery',
                            mensagem: mensagem || 'Nova mensagem',
                            url: 'https://v10delivery.vercel.app'
                        });

                        console.log('✅ Notificação enviada via Service Worker!');
                    } catch (swErr) {
                        console.warn('⚠️ Falha no SW, usando Notification API:', swErr);

                        // FALLBACK: Notification API direto (só funciona com app aberto)
                        if ('Notification' in window && Notification.permission === 'granted') {
                            try {
                                const notification = new Notification(titulo || 'V10 Delivery', {
                                    body: mensagem || 'Nova mensagem',
                                    icon: '/assets/logo-v10.png.png',
                                    badge: '/assets/logo-v10.png.png',
                                    vibrate: [200, 100, 200],
                                    tag: 'v10-comunicado',
                                    requireInteraction: true
                                });

                                notification.onclick = () => {
                                    window.focus();
                                    notification.close();
                                };

                                console.log('✅ Notificação exibida via Notification API!');
                            } catch (notifErr) {
                                console.error('❌ Erro ao exibir notificação:', notifErr);
                            }
                        } else {
                            console.warn('⚠️ Permissão de notificação não concedida');
                        }
                    }
                }
            })
            .subscribe();

        return () => {
            console.log('🔌 [CELULAR] Desconectando listener de push...');
            if (pushChannel) pushChannel.unsubscribe();
        };
    }, [motorista?.id]);

    // Safety stub: prevent ref errors from missing helpers elsewhere
    const scheduleRetry = () => { };


    // Marca o motorista como Online no backend (mock ou real)
    async function markOnline() {
        try {
            const motoristaId = motorista && motorista.id ? motorista.id : null;
            if (!motoristaId) {
                console.warn('[motorista] markOnline: motoristaId ausente, não irá marcar online');
                return;
            }
            const { error } = await supabase.from('motoristas').update({ esta_online: true }).eq('id', motoristaId);
            if (error) console.error('[motorista] markOnline: erro ao atualizar motoristas', error);
            else console.debug('[motorista] markOnline: motorista marcado como Online');
        } catch (err) {
            console.error('[motorista] markOnline: exceção', err);
        }
    }

    async function carregarRota(force = false) {
        if (carregando && !force) return;
        setCarregando(true);
        try {
            const mId = motorista && motorista.id ? String(motorista.id) : null;
            if (!mId) {
                setEntregas([]);
                setCarregando(false);
                return;
            }

            const { data, error } = await supabase
                .from('entregas')
                .select('*')
                .eq('motorista_id', mId)
                .eq('status', 'em_rota')
                .order('ordem_logistica', { ascending: true, nullsFirst: false });

            if (!error && data) {
                // 🔍 VERIFICAÇÃO: Ordem recebida do banco
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                console.log('📱 CELULAR - Dados brutos recebidos do Supabase:');
                console.log('📊 Total de entregas:', data.length);
                console.log('📱 ORDEM RECEBIDA:', data.map(e => e.ordem_logistica));
                console.log('📋 Detalhes completos:', data.map((e, idx) => ({
                    posicao_array: idx,
                    id: e.id,
                    cliente: e.cliente,
                    ordem_logistica: e.ordem_logistica
                })));
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

                // ✅ ORDENAÇÃO GARANTIDA: Mesmo que o Supabase tenha ordenado, forçamos localmente
                // para garantir que qualquer item com ordem null vá para o final
                const listaOrdenada = [...data].sort((a, b) => {
                    const ordemA = a.ordem_logistica != null ? parseInt(a.ordem_logistica, 10) : 9999;
                    const ordemB = b.ordem_logistica != null ? parseInt(b.ordem_logistica, 10) : 9999;
                    return ordemA - ordemB;
                });

                console.log('✅ CELULAR - Lista final ordenada:', listaOrdenada.map((e, idx) => `${idx + 1}. ${e.cliente} (ordem: ${e.ordem_logistica})`));

                // 🔥 ATUALIZAÇÃO FORÇADA: Cria novo array para garantir que React detecte mudança
                // Adiciona timestamp único para cada item forçar re-render se necessário
                const listaComTimestamp = listaOrdenada.map(item => ({
                    ...item,
                    _reactKey: `${item.id}_${item.ordem_logistica}_${Date.now()}`
                }));

                setEntregas(listaComTimestamp);
                setSelectedId(prev => prev || (listaOrdenada.length > 0 ? (listaOrdenada.find(e => e.status === 'em_rota') || listaOrdenada[0]).id : null));

                // 🔔 Força atualização do timestamp global
                setLastUpdateTimestamp(Date.now());
            }
        } catch (err) {
            console.error('[motorista] erro ao carregar rota', err);
        } finally {
            setCarregando(false);
        }
    }

    // Sincronização Inversa: Celular -> Painel (Persistência em Massa Profissional)
    const reordenarEntrega = async (id, direcao) => {
        // 🔥 Encontra o índice na lista ORDENADA, não na lista bruta
        const listaOrdenada = [...entregas].sort((a, b) => {
            const oA = a.ordem_logistica != null ? parseInt(a.ordem_logistica, 10) : 9999;
            const oB = b.ordem_logistica != null ? parseInt(b.ordem_logistica, 10) : 9999;
            return oA - oB;
        });

        const index = listaOrdenada.findIndex(e => e.id === id);
        if (index === -1) return;
        const novoIndex = direcao === 'sobe' ? index - 1 : index + 1;
        if (novoIndex < 0 || novoIndex >= listaOrdenada.length) return;

        const novaLista = [...listaOrdenada];
        [novaLista[index], novaLista[novoIndex]] = [novaLista[novoIndex], novaLista[index]];

        // Garante que TODOS os itens tenham uma ordem sequencial inteira
        const listaSincronizada = novaLista.map((item, idx) => ({
            ...item,
            ordem_logistica: parseInt(idx + 1, 10)
        }));

        // ✅ Atualização otimista no estado local
        setEntregas(listaSincronizada);
        setLastUpdateTimestamp(Date.now());

        // Persistência em Massa: percorre a lista e garante int4 no banco
        try {
            const updates = listaSincronizada.map(item =>
                supabase.from('entregas')
                    .update({ ordem_logistica: item.ordem_logistica })
                    .eq('id', item.id)
            );
            await Promise.all(updates);

            console.log('✅ Ordem atualizada no banco com sucesso');

            // 🔄 Força reload do banco para garantir sincronização
            setTimeout(() => carregarRota(true), 500);

        } catch (e) {
            console.error('Erro na persistência em massa da ordem logistica', e);
            // Reverte mudança local em caso de erro
            carregarRota(true);
        }
    };

    // Função para abrir GPS
    const abrirGPS = (app, lat, lng) => {
        const latN = lat == null ? null : Number(lat);
        const lngN = lng == null ? null : Number(lng);
        if (!Number.isFinite(latN) || !Number.isFinite(lngN)) {
            alert('Coordenadas inválidas para navegação');
            return;
        }
        if (app === 'waze') {
            window.open('https://waze.com/ul?ll=' + latN + ',' + lngN + '&navigate=yes', '_blank');
        } else {
            // Use search query URL which is more appropriate for pinpointing a lat/lng
            window.open('https://www.google.com/maps/search/?api=1&query=' + latN + ',' + lngN, '_blank');
        }
    };

    // Função para Finalizar Entrega
    const finalizarEntrega = async (id) => {
        if (!window.confirm("Confirmar entrega realizada?")) return;

        // IMPORTANTE: Status 'entregue' para o pino ficar verde instantaneamente no Dashboard
        const { error } = await supabase
            .from('entregas')
            .update({ status: 'entregue' })
            .eq('id', id);

        if (!error) {
            // Atualizar lista local
            setEntregas(prev => prev.map(item => item.id === id ? { ...item, status: 'entregue' } : item));
            alert("✅ Entrega confirmada! O pino no dashboard ficará verde agora.");

            // Se for a última entrega, o motorista volta a ficar disponível se desejar
            try {
                if (motorista && motorista.id) {
                    await supabase.from('motoristas').update({ esta_online: true }).eq('id', motorista.id);
                }
            } catch (err) { /* ignore */ }
        } else {
            alert("Erro ao confirmar entrega. Verifique sua conexão.");
        }
    };

    // Função para Reportar Falha (Nova Funcionalidade)
    const reportarFalha = async (id) => {
        const motivo = window.prompt("Qual o motivo da falha? (Ex: Cliente ausente, Endereço não localizado)");
        if (motivo === null) return;
        if (!motivo.trim()) { alert("Informe o motivo."); return; }

        if (!window.confirm("Confirmar FALHA na entrega?")) return;

        // IMPORTANTE: Status 'falha' para o pino ficar vermelho instantaneamente no Dashboard
        const { error } = await supabase
            .from('entregas')
            .update({ status: 'falha', observacoes: motivo })
            .eq('id', id);

        if (!error) {
            setEntregas(prev => prev.map(item => item.id === id ? { ...item, status: 'falha', observacoes: motivo } : item));
            alert("❌ Falha registrada com sucesso. O gestor verá o pino vermelho.");
        } else {
            alert("Erro ao reportar falha: " + error.message);
        }
    };

    // Função de debug: semear uma entrega de teste no localStorage
    function seedEntrega() {
        try {
            const key = 'mock_entregas';
            const raw = localStorage.getItem(key);
            const arr = raw ? JSON.parse(raw) : [];
            const novo = {
                id: Date.now(),
                cliente: 'Cliente Teste',
                endereco: 'Rua Teste, 123',
                lat: -23.55052,
                lng: -46.633308,
                status: 'Em Rota',
                // campo 'msg' removido — não faz parte do schema real
            };
            arr.push(novo);
            localStorage.setItem(key, JSON.stringify(arr));
            // debug: seed gravado (silenciado em produção)
            carregarRota();
        } catch (err) {
            console.error('[motorista] seedEntrega: erro', err);
        }
    }

    // Remove entregas de teste do storage e força recarga
    function clearSeeds() {
        try {
            const key = 'mock_entregas';
            localStorage.removeItem(key);
            // mock_entregas removido (silenciado)
            // Também tenta remover do supabase se estiver usando o mock com API
            try {
                // remove entregas temporárias com status 'Em Rota' sem cliente definido? conservador: não executa delete global
            } catch (e) {
                // ignore
            }
            carregarRota();
        } catch (err) {
            console.error('[motorista] clearSeeds: erro', err);
        }
    }

    // Função para estimar tempo de entrega (simulação: 8 min por parada)
    function estimarTempoEntrega(ordem) {
        if (!ordem) return '8 min';
        return `${ordem * 8} min`;
    }

    // A tarefa atual para exibição no card principal (apenas se estiver em rota)
    const tarefaAtual = selectedId
        ? (entregas.find(e => e.id === selectedId && e.status === 'em_rota') || entregas.find(e => e.status === 'em_rota'))
        : (entregas.find(e => e.status === 'em_rota') || null);

    // Ordena entregas pela propriedade 'ordem_logistica' tratando nulls
    // 🔥 ATUALIZAÇÃO FORÇADA: Inclui lastUpdateTimestamp para garantir re-ordenação
    const orderedRota = useMemo(() => {
        console.log('🔄 [REACT] Recalculando orderedRota...', lastUpdateTimestamp);
        const sorted = [...entregas].sort((a, b) => {
            const oA = a.ordem_logistica != null ? parseInt(a.ordem_logistica, 10) : 9999;
            const oB = b.ordem_logistica != null ? parseInt(b.ordem_logistica, 10) : 9999;
            return oA - oB;
        });
        console.log('✅ [REACT] Ordem final:', sorted.map((e, idx) => `${idx + 1}. ${e.cliente} (ordem: ${e.ordem_logistica})`));
        return sorted;
    }, [entregas, lastUpdateTimestamp]);

    // markers filtered to SC region only
    const markersParaMostrar = (orderedRota || []).filter(e => e && e.lat != null && e.lng != null && isValidSC(e.lat, e.lng));

    const mapRefMobile = useRef(null);

    // Memoize frota to avoid creating a new array on every render and causing map re-renders
    const frotaMemo = useMemo(() => (motorista ? [motorista] : []), [motorista?.id, motorista?.lat, motorista?.lng]);

    // AdvancedMarker removed: map rendering moved to MapaLogistica component

    return (
        <div style={{
            minHeight: '100vh',
            backgroundColor: '#071228',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            display: 'flex',
            flexDirection: 'column',
            maxWidth: '1450px',
            margin: '0 auto',
            borderLeft: '1px solid #ddd',
            borderRight: '1px solid #ddd'
        }}>

            {/* 1. HEADER DO MOTORISTA */}
            <header style={{
                backgroundColor: theme.header,
                padding: '20px',
                color: '#fff',
                borderBottomLeftRadius: '20px',
                borderBottomRightRadius: '20px',
                boxShadow: '0 4px 15px rgba(0,0,0,0.2)',
                zIndex: 10
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{ width: '45px', height: '45px', borderRadius: '50%', backgroundColor: darkMode ? '#444' : '#374151', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', overflow: 'hidden', position: 'relative' }}>
                            <img src={motorista.foto} alt="Foto do motorista" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
                            <div style={{ position: 'absolute', bottom: '-8px', right: '-8px', background: battery.level > 0.2 ? '#10b981' : '#f59e0b', color: '#fff', borderRadius: '8px', padding: '2px 6px', fontSize: '10px', fontWeight: 'bold', boxShadow: '0 2px 6px rgba(0,0,0,0.2)' }}>
                                {Math.round(battery.level * 100)}% {battery.charging ? '⚡' : ''}
                            </div>
                        </div>
                        <div>
                            <h2 style={{ margin: 0, fontSize: '16px' }}>{(motorista && (motorista.nome || motorista.sobrenome)) ? `${(motorista.nome || '').trim()}${motorista.sobrenome ? ' ' + String(motorista.sobrenome).trim() : ''}` : motorista.nome}</h2>
                            <span style={{ fontSize: '12px', color: '#10b981', display: 'flex', alignItems: 'center', gap: '5px' }}>● Online</span>
                        </div>
                        <button onClick={() => setChatOpen(true)} title="Chat rápido com gestor" style={{ marginLeft: '10px', background: theme.primary, color: '#fff', border: 'none', borderRadius: '8px', padding: '6px 12px', fontWeight: 'bold', cursor: 'pointer', fontSize: '14px' }}>💬 Chat</button>
                    </div>
                    {/* MODAL DE CHAT RÁPIDO */}
                    {chatOpen && (
                        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: '#0008', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <div style={{ background: theme.card, borderRadius: '18px', padding: '28px 22px', minWidth: '320px', boxShadow: '0 8px 32px #0004', display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '80vh', overflowY: 'auto' }}>
                                <h3 style={{ margin: 0, color: theme.primary }}>Chat com Gestor</h3>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '8px', maxHeight: '180px', overflowY: 'auto', background: theme.bg, borderRadius: '8px', padding: '8px' }}>
                                    {chatLog.length === 0 && <div style={{ color: theme.textLight, fontSize: '13px' }}>Nenhuma mensagem ainda.</div>}
                                    {chatLog.map((msg, i) => (
                                        <div key={i} style={{ alignSelf: msg.autor === 'Motorista' ? 'flex-end' : 'flex-start', background: msg.autor === 'Motorista' ? theme.primary : theme.secondary, color: '#fff', borderRadius: '8px', padding: '6px 10px', marginBottom: '2px', maxWidth: '80%' }}>
                                            <div style={{ fontSize: '12px', fontWeight: 'bold' }}>{msg.autor}</div>
                                            <div style={{ fontSize: '14px' }}>{msg.texto}</div>
                                            <div style={{ fontSize: '10px', opacity: 0.7, textAlign: 'right' }}>{msg.ts}</div>
                                        </div>
                                    ))}
                                </div>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <input value={chatMsg} onChange={e => setChatMsg(e.target.value)} placeholder="Digite sua mensagem..." style={{ flex: 1, padding: '8px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '14px' }} onKeyDown={e => { if (e.key === 'Enter') enviarMsgGestor(); }} />
                                    <button onClick={enviarMsgGestor} style={{ background: theme.primary, color: '#fff', border: 'none', borderRadius: '8px', padding: '8px 14px', fontWeight: 'bold', cursor: 'pointer', fontSize: '14px' }}>Enviar</button>
                                </div>
                                <button onClick={() => setChatOpen(false)} style={{ marginTop: '8px', background: theme.secondary, color: '#fff', border: 'none', borderRadius: '8px', padding: '6px 12px', fontWeight: 'bold', cursor: 'pointer', fontSize: '13px' }}>Fechar</button>
                            </div>
                        </div>
                    )}
                    <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{entregas.length}</div>
                            <button
                                onClick={carregarRota}
                                disabled={carregando}
                                title="Atualizar rota"
                                style={{
                                    padding: '6px 10px',
                                    borderRadius: '10px',
                                    border: 'none',
                                    background: '#ffffff22',
                                    color: '#fff',
                                    cursor: carregando ? 'wait' : 'pointer'
                                }}
                            >
                                {carregando ? '...' : '⟳'}
                            </button>
                            <button
                                onClick={() => seedEntrega()}
                                title="Semear entrega de teste"
                                style={{
                                    padding: '6px 10px',
                                    borderRadius: '10px',
                                    border: 'none',
                                    background: '#ffffff22',
                                    color: '#fff',
                                    cursor: 'pointer'
                                }}
                            >
                                +
                            </button>
                            <button
                                onClick={() => clearSeeds()}
                                title="Remover entregas de teste"
                                style={{
                                    padding: '6px 10px',
                                    borderRadius: '10px',
                                    border: 'none',
                                    background: '#ffffff22',
                                    color: '#fff',
                                    cursor: 'pointer'
                                }}
                            >
                                🗑️
                            </button>
                        </div>
                        <div style={{ fontSize: '10px', opacity: 0.7 }}>PENDENTES</div>
                    </div>
                </div>
            </header>

            {/* 2. ÁREA PRINCIPAL */}
            <main style={{ flex: 1, padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

                {carregando ? (
                    <div style={{ textAlign: 'center', padding: '40px', color: theme.textLight }}>Buscando rota...</div>
                ) : (
                    <>
                        {!tarefaAtual ? (
                            <div style={{
                                backgroundColor: theme.card,
                                borderRadius: '24px',
                                padding: '25px',
                                textAlign: 'center',
                                boxShadow: '0 10px 30px rgba(0,0,0,0.08)'
                            }}>
                                <div style={{ fontSize: '50px', marginBottom: '10px' }}>🎉</div>
                                <h3 style={{ color: theme.textMain }}>Rota Concluída!</h3>
                                <p style={{ color: theme.textLight }}>O mapa e a lista abaixo continuam visíveis para sua conferência.</p>
                                <button onClick={carregarRota} style={{ marginTop: '10px', padding: '10px 20px', background: theme.primary, border: 'none', borderRadius: '20px', fontWeight: 'bold', color: '#fff', cursor: 'pointer' }}>🔄 Sincronizar Agora</button>
                            </div>
                        ) : (
                            // CARTÃO DA ENTREGA ATUAL (CARD GIGANTE)
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                <div style={{ marginBottom: '10px' }}>
                                    <span style={{ background: theme.header, color: '#fff', padding: '5px 12px', borderRadius: '15px', fontSize: '12px', fontWeight: 'bold' }}>PRÓXIMA PARADA</span>
                                </div>

                                <div style={{
                                    backgroundColor: theme.card,
                                    borderRadius: '24px',
                                    padding: '25px',
                                    boxShadow: '0 10px 30px rgba(0,0,0,0.08)',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '20px'
                                }}>
                                    {/* Tempo estimado para entrega */}
                                    <div style={{ marginBottom: '8px', color: theme.textLight, fontSize: '14px', fontWeight: 'bold' }}>
                                        ⏱️ Tempo estimado: {estimarTempoEntrega(tarefaAtual.ordem_logistica || 1)}
                                    </div>
                                    {/* Dados do Cliente */}
                                    <div>
                                        <h1 style={{ margin: '0 0 5px 0', color: theme.textMain, fontSize: '22px' }}>{tarefaAtual.cliente}</h1>
                                        <p style={{ margin: 0, color: theme.textLight, fontSize: '16px', lineHeight: '1.4' }}>📍 {tarefaAtual.endereco}</p>
                                    </div>

                                    {/* Recado/Obs removido (campo 'msg' não existe) */}

                                    {/* BOTÕES DE NAVEGAÇÃO (GPS) */}
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                                        <button
                                            onClick={() => abrirGPS('waze', tarefaAtual.lat, tarefaAtual.lng)}
                                            style={{ padding: '15px', borderRadius: '15px', border: 'none', background: '#3b82f6', color: '#fff', fontWeight: 'bold', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                                        >
                                            🚙 WAZE
                                        </button>
                                        <button
                                            onClick={() => abrirGPS('maps', tarefaAtual.lat, tarefaAtual.lng)}
                                            style={{ padding: '15px', borderRadius: '15px', border: 'none', background: '#34a853', color: '#fff', fontWeight: 'bold', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                                        >
                                            🗺️ MAPS
                                        </button>
                                    </div>

                                    <hr style={{ border: 'none', borderTop: '1px solid #f3f4f6', margin: '5px 0' }} />

                                    {/* BOTÃO DE FINALIZAR */}
                                    <button
                                        onClick={() => finalizarEntrega(tarefaAtual.id)}
                                        style={{
                                            width: '100%',
                                            padding: '20px',
                                            borderRadius: '18px',
                                            border: 'none',
                                            background: theme.secondary,
                                            color: '#fff',
                                            fontWeight: '800',
                                            fontSize: '18px',
                                            cursor: 'pointer',
                                            borderLeft: darkMode ? '1px solid #222' : '1px solid #ddd',
                                            borderRight: darkMode ? '1px solid #222' : '1px solid #ddd',
                                            transition: 'background 0.3s',
                                            marginBottom: '10px'
                                        }}
                                    >
                                        ✅ FINALIZAR ENTREGA
                                    </button>

                                    {/* BOTÃO DE FALHA */}
                                    <button
                                        onClick={() => reportarFalha(tarefaAtual.id)}
                                        style={{
                                            width: '100%',
                                            padding: '15px',
                                            borderRadius: '18px',
                                            border: 'none',
                                            background: '#ef4444', // Vermelho alerta
                                            color: '#fff',
                                            fontWeight: '700',
                                            fontSize: '16px',
                                            cursor: 'pointer',
                                            borderLeft: darkMode ? '1px solid #222' : '1px solid #ddd',
                                            borderRight: darkMode ? '1px solid #222' : '1px solid #ddd',
                                            transition: 'background 0.3s'
                                        }}
                                    >
                                        ❌ FALHA / NÃO ENTREGUE
                                    </button>
                                </div>
                            </div>
                        )}
                    </>
                )}

                {/* MAPA COM BADGES NUMERADOS (agora isolado em MapaLogistica) */}
                <div style={{ background: '#fff', borderRadius: '12px', padding: '10px', boxShadow: '0 6px 18px rgba(0,0,0,0.06)' }}>
                    <h4 style={{ margin: '8px 0 10px 8px', color: theme.textMain }}>Mapa da Rota</h4>
                    <div style={{ borderRadius: '8px', overflow: 'hidden' }}>
                        {/* Mobile-first: altura fixa 250px em mobile */}
                        {/* 🔥 USA orderedRota para garantir ordem correta */}
                        <MapaLogistica entregas={orderedRota} frota={frotaMemo} mobile={true} />
                        <button onClick={() => setDarkMode(m => !m)} title="Alternar modo" style={{ padding: '6px 10px', borderRadius: '10px', border: 'none', background: darkMode ? '#222' : '#eee', color: darkMode ? '#fff' : '#222', cursor: 'pointer', fontWeight: 'bold' }}>{darkMode ? '🌙' : '☀️'}</button>
                    </div>
                </div>

                {/* LISTA DE ENTREGAS (SELECIONÁVEL) */}
                <div style={{ marginTop: '10px' }}>
                    <h4 style={{ margin: '0 0 15px 10px', color: theme.textLight, fontSize: '12px', letterSpacing: '1px' }}>ROTAS DISPONÍVEIS ({orderedRota.length})</h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '220px', overflowY: 'auto', paddingRight: '8px' }}>
                        {/* 🔥 USA orderedRota ao invés de entregas para garantir ordem */}
                        {orderedRota.map((task, taskIndex) => {
                            const isSelected = tarefaAtual && tarefaAtual.id === task.id;
                            return (
                                <button
                                    key={task.id} // Chave de Identificação Única (ID) para estabilizar o React
                                    onClick={() => setSelectedId(task.id)}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        padding: '12px 14px',
                                        borderRadius: '12px',
                                        border: isSelected ? `2px solid ${theme.primary}` : '1px solid #edf2f7',
                                        background: isSelected ? '#eef2ff' : '#fff',
                                        cursor: 'pointer',
                                        textAlign: 'left'
                                    }}
                                >
                                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                        {/* Visual da Ordem Oficial */}
                                        <div style={{ fontWeight: 'bold', color: isSelected ? theme.primary : '#9ca3af', fontSize: '18px', minWidth: '24px' }}>
                                            {task.ordem_logistica || '-'}
                                        </div>
                                        <div>
                                            <div style={{ fontWeight: '700' }}>{task.cliente}</div>
                                            <div style={{ fontSize: '12px', color: theme.textLight }}>{task.endereco.substring(0, 40)}</div>
                                            <div style={{ fontSize: '11px', color: theme.textLight, marginTop: '2px' }}>⏱️ {estimarTempoEntrega(task.ordem_logistica)}</div>
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                        <div onClick={(e) => { e.stopPropagation(); reordenarEntrega(task.id, 'sobe'); }} style={{ padding: '4px', background: '#f0f0f0', borderRadius: '4px', textAlign: 'center' }}>▲</div>
                                        <div onClick={(e) => { e.stopPropagation(); reordenarEntrega(task.id, 'desce'); }} style={{ padding: '4px', background: '#f0f0f0', borderRadius: '4px', textAlign: 'center' }}>▼</div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>

            </main>
        </div>
    );
}

export default function App() { return <InternalMobileApp />; }