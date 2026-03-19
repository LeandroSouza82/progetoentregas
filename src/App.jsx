import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import supabase, { subscribeToTable } from './supabaseClient';
import polyline from 'polyline';
import MapaLogistica from './MapaLogistica';
import { nearestNeighborRoute, getRouteGeometry, obterCoordenadasSeguras, montarQueryMapbox, buscarCoordenadas } from './geoUtils';
import ErrorBoundary from './ErrorBoundary.jsx';

// Safety: enable Supabase-backed flows during local debugging
const HAS_SUPABASE_CREDENTIALS = true;

// Paletas de cores
const lightTheme = {
    headerBg: '#0f172a',
    headerText: '#f8fafc',
    bg: '#f1f5f9',
    card: '#ffffff',
    primary: '#4f46e5',
    accent: '#0ea5e9',
    success: '#10b981',
    danger: '#ef4444',
    textMain: '#334155',
    textLight: '#94a3b8',
    shadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)'
};

const darkTheme = {
    headerBg: '#071028',
    headerText: '#e6eef8',
    bg: '#071228',
    card: '#0b1220',
    primary: '#60a5fa',
    accent: '#38bdf8',
    success: '#34d399',
    danger: '#f87171',
    textMain: '#cbd5e1',
    textLight: '#94a3b8',
    shadow: '0 6px 18px rgba(0,0,0,0.6)'
};

// Função utilitária: gera e baixa CSV compatível com Excel BR (ponto-e-vírgula + BOM)
export const baixarRelatorioCSV = (entregas) => {
    const cabecalhos = [
        "ID da Ordem",
        "Cliente",
        "Endereço Completo",
        "Tipo de Serviço",
        "Status",
        "Data",
        "Horário",
        "Recebedor",
        "Motivo (Se não entregue)",
        "Observações"
    ];

    const linhas = (Array.isArray(entregas) ? entregas : []).map(entrega => {
        let dataFormatada = "";
        let horarioFormatado = "";
        const dataBruta = entrega.data_entrega || entrega.created_at;
        if (dataBruta) {
            const dataObj = new Date(dataBruta);
            if (!isNaN(dataObj.getTime())) {
                dataFormatada = dataObj.toLocaleDateString('pt-BR');
                horarioFormatado = dataObj.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            }
        }

        const dadosLinha = [
            entrega.id || "",
            entrega.cliente || "",
            entrega.endereco || "",
            entrega.tipo || "",
            entrega.status || "",
            dataFormatada,
            horarioFormatado,
            entrega.recebedor || "",
            entrega.motivo || "",
            entrega.obs || ""
        ];

        // Retorna a linha CSV, escapando campos com aspas duplas
        return dadosLinha.map(campo => {
            const val = String(campo || '').replace(/"/g, '""');
            return `"${val}"`;
        }).join(';');
    });

    // Monta o CSV final (BOM + cabeçalho + linhas)
    const csv = '\uFEFF' + [cabecalhos.join(';'), ...linhas].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `relatorio_entregas_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100);
}

async function otimizarRotaComGoogle(pontoPartida, listaEntregas, motoristaId = null) {
    const remaining = (listaEntregas || []).filter(p => {
        try { return String(p.status || '').trim().toLowerCase() === 'pendente' || String(p.status || '').trim().toLowerCase() === 'em_rota'; } catch (e) { return false; }
    });
    if (!remaining || remaining.length === 0) return [];

    let originLatLng = null;
    try {
        if (motoristaId != null) {
            try {
                const { data: mdata } = await supabase.from('motoristas').select('lat,lng,esta_online').eq('id', motoristaId);
                const m = (mdata && mdata[0]) ? mdata[0] : null;
                if (m && typeof m.esta_online !== 'undefined' && m.esta_online !== true) {
                    return remaining;
                }
                if (m && m.lat != null && m.lng != null) originLatLng = { lat: Number(m.lat), lng: Number(m.lng) };
            } catch (e) { /* fallback below */ }
            if (!originLatLng) {
                try {
                    const { data: lastDone } = await supabase.from('entregas').select('lat,lng').eq('motorista_id', String(motoristaId)).eq('status', 'concluido').order('id', { ascending: false });
                    if (lastDone && lastDone.length > 0 && lastDone[0].lat != null && lastDone[0].lng != null) originLatLng = { lat: Number(lastDone[0].lat), lng: Number(lastDone[0].lng) };
                } catch (e) { /* ignore */ }
            }
        }
    } catch (e) {
        console.warn('otimizarRotaComGoogle (fallback): erro obtendo origem', e);
    }

    if (!originLatLng) {
        if (pontoPartida && typeof pontoPartida === 'object' && 'lat' in pontoPartida && 'lng' in pontoPartida) {
            originLatLng = { lat: Number(pontoPartida.lat), lng: Number(pontoPartida.lng) };
        } else if (Array.isArray(pontoPartida) && pontoPartida.length >= 2) {
            originLatLng = { lat: Number(pontoPartida[0]), lng: Number(pontoPartida[1]) };
        }
    }

    // Fallback simples: se não houver origem específica, retorna a lista sem otimização
    return remaining;
}
// mapa dinamicamente importado para prevenir que falhas no build do pacote quebrem o app
function App() {
    const [rotaPronta, setRotaPronta] = useState(false);
    const [rotaOrdenadaState, setRotaOrdenadaState] = useState([]);

    // NOTE: modal-driven motorista selection was removed in favor of an inline `<select>`.

    // NOTE: one-click dispatch function removed — flow now: reorganizar -> selecionar motorista -> enviar rota
    const [mapsLib, setMapsLib] = useState(null);
    const [mapsLoadError, setMapsLoadError] = useState(false);
    const [loadingFrota, setLoadingFrota] = useState(false);
    const [darkMode, setDarkMode] = useState(true);
    const theme = darkMode ? darkTheme : lightTheme;
    const [abaAtiva, setAbaAtiva] = useState('Visão Geral'); // Mudei o nome pra ficar chique
    // Localização do gestor removida do dashboard: não solicitamos GPS aqui

    // Google-related quota/banners disabled — keep a ref stub for legacy checks
    const googleQuotaExceededRef = useRef(false);
    function markGoogleQuotaExceeded(source, customMessage) {
        googleQuotaExceededRef.current = true;
    }

    // Componente isolado para a tela de aprovação do motorista
    function TelaAprovacaoMotorista() {
        const [state, setState] = useState({ status: 'loading', message: 'Processando ativação...' });

        useEffect(() => {
            (async () => {
                try {
                    if (typeof window === 'undefined') return;
                    const params = new URLSearchParams(window.location.search);
                    const id = params.get('id');
                    if (!id) {
                        setState({ status: 'error', message: 'Link inválido. ID ausente.' });
                        return;
                    }

                    // ATENÇÃO: não alteramos o banco por aqui.
                    // O processo de aprovação é manual e ocorre quando o gestor clica em "APROVAR" no Dashboard.
                    setState({ status: 'success', message: 'PEDIDO RECEBIDO' });

                    // Evitar re-execução no reload
                    try { window.history.replaceState({}, document.title, '/aprovar?processed=1'); } catch (e) { /* ignore */ }
                } catch (e) {
                    setState({ status: 'error', message: 'Erro ao processar link.' });
                }
            })();
            // run on mount only
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, []);

        return (
            <div style={{ minHeight: '100vh', width: '100vw', backgroundColor: '#071228', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', boxSizing: 'border-box', fontFamily: "'Inter', sans-serif" }}>
                <div style={{ textAlign: 'center', maxWidth: '720px' }}>
                    <div style={{ fontWeight: 900, fontSize: '22px', marginBottom: '10px', background: 'linear-gradient(to right, #3B82F6, #FFFFFF)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>V10 DASHBOARD</div>
                    <div style={{ fontSize: '64px', margin: '18px 0', color: '#10b981' }}>✅</div>
                    <div style={{ fontSize: '20px', fontWeight: 800, marginBottom: '8px' }}>{state.message}</div>
                    <p style={{ color: '#cbd5e1', marginBottom: '24px' }}>Seu pedido foi recebido. Aguarde que o gestor valide seu perfil via WhatsApp. Para validar mais rápido, responda com 'OK' à mensagem do gestor. A aprovação só é concluída quando o gestor clicar em APROVAR no Dashboard.</p>
                    <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                        <button onClick={() => { window.location.href = '/motorista'; }} style={{ padding: '14px 20px', borderRadius: '10px', border: 'none', background: '#10b981', color: '#000', cursor: 'pointer', fontWeight: 800 }}>ABRIR APLICATIVO V10</button>
                        <button onClick={() => { window.location.href = '/'; }} style={{ padding: '14px 20px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.06)', background: 'transparent', color: '#fff', cursor: 'pointer', fontWeight: 700 }}>VOLTAR AO SITE</button>
                    </div>
                </div>
            </div>
        );
    }

    // Estados do Supabase
    const [entregas, setEntregas] = useState([]);
    const [pedidosPendentes, setPedidosPendentes] = useState([]);
    const [cardCopiado, setCardCopiado] = useState(null);
    const [toastCopiarTudo, setToastCopiarTudo] = useState(false);
    // compat shim: estado para seleções de vagas (se o projeto usar esse nome em outros trechos)
    const [vagasSelecionadas, setVagasSelecionadas] = useState([]);
    // estado para controles de marcadores do mapa (visibilidade separada dos cards)
    const [entregaMarkers, setEntregaMarkers] = useState([]);
    // helper leve para 'setEntregasMap' — alguns trechos externos chamam esse setter nomeado.
    const setEntregasMap = (arr) => {
        try { setEntregas(Array.isArray(arr) ? arr : []); } catch (e) { /* ignore */ }
    };
    // prepare subset to display on map (only pending or em_rota)
    const entregasParaMapa = useMemo(() => {
        try {
            return (entregas || []).filter(e => {
                const s = String(e.status || '').trim().toLowerCase();
                return s === 'pendente' || s === 'em_rota';
            });
        } catch (e) {
            return [];
        }
    }, [entregas]);
    const [frota, setFrota] = useState([]); // agora vem de `motoristas`
    const [totalEntregas, setTotalEntregas] = useState(0);
    const [avisos, setAvisos] = useState([]);
    const [rotaAtiva, setRotaAtiva] = useState([]);
    const [motoristaDaRota, setMotoristaDaRota] = useState(null);
    const [motoristaCidade, setMotoristaCidade] = useState(null);
    const cidadeCacheRef = useRef(new Map());

    // Estilos reutilizáveis básicos para inputs e botões
    const inputStyle = {
        width: '100%',
        padding: '12px',
        borderRadius: '8px',
        border: 'none',
        marginBottom: '15px',
        backgroundColor: '#fff',
        color: '#000',
        fontSize: '16px',
        boxSizing: 'border-box',
        display: 'block'
    };
    const btnStyle = (bg) => ({ padding: '10px 14px', borderRadius: '6px', border: 'none', background: bg || '#4f46e5', color: '#fff', fontWeight: '700', cursor: 'pointer' });
    // Controle visual: flag para quando o mapa foi limpo por ação do usuário
    const [mapCleared, setMapCleared] = useState(false);

    // Atualiza o estado `entregas` garantindo ordenação por `ordem_logistica`.
    const carregarDados = React.useCallback(async () => {
        console.log("🔄 [Sincronização Inteligente] Organizando Cards e Mapa...");
        try {
            // 1. Busca entregas ativas E finalizadas do turno (para histórico visual do mapa)
            // 'arquivado' é excluído — só some do mapa após o botão "Limpar Mapa" ser clicado
            const STATUS_MAPA = ['adicionado', 'pendente', 'em_rota', 'sucesso', 'concluido', 'falha'];
            const { data, error } = await supabase
                .from('entregas')
                .select('*')
                .in('status', STATUS_MAPA);

            if (error) throw error;

            const todasAsEntregas = data || [];

            // 🎯 LÓGICA 1: Cards da Central -> apenas 'pendente' e 'adicionado' (em_rota já saiu da Central)
            const statusCentral = ['adicionado', 'pendente'];
            const pendentes = todasAsEntregas.filter(item => item && statusCentral.includes(String(item.status || '').trim().toLowerCase()));
            try { if (typeof setEntregasMap === 'function') setEntregasMap(pendentes); } catch (e) { }
            setPedidosPendentes(pendentes);

            // 🎯 LÓGICA 2: Pinos do Mapa -> apenas ativas (sem histórico de concluídas)
            try { setEntregaMarkers(Array.isArray(todasAsEntregas) ? todasAsEntregas : []); } catch (e) { }

            console.log(`✅ Central: ${pendentes.length} | Mapa: ${(todasAsEntregas || []).length}`);
        } catch (e) {
            console.error("Erro na sincronização de visibilidade:", e);
        }
    }, []);
    // <-- Properly close carregarDados function here

    // Simples função para recarregar apenas os pins (mais leve que carregarDados)
    const carregarPins = useCallback(async () => {
        try {
            if (!HAS_SUPABASE_CREDENTIALS) return;
            // Only log when not already fetching to reduce noise
            if (!fetchInProgressRef.current) console.log('🔄 Recarregando pins do banco...');
            const { data, error } = await supabase
                .from('entregas')
                .select('*')
                .in('status', ['adicionado', 'pendente', 'em_rota'])
                .order('ordem_logistica', { ascending: true });
            if (error) {
                console.warn('carregarPins: erro ao buscar entregas', error);
                return;
            }
            const list = Array.isArray(data) ? data : [];
            const formatados = (list || []).map(item => ({
                ...item,
                lat: Number(item && (item.lat ?? item.latitude) || 0),
                lng: Number(item && (item.lng ?? item.longitude ?? item.long) || 0),
                status: item && item.status ? item.status : 'pendente'
            })).filter(item => Number.isFinite(item.lat) && Number.isFinite(item.lng));
            try {
                const hash = JSON.stringify((formatados || []).map(i => `${i.id}:${i.lat},${i.lng}`));
                if (hash !== lastEntregasHashRef.current) {
                    lastEntregasHashRef.current = hash;
                    if (typeof atualizarEntregasOrdenadas === 'function') {
                        atualizarEntregasOrdenadas(formatados);
                    } else {
                        console.log('Ordem atualizada');
                    }
                    // Atualiza entregas exibidas no mapa com apenas pendentes
                    try { if (typeof setEntregasMap === 'function') setEntregasMap(formatados); } catch (e) { /* ignore */ }
                    setPedidosPendentes(formatados.filter(item => ['adicionado', 'pendente'].includes(String(item.status || '').toLowerCase())));
                }
            } catch (e) {
                if (typeof atualizarEntregasOrdenadas === 'function') {
                    atualizarEntregasOrdenadas(formatados);
                } else {
                    console.log('Ordem atualizada');
                }
                try { if (typeof setEntregasMap === 'function') setEntregasMap(formatados); } catch (e) { /* ignore */ }
                setPedidosPendentes(formatados.filter(item => ['adicionado', 'pendente'].includes(String(item.status || '').toLowerCase())));
            }
        } catch (e) {
            console.warn('carregarPins: exceção', e);
        }
    }, []);

    // UseEffect para recarregar pins inicialmente (polling 60s removido)
    useEffect(() => {
        let isMounted = true;

        const initialLoad = async () => {
            if (isMounted) {
                await carregarPins();
            }
        };

        initialLoad();

        // Polling periódico removido para evitar recarregamentos desnecessários
        return () => {
            isMounted = false;
        };
    }, [carregarPins]);

    // Escuta realtime para mudanças na tabela `entregas` e carregamento inicial
    useEffect(() => {
        // 1. Carrega os dados iniciais
        carregarDados();

        // 2. CONFIGURA O TEMPO REAL (REALTIME)
        const canalEntregas = supabase
            .channel('alteracoes_entregas') // Nome qualquer para o canal
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'entregas' }, payload => {
                console.log('🔄 Update em tempo real:', payload.new);

                setEntregas(listaAtual => {
                    // Se a lista atual sumiu, usamos o novo item como início, mas nunca null
                    if (!listaAtual) return [payload.new];

                    // Mapeamos a lista existente. Se o ID bater, atualizamos os dados.
                    // Se não bater, mantemos o que já estava lá. Isso preserva os outros pinos.
                    return listaAtual.map(item =>
                        item.id === payload.new.id ? { ...item, ...payload.new } : item
                    );
                });
            })
            .subscribe();

        // Limpa a escuta quando fechar a tela
        return () => {
            try { supabase.removeChannel(canalEntregas); } catch (e) { /* ignore */ }
        };
    }, [carregarDados]);

    async function limparMarcadores() {
        // Prompt first and bail early if cancelled
        const ok = window.confirm('Deseja remover as entregas concluídas e falhas do mapa?');
        if (!ok) return;

        try {
            // Update banco: arquivar apenas linhas que estiverem entregues ou com falha
            if (HAS_SUPABASE_CREDENTIALS) {
                const { data, error } = await supabase
                    .from('entregas')
                    .update({ status: 'arquivado' })
                    .in('status', ['entregue', 'sucesso', 'concluido', 'falha']);
                if (error) {
                    console.warn('limparMarcadores: falha no update', error);
                }
            }
            // refresh local data so dashboard fetches latest state
            try { await carregarDados(); } catch (err) { console.warn('limparMarcadores: falha ao recarregar mapa', err); }
        } catch (e) {
            console.warn('limparMarcadores: exceção ao atualizar banco', e);
        }

        // Remove itens do estado local, o map atualizará automaticamente
        atualizarEntregasOrdenadas(prev => (prev || []).filter(item => {
            try {
                const s = String(item && item.status || '').trim().toLowerCase();
                return s !== 'concluido' && s !== 'sucesso' && s !== 'falha' && s !== 'entregue';
            } catch (err) {
                return true;
            }
        }));
        setPedidosPendentes(prev => (prev || []).filter(item => {
            try {
                const s = String(item && item.status || '').trim().toLowerCase();
                return s !== 'concluido' && s !== 'sucesso' && s !== 'falha' && s !== 'entregue';
            } catch (err) {
                return true;
            }
        }));

        try {
            alert('Entregas finalizadas foram arquivadas com sucesso');
        } catch (e) { }
    };

    async function recarregarMapa() {
        try {
            // Reset any visual clear flag and force data reload
            setMapCleared(false);
            await carregarDados();
        } catch (e) { console.warn('recarregarMapa failed', e); }
    };

    // Draft preview state: optimized preview order (no draft point)
    const [draftPreview, setDraftPreview] = useState([]);
    const draftPolylineRef = useRef(null);
    const draftOptimizeTimerRef = useRef(null);
    const lastDraftHashRef = useRef(null);
    const inputIdleRef = useRef(true);
    const inputIdleTimerRef = useRef(null);
    const pendingRecalcRef = useRef(new Set());
    const [pendingRecalcCount, setPendingRecalcCount] = useState(0);

    const [runtimePolylines, setRuntimePolylines] = useState({});
    const [dataRotaCoordenadas, setDataRotaCoordenadas] = useState([]);

    const rotaCoordenadas = React.useMemo(() => {
        try {
            // Prioridade: rota gerada a partir dos dados carregados
            if (dataRotaCoordenadas && Array.isArray(dataRotaCoordenadas) && dataRotaCoordenadas.length > 0) return dataRotaCoordenadas;
            if (!runtimePolylines) return [];
            if (Array.isArray(runtimePolylines)) return runtimePolylines[0] || [];
            const vals = Object.values(runtimePolylines || {});
            return Array.isArray(vals) && vals.length > 0 ? vals[0] : [];
        } catch (e) { return []; }
    }, [runtimePolylines, dataRotaCoordenadas]);


    // Distance and driver-select mode state
    const [estimatedDistanceKm, setEstimatedDistanceKm] = useState(null);
    const [estimatedTimeSec, setEstimatedTimeSec] = useState(null);
    const [estimatedTimeText, setEstimatedTimeText] = useState(null);
    const [distanceCalculating, setDistanceCalculating] = useState(false);
    const queueCalcTimerRef = useRef(null);
    const lastQueueHashRef = useRef('');
    const [driverSelectMode, setDriverSelectMode] = useState('dispatch'); // 'dispatch' | 'reopt'
    const [logsHistory, setLogsHistory] = useState([]);
    const [showLogsPopover, setShowLogsPopover] = useState(false);

    // Helpers: Haversine formula (returns km)
    function haversineKm(a, b) {
        const toRad = (deg) => deg * Math.PI / 180;
        const R = 6371; // Earth radius in km
        const dLat = toRad(Number(b.lat) - Number(a.lat));
        const dLon = toRad(Number(b.lng) - Number(a.lng));
        const lat1 = toRad(Number(a.lat));
        const lat2 = toRad(Number(b.lat));
        const sinHalf = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(sinHalf), Math.sqrt(1 - sinHalf));
        return R * c;
    }

    function computeRouteDistanceKm(origin, list = [], base = null) {
        try {
            const pts = [];
            if (origin && origin.lat != null && origin.lng != null) pts.push({ lat: Number(origin.lat), lng: Number(origin.lng) });
            (list || []).forEach(p => { if (p && p.lat != null && p.lng != null) pts.push({ lat: Number(p.lat), lng: Number(p.lng) }); });
            if (base && base.lat != null && base.lng != null) pts.push({ lat: Number(base.lat), lng: Number(base.lng) });
            if (pts.length < 2) return 0;
            let sum = 0;
            for (let i = 1; i < pts.length; i++) sum += haversineKm(pts[i - 1], pts[i]);
            return sum; // in km
        } catch (e) { return 0; }
    }

    /**
     * otimizarRotaVizinhoProximo
     * Isolated helper: greedy Nearest-Neighbor route ordering using Haversine distance.
     * - Does NOT perform network calls; expects `origin` to be provided (driver GPS if available).
     * - Filters input `lista` to only consider deliveries with coords and status 'pendente'|'em_rota'.
     * - Returns an ordered array (nearest neighbor sequence) and does not mutate input.
     *
     * Params:
     *  - origin: { lat, lng } starting point for the algorithm
     *  - lista: array of objects containing at least { lat, lng, status }
     *  - options: { maxPoints: number | null } optional cap for very large sets
     */
    function otimizarRotaVizinhoProximo(origin, lista = [], options = {}) {
        try {
            const maxPoints = options && Number.isFinite(Number(options.maxPoints)) ? Number(options.maxPoints) : null;

            const allowed = (p) => {
                try { const s = String(p.status || '').trim().toLowerCase(); return s === 'pendente' || s === 'em_rota'; } catch (e) { return false; }
            };

            const pts = (lista || []).filter(p => p && p.lat != null && p.lng != null && allowed(p)).map(p => ({ ...p, lat: Number(p.lat), lng: Number(p.lng) }));
            if (!pts.length) return [];

            let cur = null;
            if (origin && origin.lat != null && origin.lng != null) cur = { lat: Number(origin.lat), lng: Number(origin.lng) };
            else cur = { lat: pts[0].lat, lng: pts[0].lng };

            const ordered = [];
            const pool = pts.slice();

            while (pool.length) {
                let bestIdx = 0;
                let bestDist = Infinity;
                for (let i = 0; i < pool.length; i++) {
                    try {
                        const d = haversineKm(cur, pool[i]);
                        if (d < bestDist) { bestDist = d; bestIdx = i; }
                    } catch (e) { /* skip invalid point */ }
                }
                const next = pool.splice(bestIdx, 1)[0];
                ordered.push(next);
                cur = { lat: Number(next.lat), lng: Number(next.lng) };
                if (maxPoints != null && ordered.length >= maxPoints) break;
            }

            return ordered;
        } catch (e) {
            console.warn('otimizarRotaVizinhoProximo: erro', e);
            return [];
        }
    }

    function formatDuration(sec) {
        try {
            if (!sec || sec <= 0) return '';
            const minutes = Math.round(sec / 60);
            if (minutes < 60) return `${minutes} min`;
            const h = Math.floor(minutes / 60);
            const m = minutes % 60;
            return `${h}h ${m}m`;
        } catch (e) { return ''; }
    }

    // Ensure human readable time text updates when seconds change
    useEffect(() => {
        try {
            if (!estimatedTimeSec || estimatedTimeSec <= 0) {
                setEstimatedTimeText(null);
                return;
            }
            setEstimatedTimeText(formatDuration(estimatedTimeSec));
        } catch (e) { /* ignore */ }
    }, [estimatedTimeSec]);

    // Helper: aplica atualizações locais no estado `entregas` para refletir mudanças no banco imediatamente
    function applyLocalEntregasUpdates(updates = []) {
        try {
            if (!Array.isArray(updates) || updates.length === 0) return;
            const byId = new Map((updates || []).map(u => [String(u.id), u]));
            atualizarEntregasOrdenadas(prev => (prev || []).map(ent => {
                const u = byId.get(String(ent.id));
                if (!u) return ent;
                // mescla campos atualizados (status, ordem_logistica, motorista_id, etc.)
                return { ...ent, ...u };
            }));
        } catch (e) { /* ignore local update failures */ }
    }
    const [observacoesGestor, setObservacoesGestor] = useState('');
    const [dispatchLoading, setDispatchLoading] = useState(false);
    const [isCalculating, setIsCalculating] = useState(false); // para Reorganizar
    const [isSending, setIsSending] = useState(false); // para Enviar
    const [driverReadyToSend, setDriverReadyToSend] = useState(null); // motorista com rota calculada
    const [podeEnviar, setPodeEnviar] = useState(false);
    const [motoristaSelecionadoId, setMotoristaSelecionadoId] = useState(null);
    const [mensagemGeral, setMensagemGeral] = useState('');
    const [enviandoGeral, setEnviandoGeral] = useState(false);
    const [btnPressed, setBtnPressed] = useState(false);
    // Configurar WhatsApp do Gestor (v159)
    const [showGestorModal, setShowGestorModal] = useState(false);
    const [gestorPhoneInput, setGestorPhoneInput] = useState('');
    const [gestorPhoneLoading, setGestorPhoneLoading] = useState(false);
    const [gestorPhoneMessage, setGestorPhoneMessage] = useState('');
    const [showBackupModal, setShowBackupModal] = useState(false);
    const [backupLoading, setBackupLoading] = useState(false);
    const [deletingDb, setDeletingDb] = useState(false);
    const [deleteResultMessage, setDeleteResultMessage] = useState('');
    const [adicionando, setAdicionando] = useState(false);
    const [duplicateTipoMsg, setDuplicateTipoMsg] = useState('');
    const clienteInputRef = useRef(null);
    const [destinatario, setDestinatario] = useState('all');
    const [nomeCliente, setNomeCliente] = useState('');
    const [tipoEncomenda, setTipoEncomenda] = useState('Entrega');
    const [enderecoEntrega, setEnderecoEntrega] = useState('');
    const [enderecoGeocodeNotFound, setEnderecoGeocodeNotFound] = useState(false);
    const [inputEnderecoInvalid, setInputEnderecoInvalid] = useState(false);

    const [historySuggestions, setHistorySuggestions] = useState([]);

    // Carrega o número salvo no banco para edição
    async function loadGestorPhone() {
        try {
            if (!HAS_SUPABASE_CREDENTIALS) return;
            const { data, error } = await supabase.from('configuracoes').select('valor').eq('chave', 'gestor_phone').limit(1);
            if (!error && Array.isArray(data) && data.length > 0) {
                setGestorPhoneInput(String(data[0].valor || ''));
            } else {
                setGestorPhoneInput('');
            }
        } catch (e) {
            console.warn('loadGestorPhone error', e);
            setGestorPhoneInput('');
        }
    }

    // Salva / upsert do número na tabela configuracoes
    async function saveGestorPhone() {
        try {
            if (!HAS_SUPABASE_CREDENTIALS) return alert('Chaves Supabase ausentes. Não é possível salvar.');
            const val = String(gestorPhoneInput || '').trim();
            if (!val) return alert('Digite um número válido.');
            setGestorPhoneLoading(true);
            const payload = [{ chave: 'gestor_phone', valor: val }];
            const { data, error } = await supabase.from('configuracoes').upsert(payload, { returning: 'minimal' });
            if (error) throw error;
            setGestorPhoneMessage('✅ Número atualizado! Todos os motoristas agora enviarão notificações para este contato.');
            setTimeout(() => setGestorPhoneMessage(''), 4000);
            setShowGestorModal(false);
        } catch (e) {
            console.error('saveGestorPhone error', e);
            try { alert('Falha ao salvar: ' + (e && e.message ? e.message : String(e))); } catch (err) { }
        } finally {
            setGestorPhoneLoading(false);
        }
    }



    // Duplicate detection (address + tipo) — v101: block same-service duplicates for same endereco
    useEffect(() => {
        try {
            const enderecoTrim = String(enderecoEntrega || '').trim();
            if (!enderecoTrim) {
                setDuplicateTipoMsg('');
                return;
            }
            const normalize = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
            const addrNorm = normalize(enderecoTrim);
            const pendingMatches = (entregas || []).filter(e => e && String(e.status || '').toLowerCase() === 'pendente' && e.endereco && normalize(e.endereco) === addrNorm);
            if (!pendingMatches || pendingMatches.length === 0) {
                setDuplicateTipoMsg('');
                return;
            }
            const selectedTipo = String(tipoEncomenda || 'Entrega').trim();
            const sameTipoExists = pendingMatches.some(p => String(p.tipo || 'Entrega').trim().toLowerCase() === selectedTipo.toLowerCase());
            if (sameTipoExists) {
                setDuplicateTipoMsg(`⚠️ Já existe uma ${selectedTipo} pendente para este endereço. Caso seja um novo serviço, altere o Tipo (ex: Recolha).`);
            } else {
                setDuplicateTipoMsg('');
            }
        } catch (e) { /* ignore */ }
    }, [enderecoEntrega, tipoEncomenda, entregas]);

    // Sem SearchBox: o campo de endereço é um input simples controlado por enderecoEntrega

    // Queue calculations removed (emergency reset) — heavy route computations disabled to prevent UI freezes
    // (previously calculated estimatedDistanceKm / estimatedTimeSec from entregasEmEspera)
    // noop to keep variables available
    useEffect(() => { /* queue calc disabled in emergency reset */ }, []);
    // cleanup on unmount
    useEffect(() => {
        return () => { if (queueCalcTimerRef.current) clearTimeout(queueCalcTimerRef.current); };
    }); // <-- Properly close useEffect here

    // Google Maps integration removed for this project — we rely on Leaflet/Mapbox.
    const [recentList, setRecentList] = useState(() => {
        try {
            const historicoSalvo = localStorage.getItem('meu_historico_clientes_csv');
            if (historicoSalvo) {
                return JSON.parse(historicoSalvo);
            }
        } catch (error) {
            console.error('Erro ao ler histórico do localStorage', error);
        }
        return [];
    });

    // Vigia: Salva no localStorage toda vez que o recentList for atualizado
    useEffect(() => {
        try {
            localStorage.setItem('meu_historico_clientes_csv', JSON.stringify(recentList));
        } catch (error) {
            console.error('Erro ao salvar histórico no localStorage', error);
        }
    }, [recentList]);

    const [historyFilter, setHistoryFilter] = useState('');
    const [gpsValidationMap, setGpsValidationMap] = useState({});
    const fileInputRef = useRef(null);
    // Busca reativa e normalizada para o Histórico (v157/v158)
    const filteredRecentList = React.useMemo(() => {
        try {
            const q = String(historyFilter || '').trim();
            if (!q) return recentList || [];
            const normalize = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
            const nq = normalize(q);
            return (recentList || []).filter(it => {
                try {
                    const c = normalize(it && it.cliente || '');
                    const a = normalize(it && it.endereco || '');
                    return c.includes(nq) || a.includes(nq);
                } catch (e) { return false; }
            });
        } catch (e) { return recentList || []; }
    }, [recentList, historyFilter]);

    // ✅ PASSO 2: Carga inicial do Histórico de Clientes diretamente do banco (lista completa e distinta)
    useEffect(() => {
        if (!HAS_SUPABASE_CREDENTIALS) return;
        let cancelled = false;
        const carregarHistoricoClientes = async () => {
            try {
                const { data, error } = await supabase
                    .from('entregas')
                    .select('cliente, endereco, lat, lng')
                    .not('status', 'eq', 'arquivado')
                    .not('cliente', 'is', null)
                    .neq('cliente', '')
                    .order('created_at', { ascending: false });
                if (cancelled || error || !data) return;
                // Deduplica por nome do cliente (case-insensitive) — mantém o mais recente
                const seen = new Set();
                const unicos = [];
                for (const row of data) {
                    const chave = String(row.cliente || '').toLowerCase().trim();
                    if (!chave || seen.has(chave)) continue;
                    seen.add(chave);
                    unicos.push({
                        cliente: row.cliente,
                        endereco: row.endereco || '',
                        lat: row.lat,
                        lng: row.lng
                    });
                }
                if (cancelled || unicos.length === 0) return;
                // Mescla: registros existentes (localStorage) têm prioridade; novos do banco são acrescentados
                setRecentList(prev => {
                    const lista = Array.isArray(prev) ? prev : [];
                    const prevKeys = new Set(lista.map(p => String(p.cliente || '').toLowerCase().trim()));
                    const novos = unicos.filter(u => !prevKeys.has(String(u.cliente || '').toLowerCase().trim()));
                    if (novos.length === 0) return lista;
                    return [...lista, ...novos];
                });
            } catch (e) { console.error('[Histórico] erro ao carregar do banco:', e); }
        };
        carregarHistoricoClientes();
        return () => { cancelled = true; };
    }, []); // executa apenas uma vez no mount

    const [user, setUser] = useState(null);
    const [session, setSession] = useState(null);
    const audioRef = useRef(new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3'));

    const mapRef = useRef(null);
    const mapRefUnused = mapRef; // preserve ref usage pattern; no history counters needed
    const mapContainerRef = useRef(null);

    // Importar CSV local (apenas memória, não persiste no Supabase)
    const handleImportarCSV = (file) => {
        if (!file) return;
        try {
            const reader = new FileReader();
            reader.onload = (ev) => {
                try {
                    const text = String(ev.target.result || '');
                    // separar linhas, compatível com CRLF e LF
                    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
                    if (lines.length <= 1) return; // nada além do header
                    const dataLines = lines.slice(1); // pular cabeçalho
                    const parsed = dataLines.map(line => {
                        // split por ponto-e-vírgula; campos entre aspas
                        const cols = line.split(';').map(c => c.trim());
                        const cliente = cols[1] ? cols[1].replace(/^"|"$/g, '').replace(/""/g, '"').trim() : '';
                        const endereco = cols[2] ? cols[2].replace(/^"|"$/g, '').replace(/""/g, '"').trim() : '';
                        return { cliente, endereco };
                    }).filter(it => it && (it.cliente || it.endereco));

                    // dedupe: mesmo cliente+endereco
                    const map = new Map();
                    parsed.forEach(it => {
                        const key = `${String(it.cliente || '').toLowerCase()}|${String(it.endereco || '').toLowerCase()}`;
                        if (!map.has(key)) map.set(key, it);
                    });
                    const unique = Array.from(map.values());

                    // merge com estado existente, preservando o que já existe
                    setRecentList(prev => {
                        const prevMap = new Map();
                        (prev || []).forEach(p => {
                            const k = `${String(p.cliente || '').toLowerCase()}|${String(p.endereco || '').toLowerCase()}`;
                            if (!prevMap.has(k)) prevMap.set(k, p);
                        });
                        unique.forEach(u => {
                            const k = `${String(u.cliente || '').toLowerCase()}|${String(u.endereco || '').toLowerCase()}`;
                            if (!prevMap.has(k)) prevMap.set(k, u);
                        });
                        return Array.from(prevMap.values());
                    });
                } catch (e) { console.error('Erro parseando CSV:', e); }
            };
            reader.onerror = (err) => { console.error('FileReader erro:', err); };
            reader.readAsText(file, 'utf-8');
        } catch (e) { console.error('handleImportarCSV erro:', e); }
    };

    // Fetch control refs to avoid concurrent fetches and manage retries
    const fetchInProgressRef = useRef(false);
    const retryTimerRef = useRef(null);
    const listReloadTimerRef = useRef(null);
    const lastEntregasHashRef = useRef('');
    const isUpdatingRef = useRef(false);
    const canSendMotoristaIdRef = useRef(null);
    const isProcessingRef = useRef(false);
    const motoristaSelecionadoIdRef = useRef(null);
    const retryCountRef = useRef(0); // counts consecutive retry attempts to avoid infinite loops
    const routingInProgressRef = useRef(false); // prevents concurrent heavy route computations
    const lastRouteCacheRef = useRef(new Map()); // cache per motoristaId => { hash, result, timestamp }
    const lastDirectionsQueryRef = useRef(null); // cache last query hash to avoid duplicate Directions calls
    const lastDrawResultRef = useRef(null); // store last draw result {meters,secs}
    const motoristaDebounceMapRef = useRef(new Map()); // per-motorista debounce timers for realtime events
    const lastFrotaRef = useRef([]);

    // Cleanup on unmount for any pending retry
    useEffect(() => {
        return () => { if (retryTimerRef.current) clearTimeout(retryTimerRef.current); };
    }, []);

    // Schedule a retry for failed fetches with exponential backoff (safe no-op if carregarDados undefined)
    function scheduleRetry(ms = 5000) {
        try {
            if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
            retryCountRef.current = (retryCountRef.current || 0) + 1;
            const factor = Math.min(6, Math.max(0, retryCountRef.current - 1));
            const delay = Math.min(60000, ms * Math.pow(2, factor));
            retryTimerRef.current = setTimeout(() => {
                try {
                    if (typeof carregarDados === 'function') carregarDados({ forceAll: false });
                } catch (e) { /* swallow */ }
            }, delay);
        } catch (e) { /* swallow */ }
    }

    // define map center EARLY to avoid ReferenceError in effects
    const [zoomLevel, setZoomLevel] = useState(13);
    const DEFAULT_MAP_CENTER = { lat: -27.645, lng: -48.648 };
    const [mapCenterState, setMapCenterState] = useState(DEFAULT_MAP_CENTER);
    const [pontoPartida, setPontoPartida] = useState(DEFAULT_MAP_CENTER); // sede/company fallback or dynamic driver origin
    const [mapFocusCoords, setMapFocusCoords] = useState(null);
    const [gestorLocation, setGestorLocation] = useState('São Paulo, BR');

    // Refs para estabilizar valores usados em callbacks assíncronos
    const pontoPartidaRef = useRef(pontoPartida);
    useEffect(() => { pontoPartidaRef.current = pontoPartida; }, [pontoPartida]);
    const mapCenterRef = useRef(mapCenterState);
    useEffect(() => { mapCenterRef.current = mapCenterState; }, [mapCenterState]);
    // Cofre persistente para evitar perda do ID em reloads temporários
    const motoristaIdRef = useRef(null);

    // Ensure Google Maps resizes after the container height changes
    useEffect(() => {
        if (!mapContainerRef.current) return;
        let ro = null;
        let t = null;
        const notifyResize = () => {
            try {
                if (!mapRef.current) return;
                if (typeof window !== 'undefined' && window.google && window.google.maps && typeof window.google.maps.event.trigger === 'function') {
                    window.google.maps.event.trigger(mapRef.current, 'resize');
                } else if (mapRef.current && typeof mapRef.current.setCenter === 'function') {
                    mapRef.current.setCenter && mapRef.current.setCenter(mapCenterState);
                }
            } catch (e) { /* ignore */ }
        };

        if (typeof ResizeObserver !== 'undefined') {
            ro = new ResizeObserver(() => {
                clearTimeout(t);
                t = setTimeout(() => notifyResize(), 150);
            });
            ro.observe(mapContainerRef.current);
        } else {
            // Fallback: listen to window resize
            const onWin = () => { clearTimeout(t); t = setTimeout(() => notifyResize(), 150); };
            window.addEventListener('resize', onWin);
            ro = { disconnect: () => window.removeEventListener('resize', onWin) };
        }

        return () => { if (ro && typeof ro.disconnect === 'function') ro.disconnect(); clearTimeout(t); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mapCenterState]);

    // Draft polyline drawing: dashed preview connecting origin + draftPreview points
    useEffect(() => {
        try {
            if (!mapRef.current || !draftPreview || draftPreview.length === 0) {
                try { if (draftPolylineRef.current) { draftPolylineRef.current.setMap(null); draftPolylineRef.current = null; } } catch (e) { }
                return;
            }
            if (!window.google || !window.google.maps) return;
            // remove existing
            try { if (draftPolylineRef.current) { draftPolylineRef.current.setMap(null); draftPolylineRef.current = null; } } catch (e) { }
            const path = [(pontoPartida && pontoPartida.lat != null && pontoPartida.lng != null) ? pontoPartida : mapCenterState || DEFAULT_MAP_CENTER].concat((draftPreview || []).map(pp => ({ lat: Number(pp.lat), lng: Number(pp.lng) })));
            const poly = new window.google.maps.Polyline({
                path,
                strokeColor: '#60a5fa',
                strokeOpacity: 0.85,
                strokeWeight: 3,
                icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 4 }, offset: '0', repeat: '12px' }],
                map: mapRef.current
            });
            draftPolylineRef.current = poly;
        } catch (e) { console.warn('Erro desenhando draft polyline', e); }
        return () => { try { if (draftPolylineRef.current) { draftPolylineRef.current.setMap(null); draftPolylineRef.current = null; } } catch (e) { } };
    }, [draftPreview, pontoPartida, mapCenterState]);

    // Ensure data loads immediately on first mount so F5 shows pins
    useEffect(() => {
        try {
            console.log("🚀 [INICIALIZAÇÃO] Carregando dados pela primeira vez...");
            carregarDados();
        } catch (e) { /* ignore */ }
    }, []); // executa apenas uma vez no mount
    // Google API loading is handled by APIProvider from the maps library (mapsLib.APIProvider)
    const googleLoaded = typeof window !== 'undefined' && window.google && window.google.maps ? true : false;

    // Autocomplete services removed — no Google Places/Autocomplete initialization

    // Draft point logic removed to simplify form behavior (no ephemeral draft point)

    // Draft preview optimization disabled (emergency reset) — remove heavy recalculations
    useEffect(() => { /* draft preview disabled in emergency reset */ }, []);

    // Suggestions: fetch history matches from Supabase
    async function fetchHistoryMatches(q) {
        try {
            if (!q || String(q).trim().length < 3) { setHistorySuggestions([]); return; }
            const { data, error } = await supabase.from('entregas').select('cliente,endereco,lat,lng').ilike('endereco', `%${q}%`).limit(6);
            if (error) { setHistorySuggestions([]); return; }
            setHistorySuggestions(Array.isArray(data) ? data : []);
        } catch (e) { setHistorySuggestions([]); }
    }

    // Predictions and Places interaction removed (no autocomplete)

    // Approve / Reject handlers for Gestão de Motoristas
    // New admin-facing approve by id
    const aprovarMotorista = async (id) => {
        try {
            if (!id) return;
            const sid = Number(id);
            const { data, error } = await supabase.from('motoristas').update({ aprovado: true, acesso: 'aprovado' }).eq('id', sid).select();
            if (error) {
                console.error('aprovarMotorista db error:', error);
                return { error };
            }
            // Tenta extrair telefone do registro atualizado
            const motorista = Array.isArray(data) ? data[0] : data;
            const telefone = motorista?.telefone || null;

            // Atualiza a lista no dashboard
            try { await carregarDados(); } catch (e) { /* non-blocking */ }

            // Feedback visual para o gestor e mensagem de parabéns via WhatsApp (nova aba)
            try { alert('Motorista aprovado com sucesso!'); } catch (e) { /* ignore */ }
            if (telefone) {
                const finalMsg = 'Parabéns! Seu perfil foi validado. O aplicativo já está liberado para você trabalhar. Boa sorte! 🚀';
                const waUrl = `https://api.whatsapp.com/send?phone=${encodeURIComponent(String(telefone).replace(/\D/g, ''))}&text=${encodeURIComponent(finalMsg)}`;
                try { window.open(waUrl, '_blank'); } catch (e) { /* ignore */ }
            }

            return { data };
        } catch (e) {
            console.error('aprovarMotorista error:', e);
            return { error: e };
        }
    };

    const approveDriver = async (m) => {
        // backward-compatible wrapper
        const id = m && (m.id || m);
        return aprovarMotorista(id);
    };

    const rejectDriver = async (m) => {
        try {
            const id = m && (m.id || m);
            if (!id) return;
            // REMOVED: deleting from 'motoristas' is not allowed. Instead, mark rejected locally and reload data.
            console.warn('rejectDriver: delete removed for safety. Consider updating a status flag instead. id=', id);
            try { await carregarDados(); } catch (e) { /* non-blocking */ }
            return { data: null };
        } catch (e) {
            console.error('rejectDriver error:', e);
            return { error: e };
        }
    };

    // Limpador de localStorage: remove referências literais ao motorista antigo (ex: 'f6a9...') se existirem
    useEffect(() => {
        try {
            if (typeof window === 'undefined' || !window.localStorage) return;
            const keysToCheck = ['motorista', 'v10_email'];
            keysToCheck.forEach(k => {
                try {
                    const raw = localStorage.getItem(k);
                    if (!raw) return;
                    if (String(raw).includes('f6a9')) {
                        localStorage.removeItem(k);
                    }
                } catch (e) { /* ignore */ }
            });
        } catch (e) { /* ignore */ }
    }, []);

    // Remover definição interna do ícone (usamos `motoIcon` definida no topo)

    // NOTE: Google Maps loading is delegated to the maps library's `APIProvider` when available.

    // Debug: log do estado dos motoristas sempre que `frota` mudar
    useEffect(() => {
        // debug logs removed for production dashboard
    }, [frota]);

    // If Supabase credentials are not present, show a clear error screen and avoid loading fake data
    if (!HAS_SUPABASE_CREDENTIALS) {
        return (
            <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#111827', color: '#fff' }}>
                <div style={{ textAlign: 'center', maxWidth: '720px', padding: '24px' }}>
                    <h1 style={{ fontSize: '28px', marginBottom: '12px' }}>ERRO DE CONEXÃO: Chaves de API ausentes</h1>
                    <p style={{ opacity: 0.85, marginBottom: '8px' }}>Defina as variáveis de ambiente <strong>VITE_SUPABASE_URL</strong> e <strong>VITE_SUPABASE_ANON_KEY</strong> (ou habilite o fallback de desenvolvimento em <strong>src/supabaseClient.js</strong>).</p>
                    <p style={{ opacity: 0.7 }}>O sistema exige uma conexão real com o Supabase — sem chaves não é possível iniciar.</p>
                </div>
            </div>
        );
    }

    useEffect(() => {
        // Carrega dados iniciais (sem solicitar GPS no dashboard)
        const init = async () => {
            await carregarDados();
        };
        init();

        // On page load or when opening the dashboard, try to reuse last saved estimated distance from DB to avoid calling Google
        (async () => {
            try {
                if (!HAS_SUPABASE_CREDENTIALS) return;
                const { data: lastLog, error } = await supabase.from('logs_roteirizacao').select('distancia_nova, created_at').order('created_at', { ascending: false }).limit(1);
                if (!error && lastLog && lastLog.length > 0 && lastLog[0].distancia_nova != null) {
                    try {
                        const val = Number(lastLog[0].distancia_nova);
                        if (val && (!estimatedDistanceKm || estimatedDistanceKm === null)) setEstimatedDistanceKm(Number(val));
                    } catch (e) { /* ignore */ }
                }
            } catch (e) { /* ignore */ }
        })();
    }, []);

    // Reverse geocode motoristaDaRota coordinates to city name (auto-updates)
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                if (!motoristaDaRota || motoristaDaRota.lat == null || motoristaDaRota.lng == null) {
                    if (!cancelled) setMotoristaCidade(null);
                    return;
                }
                const key = `${Number(motoristaDaRota.lat).toFixed(4)},${Number(motoristaDaRota.lng).toFixed(4)}`;
                if (cidadeCacheRef.current.has(key)) {
                    if (!cancelled) setMotoristaCidade(cidadeCacheRef.current.get(key));
                    return;
                }
                const token = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_MAPBOX_TOKEN) ? import.meta.env.VITE_MAPBOX_TOKEN : 'pk.eyJ1IjoibGVhbmRyb2RpdGFtYXI4MiIsImEiOiJjbWpid2NsZDYwbDN4M2ZweWZsbTBvamV4In0.cmNRPggP9Y_zkZZ1Yq-_4w';
                const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${Number(motoristaDaRota.lng)},${Number(motoristaDaRota.lat)}.json?types=place&language=pt&limit=1&access_token=${token}`;
                const resp = await fetch(url, { headers: { Accept: 'application/json' } });
                if (!resp || !resp.ok) {
                    cidadeCacheRef.current.set(key, null);
                    if (!cancelled) setMotoristaCidade(null);
                    return;
                }
                const jd = await resp.json();
                const feat = jd && jd.features && jd.features[0];
                const city = feat && (feat.text || (feat.place_name && feat.place_name.split(',')[0])) ? (feat.text || feat.place_name.split(',')[0]) : null;
                cidadeCacheRef.current.set(key, city);
                if (!cancelled) setMotoristaCidade(city);
            } catch (e) {
                try { cidadeCacheRef.current.set(key, null); } catch (err) { }
                if (!cancelled) setMotoristaCidade(null);
            }
        })();
        return () => { cancelled = true; };
    }, [motoristaDaRota && motoristaDaRota.lat, motoristaDaRota && motoristaDaRota.lng]);

    // Tenta obter localização do gestor via Geolocation + reverse geocoding
    useEffect(() => {
        let mounted = true;
        if (typeof navigator === 'undefined' || !navigator.geolocation) {
            setGestorLocation('São Paulo, BR');
            return;
        }

        const success = async (pos) => {
            if (!mounted) return;
            const { latitude, longitude } = pos.coords || {};
            try {
                // Primeiro: tentar Geocoder do Google se carregado
                if (window.google && window.google.maps && window.google.maps.Geocoder) {
                    const geocoder = new window.google.maps.Geocoder();
                    const results = await new Promise((resolve, reject) => {
                        geocoder.geocode({ location: { lat: latitude, lng: longitude } }, (res, status) => {
                            if (status === 'OK') resolve(res);
                            else {
                                if (status === 'OVER_QUERY_LIMIT') markGoogleQuotaExceeded('Geocoder');
                                if (status === 'REQUEST_DENIED' || status === 'API_NOT_ALLOWED') markGoogleQuotaExceeded('Geocoder', '⚠️ Geocoder do Google não autorizado. Use fallback Nominatim.');
                                reject(status);
                            }
                        });
                    });
                    let city = '';
                    let state = '';
                    for (const r of results || []) {
                        for (const comp of r.address_components || []) {
                            if ((comp.types || []).includes('locality')) city = comp.long_name || city;
                            if ((comp.types || []).includes('administrative_area_level_1')) state = comp.short_name || state;
                        }
                        if (city && state) break;
                    }
                    if (!city && results && results[0]) {
                        for (const comp of results[0].address_components || []) {
                            if (!city && (comp.types || []).includes('locality')) city = comp.long_name || city;
                            if (!state && (comp.types || []).includes('administrative_area_level_1')) state = comp.short_name || state;
                        }
                    }
                    if (city || state) setGestorLocation(`${city || 'São Paulo'}, ${state || 'BR'}`);
                    else setGestorLocation('São Paulo, BR');
                    return;
                }

                // Fallback: desativado (Nominatim pode causar CORS/425).
                // Em vez de buscar endereço por nome, usamos coordenadas brutas para não bloquear a renderização.
                try {
                    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
                        setGestorLocation(`${Number(latitude).toFixed(5)}, ${Number(longitude).toFixed(5)}`);
                        return;
                    }
                } catch (e) {
                    // garante que qualquer erro aqui não quebre o dashboard
                    console.warn('Fallback de localização falhou, usando padrão', e);
                }
            } catch (e) {
                if (String(e).includes && String(e).includes('OVER_QUERY_LIMIT')) { markGoogleQuotaExceeded('Geocoder'); }
                // swallow and fallback
            }
            if (mounted) setGestorLocation('São Paulo, BR');
        };

        const fail = () => { if (mounted) setGestorLocation('São Paulo, BR'); };

        navigator.geolocation.getCurrentPosition(success, fail, { timeout: 10000, maximumAge: 600000 });
        return () => { mounted = false; };
    }, []);

    // Google Maps dynamic import removed. This project uses Leaflet/Mapbox; avoid importing external Google map libs.

    // Failsafe do Gestor: marcar offline com fetch keepalive no pagehide
    useEffect(() => {
        if (!user || !session) return;

        const marcarGestorOffline = () => {
            try {
                const supabaseUrl = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env.VITE_SUPABASE_URL : undefined;
                const anonKey = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env.VITE_SUPABASE_ANON_KEY : undefined;
                if (!supabaseUrl || !user?.id) return;

                const url = `${supabaseUrl}/rest/v1/usuarios?id=eq.${user.id}`;
                const body = JSON.stringify({ esta_online: false, ultima_atividade: new Date().toISOString() });

                try {
                    fetch(url, {
                        method: 'PATCH',
                        keepalive: true,
                        headers: {
                            'apikey': anonKey || '',
                            'Authorization': `Bearer ${session?.access_token || anonKey || ''}`,
                            'Content-Type': 'application/json',
                            'Prefer': 'return=minimal'
                        },
                        body
                    }).catch(() => { /* swallow */ });
                } catch (e) { /* swallow */ }
            } catch (e) { /* swallow */ }
        };

        window.addEventListener('pagehide', marcarGestorOffline);
        return () => window.removeEventListener('pagehide', marcarGestorOffline);
    }, [user, session]);

    // Log de ambiente (REAL vs MOCK) para diagnóstico
    useEffect(() => {
        // diagnostic log removed for performance in render path
    }, []);

    // Ordena a rota ativa pelo campo 'ordem' (caixeiro viajante) para visualização
    const orderedRota = rotaAtiva && rotaAtiva.slice ? rotaAtiva.slice().sort((a, b) => (a.ordem || 0) - (b.ordem || 0)) : [];

    // Center for map: force Santa Catarina as requested
    const motoristaLeandro = frota && frota.find ? frota.find(m => m.id === 1) : null;
    // Forçar centro em Santa Catarina (coordenadas antigas removidas) — usar `mapCenterState`.

    // SmoothMarker: mantém posição exibida localmente para permitir transições CSS suaves
    const SmoothMarker = ({ m }) => {
        if (m.esta_online !== true || m.lat == null || m.lng == null) return null;
        const [displayPos, setDisplayPos] = useState({ lat: Number(m.lat) || 0, lng: Number(m.lng) || 0 });
        useEffect(() => {
            // Ao receber novas coordenadas do Supabase, atualiza gradualmente o estado exibido
            setDisplayPos({ lat: Number(m.lat) || 0, lng: Number(m.lng) || 0 });
        }, [m.lat, m.lng]);

        const iconSize = zoomLevel > 15 ? 48 : 32;
        const MarkerComp = mapsLib && mapsLib.AdvancedMarker ? mapsLib.AdvancedMarker : ({ children }) => <div>{children}</div>;
        return (
            <MarkerComp key={m.id} position={{ lat: Number(displayPos.lat), lng: Number(displayPos.lng) }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', transform: 'translateY(-20px)', zIndex: 100001 }}>
                    <div style={{ backgroundColor: 'white', color: 'black', padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 'bold', boxShadow: '0 2px 5px rgba(0,0,0,0.2)', marginBottom: '4px' }}>
                        {m.nome || 'Entregador'}
                    </div>
                    <img src="/bicicleta-de-entrega.png" alt="Entregador" style={{ width: `${iconSize}px`, height: `${iconSize}px`, objectFit: 'contain', transition: 'width 0.3s ease-in-out, height 0.3s ease-in-out' }} />
                </div>
            </MarkerComp>
        );
    };

    // Helper: map type to color
    function colorForType(tipo) {
        const t = String(tipo || '').trim().toLowerCase();
        if (t === 'recolha') return '#fb923c'; // laranja
        if (t === 'outros' || t === 'outro') return '#c084fc'; // roxo
        return '#2563eb'; // azul (entrega default)
    }

    // Retorna cor/url do ícone do marcador baseado em status (prioridade) e tipo
    function getMarkerIcon(status, tipo) {
        try {
            const statusNormalizado = String(status || '').trim().toLowerCase();
            const tipoNormalizado = String(tipo || '').trim().toLowerCase();

            // Prioridade para status finais
            if (statusNormalizado === 'entregue') return '#10b981'; // verde
            if (statusNormalizado === 'falha') return '#ef4444'; // vermelho

            // Caso não seja um status final, decidir pela propriedade `tipo` (p.tipo)
            if (tipoNormalizado === 'recolha') return '#fb923c'; // laranja
            if (tipoNormalizado === 'entrega') return '#2563eb'; // azul
            if (tipoNormalizado === 'outros' || tipoNormalizado === 'outro') return '#a78bfa'; // lilás

            // fallback: azul (entrega padrão)
            return '#2563eb';
        } catch (e) {
            return '#2563eb';
        }
    }

    function capitalize(s) { return String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1); }

    // Delivery markers: numbered pins with color and small label showing type
    const DeliveryMarkers = React.memo(function DeliveryMarkers({ list = [], mapsLib }) {
        if (!mapsLib || !mapsLib.AdvancedMarker) return null;
        return (list || []).map((p, idx) => {
            const lat = Number(p.lat);
            const lng = Number(p.lng);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
            const num = (p.ordem_logistica != null && Number.isFinite(Number(p.ordem_logistica)) && Number(p.ordem_logistica) > 0) ? String(Number(p.ordem_logistica)) : String(idx + 1);

            const tipoDesc = p.tipo || 'outros';
            const cor = getMarkerIcon(p.status, tipoDesc);

            const MarkerComp = mapsLib.AdvancedMarker;
            return (
                <MarkerComp key={`entrega-${p.id || idx}`} position={{ lat, lng }} icon={getMarkerIcon(p.status, tipoDesc)}>
                    <div style={{ transform: 'translate(-50%,-110%)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <div style={{ backgroundColor: 'rgba(0,0,0,0.75)', color: '#fff', padding: '4px 8px', borderRadius: 12, fontSize: 11, fontWeight: 700, marginBottom: 6, boxShadow: '0 2px 6px rgba(0,0,0,0.25)' }}>
                            {capitalize(tipoDesc)}
                        </div>
                        <div style={{ width: 36, height: 36, borderRadius: '50%', background: cor, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 14, boxShadow: '0 4px 10px rgba(0,0,0,0.25)' }}>
                            {String(num)}
                        </div>
                    </div>
                </MarkerComp>
            );
        });
    });


    // (MapControls removed — using single `BotoesMapa` inside <Map>)

    // Componente interno obrigatório para controle do mapa (deve ficar DENTRO de <Map>..</Map>)
    function BotoesMapa() {
        const map = mapsLib && typeof mapsLib.useMap === 'function' ? mapsLib.useMap() : null;
        const [spinning, setSpinning] = useState(false);
        const handleRefresh = () => {
            setSpinning(true);
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition((position) => {
                    const { latitude, longitude } = position.coords;
                    if (map) {
                        map.panTo({ lat: latitude, lng: longitude });
                        map.setZoom(15);
                    }
                    try { carregarDados(); } catch (e) { /* non-blocking */ }
                    // stop spinning after a short interval to show feedback
                    setTimeout(() => setSpinning(false), 900);
                }, () => { setSpinning(false); });
            } else {
                setSpinning(false);
            }
        };
        return (
            <div style={{ position: 'absolute', top: 65, right: 12, zIndex: 9999 }}>
                <button onClick={handleRefresh} style={{ width: 44, height: 44, borderRadius: '50%', background: '#fff', border: 'none', cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4b5563" strokeWidth="2" style={{ transform: spinning ? 'rotate(360deg)' : 'none', transition: 'transform 0.9s linear' }}><path d="M21 12a9 9 0 10-2.62 6.13M21 3v6h-6" /></svg>
                </button>
            </div>
        );
    }

    // (MapControlsFallback removed — single `BotoesMapa` is used inside <Map>)

    // Helpers para cores por tipo de carga
    const getColorForType = (tipo) => {
        const t = String(tipo || '').trim().toLowerCase();
        if (t === 'entrega') return '#2563eb'; // azul
        if (t === 'recolha') return '#f59e0b'; // laranja
        if (t === 'outros' || t === 'outro') return '#a855f7'; // lilás
        return '#10b981'; // verde livre / padrão
    };

    const getContrastText = (hex) => {
        try {
            if (!hex) return '#fff';
            const h = hex.replace('#', '');
            const r = parseInt(h.substring(0, 2), 16) / 255;
            const g = parseInt(h.substring(2, 4), 16) / 255;
            const b = parseInt(h.substring(4, 6), 16) / 255;
            const lum = 0.2126 * (r <= 0.03928 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4)) + 0.7152 * (g <= 0.03928 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4)) + 0.0722 * (b <= 0.03928 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4));
            return lum > 0.5 ? '#000000' : '#ffffff';
        } catch (e) { return '#fff'; }
    };

    const getDriverServiceType = (motoristaId) => {
        try {
            const found = (rotaAtiva || []).find(r => Number(r.motorista_id) === Number(motoristaId) && String(r.status || '').trim().toLowerCase() === 'em_rota');
            return found ? (found.tipo || null) : null;
        } catch (e) { return null; }
    };

    const getDriverColor = (motoristaId) => {
        const tipo = getDriverServiceType(motoristaId);
        return tipo ? getColorForType(tipo) : '#10b981';
    };
    // Normalize IDs for DB queries: return Number when numeric, otherwise keep string (UUID)
    function normalizeDbId(id) {
        try {
            if (id == null) return id;
            if (typeof id === 'number') return id;
            const s = String(id).trim();
            if (/^-?\d+$/.test(s)) return Number(s);
            return s; // keep UUID-like or other strings
        } catch (e) { return id; }
    }

    // Combina entregas em espera e rota ativa para analisar status por motorista
    const entregasAtivos = [...(pedidosPendentes || []), ...(rotaAtiva || [])];



    // Retorna coordenadas do gestor usando Geolocation com fallback para DEFAULT_MAP_CENTER
    const obterPosicaoGestor = React.useCallback(() => {
        return new Promise((resolve) => {
            if (typeof navigator === 'undefined' || !navigator.geolocation) {
                resolve(DEFAULT_MAP_CENTER);
                return;
            }
            let resolved = false;
            const onSuccess = (pos) => {
                if (resolved) return;
                resolved = true;
                const lat = pos?.coords?.latitude || DEFAULT_MAP_CENTER.lat;
                const lng = pos?.coords?.longitude || DEFAULT_MAP_CENTER.lng;
                resolve({ lat: Number(lat), lng: Number(lng) });
            };
            const onError = () => {
                if (resolved) return;
                resolved = true;
                resolve(DEFAULT_MAP_CENTER);
            };
            try {
                navigator.geolocation.getCurrentPosition(onSuccess, onError, { timeout: 10000, maximumAge: 600000 });
            } catch (e) {
                onError();
            }
            // safety timeout in case the callback never fires
            setTimeout(() => { if (!resolved) { resolved = true; resolve(DEFAULT_MAP_CENTER); } }, 11000);
        });
    }, []);

    // Realtime: coração do rastreio - escuta UPDATEs na tabela `motoristas`
    useEffect(() => {
        if (!HAS_SUPABASE_CREDENTIALS) return;

        // handler usado por both realtime channel and polling fallback
        const handleRealtimeMotoristas = (payload) => {
            try {
                const rec = payload.new || payload.record || null;
                if (!rec || !rec.id) return;

                const parsed = {
                    ...rec,
                    lat: rec.lat != null ? Number(rec.lat) : null,
                    lng: rec.lng != null ? Number(rec.lng) : null
                };

                if (parsed.lat === null || parsed.lng === null) return;

                setFrota(prev => {
                    const arr = Array.isArray(prev) ? prev : [];
                    const antigo = arr.find(m => String(m.id) === String(parsed.id));

                    // 📐 CÁLCULO DE ÂNGULO (BEARING) PARA NÃO ANDAR DE RÉ
                    if (antigo && antigo.lat && antigo.lng) {
                        const p1 = { lat: antigo.lat, lng: antigo.lng };
                        const p2 = { lat: parsed.lat, lng: parsed.lng };

                        // Só calcula se a moto se moveu significativamente
                        if (p1.lat !== p2.lat || p1.lng !== p2.lng) {
                            const dLon = (p2.lng - p1.lng) * Math.PI / 180;
                            const y = Math.sin(dLon) * Math.cos(p2.lat * Math.PI / 180);
                            const x = Math.cos(p1.lat * Math.PI / 180) * Math.sin(p2.lat * Math.PI / 180) -
                                Math.sin(p1.lat * Math.PI / 180) * Math.cos(p2.lat * Math.PI / 180) * Math.cos(dLon);

                            let brng = Math.atan2(y, x) * 180 / Math.PI;
                            const finalAngle = (brng + 360) % 360;

                            // Guarda o ângulo no registro para o MapaLogistica usar
                            parsed.heading = finalAngle;

                            // Se tiveres o lastAnglesRef acessível aqui, atualiza-o também:
                            if (typeof lastAnglesRef !== 'undefined' && lastAnglesRef.current) {
                                try { lastAnglesRef.current.set(String(parsed.id), finalAngle); } catch (e) { }
                            }
                        } else {
                            // Mantém o ângulo anterior se estiver parada
                            parsed.heading = antigo.heading || 0;
                        }
                    }

                    if (antigo) {
                        return arr.map(m => String(m.id) === String(parsed.id) ? { ...m, ...parsed } : m);
                    }
                    return [...arr, parsed];
                });

            } catch (e) {
                console.warn('Erro no handler realtime motoristas:', e);
            }
        };

        // Prefer native Supabase realtime channel when available
        if (supabase && typeof supabase.channel === 'function') {
            const canal = supabase
                .channel('rastreio-v10')
                .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'motoristas' }, handleRealtimeMotoristas)
                .subscribe();

            return () => {
                try { supabase.removeChannel(canal); } catch (e) { canal.unsubscribe && canal.unsubscribe(); }
            };
        }

        // Fallback: polling subscribeToTable
        let stopPolling = null;
        try {
            if (typeof subscribeToTable === 'function') {
                stopPolling = subscribeToTable('motoristas', (res) => {
                    (res && res.data || []).forEach(r => handleRealtimeMotoristas({ new: r }));
                }, { pollMs: 1000 });
            }
        } catch (e) { /* ignore */ }

        return () => { try { if (stopPolling) stopPolling(); } catch (e) { /* ignore */ } };
    }, []);

    // Route polyline ref (manages drawn optimized route on map)
    const routePolylineRef = useRef(null);

    // Draw route on map: prefer DirectionsService to get a smooth polyline, otherwise connect points
    async function drawRouteOnMap(origin, orderedList = [], includeHQ = false, pontoPartida = null, motoristaId = null) {
        try {
            // Clean previous polyline
            try { if (routePolylineRef.current) { routePolylineRef.current.setMap(null); routePolylineRef.current = null; } } catch (e) { }
            if (!mapRef.current) return;

            // Build waypoints array
            const waypts = orderedList.map(p => ({ lat: Number(p.lat), lng: Number(p.lng) }));
            // If includeHQ true, insert pontoPartida after first chunk (visual only)
            if (includeHQ && pontoPartida) {
                // place HQ after first ROUTE_CYCLE_LIMIT waypoints
                const limit = Number((typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_ROUTE_CYCLE_LIMIT) || 10);
                if (waypts.length > limit) {
                    // splice HQ into place
                    waypts.splice(limit, 0, { lat: Number(pontoPartida.lat), lng: Number(pontoPartida.lng) });
                }
            }

            // Prevent duplicate Directions calls: if origin+orderedList+includeHQ same as last query, reuse result
            try {
                const qhash = JSON.stringify({ origin: origin, list: (orderedList || []).map(p => p && (p.id || `${p.lat},${p.lng}`)), includeHQ: !!includeHQ, base: pontoPartida });
                if (lastDirectionsQueryRef.current === qhash && lastDrawResultRef.current) {
                    const lr = lastDrawResultRef.current;
                    if (lr.meters) setEstimatedDistanceKm(Number((lr.meters / 1000).toFixed(1)));
                    try { if (lr.secs) { setEstimatedTimeSec(lr.secs); setEstimatedTimeText(formatDuration(lr.secs)); } } catch (e) { }
                    return lr;
                }
            } catch (e) { /* ignore hash */ }

            // Try DirectionsService to get overview_path
            if (typeof window !== 'undefined' && window.google && window.google.maps && window.google.maps.DirectionsService) {
                try {
                    const directionsService = new window.google.maps.DirectionsService();
                    const dsWaypoints = waypts.map(w => ({ location: w, stopover: true }));
                    const baseDest = (pontoPartida && pontoPartida.lat != null && pontoPartida.lng != null) ? pontoPartida : mapCenterState || DEFAULT_MAP_CENTER;
                    const request = { origin, destination: baseDest, travelMode: window.google.maps.TravelMode.DRIVING, waypoints: dsWaypoints, optimizeWaypoints: true };
                    const res = await new Promise((resolve, reject) => directionsService.route(request, (r, s) => s === 'OK' ? resolve(r) : reject(s)));
                    // Extract waypoint_order from response (source of truth)
                    const wpOrder = res.routes?.[0]?.waypoint_order || null;
                    // If we have a waypoint_order, reorder orderedList accordingly
                    if (Array.isArray(wpOrder) && wpOrder.length === waypts.length && orderedList && orderedList.length === waypts.length) {
                        try {
                            const newOrdered = wpOrder.map(i => orderedList[i]);

                            // Log the computed order IDs for debugging
                            // waypoint_order computed — suppressed verbose logging for stability

                            // Update UI state with the new order (do NOT persist here) — persistence is handled in recalcRotaForMotorista
                            try { setRotaAtiva(newOrdered.map((p, idx) => ({ ...p, ordem: Number(idx + 1), ordem_logistica: Number(idx + 1), motorista_id: String(motoristaId) }))); } catch (e) { }
                            // preview mode: update local draft preview as well
                            try { setDraftPreview(newOrdered.map((p, idx) => ({ ...p, ordem: Number(idx + 1), ordem_logistica: Number(idx + 1) }))); } catch (e) { }

                            // Store wpOrderIds to include in possible return
                            const wpOrderIds = newOrdered.map(p => p && p.id);
                            // wpOrderIds prepared (logging suppressed to avoid spamming console)
                            // Set distance/time from response legs if available
                            try {
                                const legs = res.routes?.[0]?.legs || [];
                                const meters = legs.reduce((s, l) => s + ((l && l.distance && typeof l.distance.value === 'number') ? l.distance.value : 0), 0);
                                const secs = legs.reduce((s, l) => s + ((l && l.duration && typeof l.duration.value === 'number') ? l.duration.value : 0), 0);
                                if (meters > 0) setEstimatedDistanceKm(Number((meters / 1000).toFixed(1)));
                                if (secs > 0) setEstimatedTimeSec(secs);
                                return { meters: meters || 0, secs: secs || 0, wpOrderIds };
                            } catch (e) { /* ignore */ }
                            // use overview_path for polyline below

                            // Set distance/time from response legs if available
                            try {
                                const legs = res.routes?.[0]?.legs || [];
                                const meters = legs.reduce((s, l) => s + ((l && l.distance && typeof l.distance.value === 'number') ? l.distance.value : 0), 0);
                                const secs = legs.reduce((s, l) => s + ((l && l.duration && typeof l.duration.value === 'number') ? l.duration.value : 0), 0);
                                if (meters > 0) setEstimatedDistanceKm(Number((meters / 1000).toFixed(1)));
                                if (secs > 0) setEstimatedTimeSec(secs);
                            } catch (e) { /* ignore */ }

                            // use overview_path for polyline below
                        } catch (e) { console.warn('Erro ao aplicar waypoint_order:', e); }
                    }

                    const path = res.routes?.[0]?.overview_path || null;
                    if (path && path.length > 0) {
                        // Não desenhar mais a polyline azul aqui (remoção definitiva).
                        // Mantemos apenas os cálculos de distância/tempo a partir das legs.
                        try {
                            const legs = res.routes?.[0]?.legs || [];
                            const meters = legs.reduce((s, l) => s + ((l && l.distance && typeof l.distance.value === 'number') ? l.distance.value : 0), 0);
                            const secs = legs.reduce((s, l) => s + ((l && l.duration && typeof l.duration.value === 'number') ? l.duration.value : 0), 0);
                            if (meters > 0) setEstimatedDistanceKm(Number((meters / 1000).toFixed(1)));
                            if (secs > 0) {
                                setEstimatedTimeSec(secs);
                                try { setEstimatedTimeText(formatDuration(secs)); } catch (e) { /* ignore */ }
                            }
                            // If for some reason legs missing, fallback to haversine on overview_path (but legs preferred)
                            if ((!legs || legs.length === 0) && res.routes?.[0]?.overview_path) {
                                try {
                                    const ov = res.routes[0].overview_path || [];
                                    let meters2 = 0;
                                    for (let i = 1; i < ov.length; i++) meters2 += haversineKm(ov[i - 1], ov[i]) * 1000;
                                    if (meters2 > 0) setEstimatedDistanceKm(Number((meters2 / 1000).toFixed(1)));
                                } catch (e) { /* ignore */ }
                            }
                            return { meters: meters || 0, secs: secs || 0 };
                        } catch (e) { /* ignore */ }
                        return { meters: 0, secs: 0 };
                    }
                } catch (e) {
                    console.warn('drawRouteOnMap: DirectionsService failed, falling back to straight path', e);
                }

            }

            // Fallback: straight line through ordered points (cálculo apenas — não desenhar a linha azul)
            const path = [origin].concat(waypts).concat([origin]);
            if (path && path.length > 1 && window.google && window.google.maps) {
                try {
                    // compute haversine sum (only fallback when no legs info available)
                    let meters = 0;
                    for (let i = 1; i < path.length; i++) {
                        meters += haversineKm(path[i - 1], path[i]) * 1000;
                    }
                    if (meters > 0) setEstimatedDistanceKm(Number((meters / 1000).toFixed(1)));
                    return { meters: meters || 0, secs: 0 };
                } catch (e) { /* ignore */ }
            }
        } catch (e) {
            console.warn('drawRouteOnMap failed:', e);
        }
    }

    // Recalculate route for a specific motorista (used on new recolhas and manual trigger)
    // Recalculate route for a specific motorista (used on new recolhas and manual trigger)
    // This function sets pontoPartida dynamically (driver location or sede fallback) and runs routing safely
    const recalcRotaForMotorista = React.useCallback(async (motoristaId) => {
        // motorista_id in DB is TEXT/UUID — query as string and keep IDs as strings here
        let remainingForDriver = [];
        try {
            if (!motoristaId && motoristaId !== 0) return;
            if (routingInProgressRef.current) return;
            routingInProgressRef.current = true;

            // Preferir a posição GPS atual do motorista como origem; fallback para Leandro / mapa
            const driver = (frota || []).find(m => String(m.id) === String(motoristaId));
            let origin = null;
            if (driver && driver.lat != null && driver.lng != null) {
                origin = { lat: Number(driver.lat), lng: Number(driver.lng) };
            } else {
                const leandro = (frota || []).find(m => String(m.nome || '').toLowerCase().includes('leandro') || Number(m.id) === 1);
                if (leandro && leandro.lat != null && leandro.lng != null) origin = { lat: Number(leandro.lat), lng: Number(leandro.lng) };
                else origin = mapCenterRef.current || DEFAULT_MAP_CENTER;
            }

            // helper nearest neighbor using Haversine
            const hav = (a, b) => {
                const toRad = d => d * Math.PI / 180;
                const R = 6371;
                const dLat = toRad(b.lat - a.lat);
                const dLon = toRad(b.lng - a.lng);
                const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
                const sinHalf = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
                return R * 2 * Math.atan2(Math.sqrt(sinHalf), Math.sqrt(1 - sinHalf));
            };

            // motorista_id is TEXT in the DB - use string comparison
            const { data: remData } = await supabase.from('entregas').select('*').eq('motorista_id', String(motoristaId)).in('status', ['pendente', 'em_rota']);
            remainingForDriver = remData || [];
            if (!remainingForDriver.length) return;

            // perform greedy ordering starting from origin
            const ordered = [];
            let cur = { ...origin };
            const list = remainingForDriver.map(r => ({ ...r, lat: Number(r.lat), lng: Number(r.lng) }));
            while (list.length) {
                let bestIdx = 0, bestDist = Infinity;
                for (let i = 0; i < list.length; i++) {
                    const d = hav(cur, { lat: list[i].lat, lng: list[i].lng });
                    if (d < bestDist) { bestDist = d; bestIdx = i; }
                }
                const next = list.splice(bestIdx, 1)[0];
                ordered.push(next);
                cur = { lat: next.lat, lng: next.lng };
            }
            remainingForDriver = ordered;

            // now call Mapbox directions to get polyline
            let routeGeo = null;
            try {
                routeGeo = await getRouteGeometry(origin, remainingForDriver, {});
            } catch (err) { console.warn('directions fail', err); }

            // persist orders + status + polyline
            try {
                isUpdatingRef.current = true;
                const updates = remainingForDriver.map((item, i) => (
                    { id: item.id, ordem_logistica: i + 1, status: 'em_rota' }
                ));
                const promises = updates.map(u => supabase.from('entregas').update(u).eq('id', Number(u.id)));
                await Promise.all(promises);
            } catch (e) { console.error('persist order error', e); } finally { isUpdatingRef.current = false; }
            // Apply local state updates so UI shows 'em_rota' and ordem_logistica immediately
            try { applyLocalEntregasUpdates(remainingForDriver.map((item, i) => ({ id: item.id, ordem_logistica: i + 1, status: 'em_rota' }))); } catch (e) { /* ignore */ }
            if (routeGeo && routeGeo.geometry) {
                try { await supabase.from('entregas').update({ rota_polyline: JSON.stringify(routeGeo.geometry) }).eq('motorista_id', String(motoristaId)); } catch (e) { console.error('persist polyline error', e); }
            }

            // update UI state
            setRotaAtiva(remainingForDriver.map((p, i) => ({ ...p, ordem: i + 1, ordem_logistica: i + 1 })));
        } catch (e) { console.warn('recalc failed', e); } finally { routingInProgressRef.current = false; }
        const hash = JSON.stringify((remainingForDriver || []).map(r => `${r.id || ''}:${r.lat || ''},${r.lng || ''}`));
        const cacheKey = String(motoristaId) + '|' + hash;
        const cached = lastRouteCacheRef.current.get(cacheKey);
        const MAX_CACHE_AGE_MS = 60 * 1000; // 60s
        if (cached && (Date.now() - (cached.timestamp || 0) < MAX_CACHE_AGE_MS)) {
            // reuse cached result to avoid calling Google again
            try {
                if (cached.drawResult) {
                    if (cached.drawResult.meters) setEstimatedDistanceKm(Number((cached.drawResult.meters / 1000).toFixed(1)));
                    if (cached.drawResult.secs) { setEstimatedTimeSec(cached.drawResult.secs); setEstimatedTimeText(formatDuration(cached.drawResult.secs)); }
                }
                if (cached.optimized && Array.isArray(cached.optimized)) {
                    const optimizedWithOrder = (cached.optimized || []).map((p, i) => ({ ...p, ordem: Number(i + 1), ordem_logistica: Number(i + 1), motorista_id: String(motoristaId) }));
                    setRotaAtiva(optimizedWithOrder);
                }
                return;
            } catch (e) { /* ignore cache read issues */ }
        }
    }, []); // <-- Properly close the React.useCallback definition

    // --- Mapbox Matrix helper: retorna array de durations do origin para cada destination (versão blindada)
    async function getRoadDistances(origin, destinations = []) {
        try {
            const token = import.meta.env.VITE_MAPBOX_TOKEN || '';
            if (!token) throw new Error('VITE_MAPBOX_TOKEN não definido');

            // 1. Validação da Origem
            if (!origin || !Number.isFinite(Number(origin.lat)) || !Number.isFinite(Number(origin.lng))) {
                return (destinations || []).map(() => Infinity);
            }

            // 2. Filtrar apenas destinos com coordenadas estritamente válidas
            let validDestinations = (destinations || []).filter(c =>
                c && Number.isFinite(Number(c.lat)) && Number.isFinite(Number(c.lng)) &&
                !(Number(c.lat) === 0 && Number(c.lng) === 0)
            );

            if (validDestinations.length === 0) return (destinations || []).map(() => Infinity);

            // 3. Limite do Mapbox Free (1 Origem + máx 24 Destinos = 25 pontos na Matrix)
            if (validDestinations.length > 24) {
                console.warn(`⚠️ [ROTA] Reduzindo de ${validDestinations.length} para 24 destinos (Limite Mapbox Free).`);
                validDestinations = validDestinations.slice(0, 24);
            }

            // 4. Montar URL
            const coords = [origin].concat(validDestinations).map(c => `${Number(c.lng)},${Number(c.lat)}`).join(';');
            const destIdx = validDestinations.map((_, i) => i + 1).join(';');
            const url = `https://api.mapbox.com/directions-matrix/v1/mapbox/driving/${coords}?sources=0&destinations=${destIdx}&annotations=duration&access_token=${encodeURIComponent(token)}`;

            const res = await fetch(url);
            if (!res.ok) throw new Error(`Mapbox Matrix error: ${res.status}`);
            const json = await res.json();
            if (!json || !Array.isArray(json.durations) || !Array.isArray(json.durations[0])) {
                return (destinations || []).map(() => Infinity);
            }

            // 5. Mapear os resultados de volta para o array original (mantendo o tamanho sincronizado)
            const validResults = json.durations[0].map(d => (d == null ? Infinity : Number(d)));

            return (destinations || []).map(origDest => {
                const validIdx = validDestinations.indexOf(origDest);
                if (validIdx !== -1 && validResults[validIdx] !== undefined) {
                    return validResults[validIdx];
                }
                return Infinity; // Ponto inválido ou que excedeu o limite fica por último
            });

        } catch (e) {
            console.warn('getRoadDistances failed:', e);
            // Fallback: retorna distâncias infinitas para não quebrar o roteirizador
            return (destinations || []).map(() => Infinity);
        }
    }

    // --- Algoritmo de Vizinho Mais Próximo usando tempos de estrada (Mapbox Matrix) ---
    async function organizarRotaInteligente() {
        try {
            // pegar posição atual do motorista Leandro do banco
            let origem = mapCenterRef.current || DEFAULT_MAP_CENTER;
            try {
                const alvo = motoristaSelecionadoId;
                if (alvo) {
                    const { data, error } = await supabase.from('motoristas').select('lat,lng').eq('id', alvo).single();
                    if (!error && data && data.lat != null && data.lng != null) {
                        origem = { lat: Number(data.lat), lng: Number(data.lng) };
                    }
                }
            } catch (e) { /* ignore and use map center */ }

            // construir lista de pendentes válidos
            let pendentes = (entregas || []).filter(it => {
                try {
                    const s = String(it.status || '').trim().toLowerCase();
                    return s === 'pendente' || s === 'em_rota';
                } catch (e) { return false; }
            }).map(it => ({ ...it, lat: Number(it.lat), lng: Number(it.lng) }));

            // TRAVA: se não há pendentes, não chamamos Mapbox (evita Matrix 422)
            if (!pendentes || pendentes.length === 0) {
                return [];
            }

            const ordenada = [];

            while (pendentes.length) {
                // construir destinos atuais
                const dests = pendentes.map(p => ({ lat: Number(p.lat), lng: Number(p.lng) }));
                let durations = await getRoadDistances(origem, dests);

                // 1. Fallback total: Se a API falhou miseravelmente (array vazio ou tamanho errado)
                if (!durations || durations.length !== dests.length) {
                    durations = dests.map(d => haversineKm(origem, d) * 1000);
                } else {
                    // 2. Fallback cirúrgico: Intercepta os "Infinity" (Erro 422 ou Unroutable)
                    // Se o Mapbox não achou rua pro ponto, ele devolve Infinity.
                    // Nós substituímos pela linha reta para ele não ir pro final da fila!
                    durations = durations.map((dur, idx) => {
                        if (dur === Infinity) {
                            return haversineKm(origem, dests[idx]) * 1000;
                        }
                        return dur;
                    });
                }

                // encontrar índice mínimo válido
                let bestIdx = -1;
                let bestVal = Infinity;
                for (let i = 0; i < durations.length; i++) {
                    const v = durations[i];
                    if (Number.isFinite(v) && v >= 0 && v < bestVal) { bestVal = v; bestIdx = i; }
                }

                if (bestIdx === -1) bestIdx = 0; // fallback defensivo

                const escolhido = pendentes.splice(bestIdx, 1)[0];
                ordenada.push(escolhido);
                origem = { lat: Number(escolhido.lat), lng: Number(escolhido.lng) };
            }

            return ordenada;
        } catch (e) {
            console.warn('organizarRotaInteligente failed:', e);
            return [];
        }
    }
    // (Optimização e persistência já executadas dentro desta função.)
    // Fetch last 3 logs for a given motorista
    async function fetchLogsForMotorista(motoristaId) {
        try {
            if (!motoristaId) { setLogsHistory([]); return; }
            const { data, error } = await supabase.from('logs_roteirizacao').select('*').eq('motorista_id', String(motoristaId)).order('created_at', { ascending: false }).limit(3);
            if (error) { console.error('fetchLogsForMotorista: erro', error); setLogsHistory([]); return; }
            setLogsHistory(Array.isArray(data) ? data : []);
        } catch (e) { console.error('fetchLogsForMotorista: exceção', e); setLogsHistory([]); }
    }

    useEffect(() => { try { if (motoristaDaRota && motoristaDaRota.id) fetchLogsForMotorista(String(motoristaDaRota.id)); else setLogsHistory([]); } catch (e) { /* ignore */ } }, [motoristaDaRota]);

    // Realtime: escuta inserções/atualizações em `entregas` para recalcular rotas dinamicamente
    useEffect(() => {
        if (!HAS_SUPABASE_CREDENTIALS) return;

        const handleEntregasEvent = (payload) => {
            try {
                const rec = payload.new || payload.record || null;
                if (!rec) return;
                // Notificações por WhatsApp ao gestor removidas (v149 rollback)
                if (rec.motorista_id) {
                    // apenas marca que houve mudança; não recalcula automaticamente.
                    // gestor verá botão REORGANIZAR ROTA para disparar algoritmo.
                    try {
                        const mid = String(rec.motorista_id);
                        if (!pendingRecalcRef.current.has(mid)) {
                            pendingRecalcRef.current.add(mid);
                            try { setPendingRecalcCount(pendingRecalcRef.current.size); } catch (e) { }
                        }
                    } catch (e) { /* ignore */ }
                }
            } catch (e) { /* ignore */ }
        };

        if (supabase && typeof supabase.channel === 'function') {
            const chan = supabase.channel('entregas-recalc')
                .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'entregas' }, handleEntregasEvent)
                .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'entregas' }, handleEntregasEvent)
                .subscribe();

            return () => { try { supabase.removeChannel(chan); } catch (e) { chan.unsubscribe && chan.unsubscribe(); } };
        }

        // Fallback: polling
        let stopPolling = null;
        try {
            if (typeof subscribeToTable === 'function') {
                stopPolling = subscribeToTable('entregas', (res) => {
                    (res && res.data || []).forEach(r => handleEntregasEvent({ new: r, event: 'INSERT' }));
                }, { pollMs: 1000 });
            }
        } catch (e) { /* ignore */ }

        return () => { try { if (stopPolling) stopPolling(); } catch (e) { /* ignore */ } };
    }, []);

    // Realtime: atualizar lista da Central de Despacho (entregas/pedidosPendentes)
    useEffect(() => {
        if (!HAS_SUPABASE_CREDENTIALS) return;

        const handleListEvent = (payload) => {
            try {
                // If we're currently performing updates (assignDriver/recalc), ignore realtime changes
                if (isUpdatingRef.current) return;

                // Re-fetch pins to guarantee database ordering and avoid race conditions
                try {
                    if (typeof carregarPins === 'function') {
                        // keep it fire-and-forget; carregarPins has its own error handling
                        carregarPins();
                    }
                } catch (e) { console.warn('Erro ao recarregar pins via realtime:', e); }
            } catch (e) { console.warn('Erro ao manipular evento realtime (handleListEvent):', e); }
        };

        if (supabase && typeof supabase.channel === 'function') {
            try {
                const chan = supabase.channel('entregas-listener')
                    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'entregas' }, handleListEvent)
                    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'entregas' }, handleListEvent)
                    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'entregas' }, handleListEvent)
                    .subscribe();

                return () => { try { supabase.removeChannel(chan); } catch (e) { chan.unsubscribe && chan.unsubscribe(); } };
            } catch (e) { console.warn('Erro criando canal realtime para entregas:', e); }
        }

        return undefined;
    }, []);

    // NOTE: v34 — removidos efeitos que resetavam `canSendRoute` automaticamente.
    // O botão permanece verde após persistência até envio manual pelo gestor.

    // Auto-zoom / fitBounds disabled in emergency mode — avoid map re-centering that can trigger freeze
    useEffect(() => { /* disabled (v85 emergency reset) */ }, []);

    // Remover motoristas sem atualização há mais de 2 minutos (evita 'fantasmas')
    useEffect(() => {
        const INTERVAL = 30 * 1000; // checa a cada 30s
        const MAX_AGE = 2 * 60 * 1000; // 2 minutos
        const id = setInterval(() => {
            setFrota(prev => {
                try {
                    const now = Date.now();
                    return (prev || []).filter(m => {
                        try {
                            const last = m.ultima_atualizacao || m.ultimo_sinal || m.updated_at || m.last_seen || null;
                            if (!last) return true; // sem timestamp, mantém (conservador)
                            const t = new Date(last).getTime();
                            if (!t || Number.isNaN(t)) return true;
                            return (now - t) <= MAX_AGE;
                        } catch (e) { return true; }
                    });
                } catch (e) { return prev; }
            });
        }, INTERVAL);
        return () => clearInterval(id);
    }, []);

    // NOTE: v42 cleanup: removed automatic clearing of canSendRoute (managed manually)

    // 📡 GPS VALIDATION: carrega dados de validação para os clientes do histórico ao entrar em Nova Carga
    useEffect(() => {
        if (abaAtiva !== 'Nova Carga') return;
        const clienteNames = [...new Set((recentList || []).map(it => it.cliente).filter(Boolean))];
        if (clienteNames.length === 0) return;
        let cancelled = false;
        const fetchValidations = async () => {
            try {
                const { data, error } = await supabase
                    .from('entregas')
                    .select('id, cliente, lat, lng, lat_conclusao, lng_conclusao')
                    .eq('status', 'entregue')
                    .in('cliente', clienteNames)
                    .not('lat_conclusao', 'is', null)
                    .order('created_at', { ascending: false });
                if (cancelled || error || !data) return;
                const newMap = {};
                data.forEach(row => {
                    if (newMap[row.cliente]) return; // já processou o mais recente
                    const latO = parseFloat(row.lat);
                    const lngO = parseFloat(row.lng);
                    const latC = parseFloat(row.lat_conclusao);
                    const lngC = parseFloat(row.lng_conclusao);
                    const hasOrigem = Number.isFinite(latO) && Number.isFinite(lngO);
                    const distMetros = hasOrigem
                        ? haversineKm({ lat: latO, lng: lngO }, { lat: latC, lng: lngC }) * 1000
                        : null;
                    newMap[row.cliente] = {
                        entregaId: row.id,
                        latConclusao: latC,
                        lngConclusao: lngC,
                        distMetros,
                        validado: distMetros !== null && distMetros <= 300
                    };
                });
                setGpsValidationMap(newMap);
            } catch (e) { console.error('[GPS Validation] fetch error:', e); }
        };
        fetchValidations();
        return () => { cancelled = true; };
    }, [abaAtiva, recentList]); // eslint-disable-line react-hooks/exhaustive-deps

    // 🛠️ CORRIGIR ENDEREÇO: sobrescreve lat/lng do registro com as coordenadas reais de conclusão
    const corrigirEnderecoCliente = async (e, clienteNome, entregaId, latC, lngC) => {
        e.stopPropagation();
        try {
            const { error } = await supabase
                .from('entregas')
                .update({ lat: latC, lng: lngC })
                .eq('id', entregaId);
            if (error) throw error;
            setGpsValidationMap(prev => ({
                ...prev,
                [clienteNome]: { ...prev[clienteNome], validado: true }
            }));
        } catch (err) {
            console.error('[GPS Validation] erro ao corrigir endereço:', err);
            alert('Erro ao corrigir o endereço. Tente novamente.');
        }
    };

    // 🧠 MEMÓRIA DO MOTORISTA: verifica se já temos coordenadas exatas de conclusão para este endereço
    const buscarMemoriaDoMotorista = async (enderecoBuscado) => {
        try {
            const { data, error } = await supabase
                .from('entregas')
                .select('lat_conclusao, lng_conclusao')
                .eq('status', 'entregue')
                .ilike('endereco', `%${enderecoBuscado}%`)
                .not('lat_conclusao', 'is', null)
                .order('created_at', { ascending: false })
                .limit(1);

            if (data && data.length > 0 && data[0].lat_conclusao) {
                console.log("🧠 [MEMÓRIA] Coordenada exata recuperada do histórico!");
                return { lat: parseFloat(data[0].lat_conclusao), lng: parseFloat(data[0].lng_conclusao) };
            }
            return null;
        } catch (e) { return null; }
    };

    const adicionarAosPendentes = async (e) => {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        if (adicionando) return;
        setAdicionando(true);

        // Bloqueia apenas se o envio da rota ainda estiver em andamento
        if (isSending) {
            try { alert('A rota está sendo enviada. Aguarde a confirmação antes de adicionar novos pedidos.'); } catch (e) { }
            setAdicionando(false);
            return;
        }

        try {
            const enderecoTrim = String(enderecoEntrega || '').trim();
            console.log("🔍 Preparando endereço e buscando coordenadas para:", enderecoTrim);

            // 1) Limpeza da query para o MAPBOX (pino mais confiável)
            const enderecoLimpoParaMapa = montarQueryMapbox(enderecoTrim);

            // 2) Buscar coordenadas: primeiro tenta memória do histórico, depois Mapbox
            let coords = { lat: 0, lng: 0 };
            try {
                // 2a) Tenta a memória do motorista (lat_conclusao / lng_conclusao do histórico)
                const memoriaCoords = await buscarMemoriaDoMotorista(enderecoLimpoParaMapa);
                if (memoriaCoords) {
                    coords = memoriaCoords;
                    console.log("📍 Coordenadas recuperadas da memória do histórico:", coords);
                } else {
                    console.log("🗺️ Endereço novo. Buscando no Mapbox...");
                    const res = await buscarCoordenadas(enderecoLimpoParaMapa);
                    if (res && res.lat != null && res.lng != null) {
                        coords = { lat: Number(res.lat), lng: Number(res.lng) };
                        console.log("📍 Coordenadas encontradas para query de mapa:", enderecoLimpoParaMapa, coords, res.precisao || res.precision || null);
                        // Validação de município: alerta se resultado for fora da área de atuação
                        try {
                            const _AREAS_VALIDAS = ['palhoca', 'sao jose', 'florianopolis', 'biguacu', 'ingleses'];
                            const _displayNorm = String(res.display_name || res.place_name || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
                            if (_displayNorm && !_AREAS_VALIDAS.some(a => _displayNorm.includes(a))) {
                                alert('⚠️ Endereço fora da área de atuação!');
                            }
                        } catch (_e) { /* ignore */ }
                    } else {
                        console.warn("⚠️ Nenhuma coordenada confiável encontrada para a query do mapa. Salvando como nulo.");
                    }
                }
            } catch (err) {
                console.error("❌ Erro ao obter coordenadas:", err);
            }

            // 3) Payload puro: cliente e endereço salvos exatamente como digitados
            const nomeLimpo = String(nomeCliente || '').trim();
            const enderecoPuro = String(enderecoEntrega || '').trim();

            // Garantir que lat/lng sejam doubles e não strings ou zero/NaN
            const payload = {
                cliente: nomeLimpo,
                endereco: enderecoPuro,
                status: 'pendente',
                tipo: tipoEncomenda || 'Entrega',
                obs: observacoesGestor || '',
                lat: (Number.isFinite(coords.lat) && coords.lat !== 0) ? parseFloat(coords.lat) : null,
                lng: (Number.isFinite(coords.lng) && coords.lng !== 0) ? parseFloat(coords.lng) : null
            };

            const { data: inserted, error } = await supabase.from('entregas').insert([payload]).select();
            if (error) throw error;

            const newPedido = inserted[0];

            // ✅ PASSO 1: Atualiza a barra lateral em tempo real — adiciona o novo cliente no TOPO
            try {
                const novoRegistroHistorico = {
                    cliente: nomeLimpo,
                    endereco: enderecoPuro,
                    lat: payload.lat,
                    lng: payload.lng
                };
                setRecentList(prev => {
                    const lista = Array.isArray(prev) ? prev : [];
                    const jaExiste = lista.some(it =>
                        String(it.cliente || '').toLowerCase().trim() === nomeLimpo.toLowerCase().trim()
                    );
                    if (jaExiste) return lista;
                    return [novoRegistroHistorico, ...lista];
                });
            } catch (e) { /* ignore */ }

            // Agora que persistimos, garantir que o mapa saiba que não está limpo
            try { setMapCleared(false); } catch (e) { /* ignore */ }

            // Não atualizamos localmente o array de entregas/mapa aqui —
            // recarregamos os dados do backend para garantir consistência
            try { if (typeof carregarDados === 'function') await carregarDados(); } catch (e) { /* ignore */ }

            // Foca o mapa no novo ponto se ele for válido
            if (Number.isFinite(coords.lat) && coords.lat !== 0) {
                try { setMapFocusCoords(coords); } catch (e) { /* ignore */ }
            }

            // Limpa os campos
            setNomeCliente('');
            setEnderecoEntrega('');
            setObservacoesGestor('');

            alert('📍 Ponto cadastrado e pronto para despacho!');

        } catch (err) {
            console.error(err);
            alert('Erro ao salvar: ' + (err && err.message ? err.message : String(err)));
        } finally {
            setAdicionando(false);
        }
    };
    const excluirPedido = async (id) => {
        const parsedId = typeof id === 'string' ? parseInt(id, 10) : id;
        if (!parsedId || isNaN(parsedId)) {
            console.warn('excluirPedido: id inválido', id);
            return;
        }

        // 1. ATUALIZAÇÃO OTIMISTA: Remove o card da tela IMEDIATAMENTE (snappy feel)
        setPedidosPendentes(prev => (Array.isArray(prev) ? prev : []).filter(p => p.id !== parsedId));
        try {
            atualizarEntregasOrdenadas(prev => (Array.isArray(prev) ? prev : []).filter(p => p.id !== parsedId));
        } catch (e) { /* ignore */ }

        // 2. Apaga do banco de dados (Supabase)
        const { error } = await supabase.from('entregas').delete().eq('id', parsedId);

        // 3. Em background, garante que tudo fique sincronizado
        if (!error) {
            try { carregarDados(); } catch (e) { }
        } else {
            console.error('Erro ao excluir pedido:', error);
            // Se falhar no banco, recarrega para restaurar o card na tela
            try { carregarDados(); } catch (e) { }
        }
    };

    const dispararRota = async () => {
        if (pedidosPendentes.length === 0) return alert("⚠️ Fila vazia.");
        // Auto-selecionar o motorista ONLINE mais próximo do primeiro ponto da fila
        try {
            const first = (pedidosPendentes && pedidosPendentes.length > 0) ? pedidosPendentes[0] : null;
            if (first && first.lat != null && first.lng != null && Array.isArray(frota) && frota.length > 0) {
                // calc haversine local
                const haversineLocal = (lat1, lon1, lat2, lon2) => {
                    const R = 6371; const toRad = (d) => d * Math.PI / 180;
                    const dLat = toRad(lat2 - lat1); const dLon = toRad(lon2 - lon1);
                    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
                    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); return R * c;
                };
                let best = null; let bestDist = Infinity;
                for (const m of (frota || [])) {
                    try {
                        if (!m || (!m.lat && m.lat !== 0) || (!m.lng && m.lng !== 0)) continue;
                        const online = String(m.esta_online) === 'true' || m.esta_online === true;
                        if (!online) continue;
                        const d = haversineLocal(Number(first.lat), Number(first.lng), Number(m.lat), Number(m.lng));
                        if (d < bestDist) { bestDist = d; best = m; }
                    } catch (e) { /* ignore per-driver */ }
                }
                if (best && best.id) {
                    // Pergunta de confirmação ao gestor antes de disparar
                    try {
                        const nome = best.nome || best.title || best.name || String(best.id);
                        const confirmMsg = `Motorista ${nome} selecionado por proximidade. Confirmar?`;
                        if (!window.confirm(confirmMsg)) {
                            // usuário cancelou: não prosseguir automaticamente
                            setPodeEnviar(false);
                            return;
                        }
                    } catch (e) { /* ignore confirm issues */ }
                    // Recalcula rota já usando o motorista mais próximo (sem enviar ainda)
                    try {
                        await recalcRotaForMotorista(String(best.id));
                        return;
                    } catch (e) { console.warn('dispararRota:auto recalc failed', e); }
                }
            }
        } catch (e) { console.warn('dispararRota: auto-select failed', e); }

        // Fallback: abrir modal para seleção manual
        setPodeEnviar(false);
    };

    // Assign a selected driver: optimize route and update each entrega to 'em_rota' with motorista_id e ordem
    const assignDriver = async (driver) => {
        const selectedDriver = driver || null;
        if (!selectedDriver?.id) {
            console.error('Erro: Nenhum motorista selecionado');
            return;
        }
        const motoristaIdValRaw = selectedDriver.id;
        const motoristaIdVal = normalizeDbId(motoristaIdValRaw);
        setDispatchLoading(true);
        // mark we're performing DB updates so realtime listeners can ignore transient events
        isUpdatingRef.current = true;
        try {
            try { audioRef.current.play().catch(() => { }); } catch (e) { }
            let rotaOtimizada = [];
            try {
                try { setDistanceCalculating(true); } catch (e) { }
                rotaOtimizada = await otimizarRotaComGoogle(mapCenterState, pedidosPendentes, motoristaIdVal);
                try { setDistanceCalculating(false); } catch (e) { }
                if (!rotaOtimizada || rotaOtimizada.length === 0) rotaOtimizada = await otimizarRota(mapCenterState, pedidosPendentes, motoristaIdVal);
            } catch (e) {
                // fallback para algoritmo local em caso de erro com Google API
                rotaOtimizada = await otimizarRota(mapCenterState, pedidosPendentes, motoristaIdVal);
            }
            // Validate motorista exists in local `frota` to avoid sending wrong id
            const motoristaExists = frota && frota.find ? frota.find(m => String(m.id) === String(motoristaIdVal)) : null;
            if (!motoristaExists) console.warn('assignDriver: motorista_id não encontrado na frota local', motoristaIdVal);
            // status para despacho: 'pendente' para que o app do motorista receba
            // (muda para 'em_rota' apenas quando o motorista iniciar a viagem)
            const statusValue = 'pendente';

            // Determine entregas to dispatch and collect their IDs (preserve original type)
            const entregasParaDespachar = rotaOtimizada || []; // use rota otimizada as the set to dispatch
            const assignedIds = (entregasParaDespachar?.map(p => p.id) || []).filter(id => id !== undefined && id !== null);
            const assignedIdsStr = (assignedIds || []).map(id => String(id));

            if (assignedIds.length === 0) {
                console.warn('assignDriver: nenhum pedido válido para atualizar');
            } else {
                let updErr = null;
                try {
                    // Persist each entrega with motorista_id, status='em_rota' and ordem_logistica (per-index)
                    const promises = (rotaOtimizada || []).map((item, idx) => {
                        const pid = item && item.id;
                        if (pid === undefined || pid === null) return Promise.resolve({ skipped: true });
                        const pidNorm = Number(pid);
                        const payload = { motorista_id: String(motoristaIdValRaw), status: statusValue, ordem_logistica: Number(idx + 1) };
                        try {
                            return supabase.from('entregas').update(payload).eq('id', pidNorm);
                        } catch (e) {
                            return Promise.resolve({ error: e });
                        }
                    });
                    const results = await Promise.all(promises);
                    // detect any errors
                    for (const r of results) {
                        if (!r) continue;
                        if (r.error) { updErr = r.error; console.error('Erro Supabase:', r.error); break; }
                    }

                    if (!updErr) {
                        // Apply local state update immediately so UI reflects the change without waiting DB roundtrip
                        try {
                            const updates = (rotaOtimizada || []).map((item, idx) => ({ id: item.id, status: statusValue, ordem_logistica: Number(idx + 1), motorista_id: String(motoristaIdValRaw) }));
                            applyLocalEntregasUpdates(updates);
                        } catch (e) { /* ignore */ }

                        // Force refresh: ensure DB is reloaded and pending list cleared so Central fica limpa
                        try { await carregarDados(); } catch (e) { /* ignore */ }
                        try { setPedidosPendentes([]); } catch (e) { /* ignore */ }
                        try { routingInProgressRef.current = false; } catch (e) { /* ignore */ }

                    }
                } catch (err) {
                    updErr = err;
                    console.error('Erro ao tentar atualizar entregas (per-item):', err && err.message ? err.message : err);
                }
            }
            // ordem_logistica já foi persistida por item acima (se aplicável)
            setRotaAtiva(rotaOtimizada);
            setMotoristaDaRota(driver);
            setAbaAtiva('Visão Geral');
            await carregarDados();
            alert('Rota enviada para ' + (driver.nome || 'motorista') + ' com sucesso.');
            // Recalcular e desenhar rota otimizada para o motorista designado
            try { await recalcRotaForMotorista(String(motoristaIdValRaw)); } catch (e) { console.warn('Falha ao recalcular rota após assignDriver:', e); }
        } catch (e) {
            console.warn('Erro em assignDriver:', e);
        } finally {
            // Limpeza de estados residuais
            setShowDriverSelect(false);
            setMotoristaSelecionadoId(null);
            setDispatchLoading(false);
            isUpdatingRef.current = false;
        }
    };

    // Reorganizar rota: busca fresquinha do banco + Vizinho Mais Próximo a partir do GPS do motorista
    const handleReorganizarRota = async () => {
        setIsCalculating(true);
        try {
            // 1. Busca fresquinha do banco: garante que pedidos recém-adicionados entrem no cálculo
            const { data: entregasAtuais, error: errBusca } = await supabase
                .from('entregas')
                .select('*')
                .in('status', ['pendente', 'em_rota']);

            if (errBusca) throw errBusca;

            const pedidosValidos = (entregasAtuais || []).filter(p => p.lat && p.lng);

            if (pedidosValidos.length === 0) {
                try { alert('Nenhum pedido válido com coordenadas para organizar.'); } catch (e) { }
                setIsCalculating(false);
                return;
            }

            // 2. Ponto Zero: onde o motorista está agora?
            let atualLat = -27.5953; // Posição fallback (Central)
            let atualLng = -48.5480;

            if (motoristaSelecionadoId && frota) {
                const motorista = frota.find(m => String(m.id) === String(motoristaSelecionadoId));
                if (motorista && motorista.lat && motorista.lng) {
                    atualLat = parseFloat(motorista.lat);
                    atualLng = parseFloat(motorista.lng);
                    console.log('🚛 Motorista localizado! Recalculando a partir da posição dele.');
                } else {
                    console.warn('⚠️ Motorista sem GPS recente. Usando base da Central.');
                }
            }

            let naoVisitados = [...pedidosValidos];
            let rotaOrdenada = [];

            // 3. A mágica: recalcula TUDO baseado na distância real
            while (naoVisitados.length > 0) {
                let indiceMaisProximo = 0;
                let menorDistancia = Infinity;

                for (let i = 0; i < naoVisitados.length; i++) {
                    const latDest = parseFloat(naoVisitados[i].lat);
                    const lngDest = parseFloat(naoVisitados[i].lng);
                    // Distância geométrica
                    const dist = Math.sqrt(Math.pow(latDest - atualLat, 2) + Math.pow(lngDest - atualLng, 2));
                    if (dist < menorDistancia) {
                        menorDistancia = dist;
                        indiceMaisProximo = i;
                    }
                }

                const proximoPonto = naoVisitados.splice(indiceMaisProximo, 1)[0];
                rotaOrdenada.push(proximoPonto);
                // O motorista "anda" até esse ponto — o próximo cálculo parte daqui
                atualLat = parseFloat(proximoPonto.lat);
                atualLng = parseFloat(proximoPonto.lng);
            }

            // 4. Grava a nova ordem no banco de dados
            console.log('💾 Salvando a nova ordem no Supabase...');
            for (let i = 0; i < rotaOrdenada.length; i++) {
                const novaOrdem = i + 1; // 1, 2, 3, 4... sem duplicatas!
                await supabase
                    .from('entregas')
                    .update({ ordem_logistica: novaOrdem })
                    .eq('id', rotaOrdenada[i].id);
            }

            // 5. Recarrega a tela para o gestor ver a mágica
            if (typeof carregarDados === 'function') {
                await carregarDados();
            }

            setRotaOrdenadaState([...rotaOrdenada]);
            setRotaPronta(true);
            setPodeEnviar(true);
            try { alert('✅ Rota Inteligente atualizada! Os pedidos foram encaixados na melhor ordem.'); } catch (e) { }

        } catch (e) {
            console.error('Erro fatal ao reorganizar:', e);
            try { alert('Ocorreu um erro ao calcular as distâncias.'); } catch (er) { }
        } finally {
            setIsCalculating(false);
        }
    };

    // Seleção imediata do motorista: prioriza UUID e grava código V10 como segurança no HD
    const aoSelecionarMotorista = async (motorista) => {
        const uuidReal = motorista?.uuid || motorista?.id;
        const v10Real = motorista?.codigo_v10;

        if (!uuidReal && !v10Real) {
            try { alert('Erro: Não foi possível capturar o UUID ou o Código V10.'); } catch (e) { }
            console.error('aoSelecionarMotorista: UUID e codigo_v10 ausentes', motorista);
            return;
        }

        const valorParaGuardar = String(uuidReal || v10Real);

        // Memória blindada (HD do navegador)
        try { if (typeof window !== 'undefined' && window.localStorage) localStorage.setItem('v10_uuid_seguranca', valorParaGuardar); } catch (e) { /* ignore */ }

        // Estado e ref locais
        setMotoristaSelecionadoId(valorParaGuardar);
        try { motoristaIdRef.current = valorParaGuardar; } catch (e) { /* ignore */ }

        console.log('💾 [UUID FIXADO]:', valorParaGuardar);

        setIsCalculating(true);
        try {
            // Vincula no Supabase usando o UUID (ou fallback do v10 if UUID não estiver disponível)
            const { error } = await supabase
                .from('entregas')
                .update({ motorista_id: valorParaGuardar })
                .or('status.eq.pendente,status.eq.em_rota');

            if (error) throw error;

            setPodeEnviar(true);
            setShowDriverSelect(false);
            try { alert(`Motorista ${motorista?.nome || ''} vinculado via UUID.`); } catch (e) { }

        } catch (err) {
            console.error('Erro na seleção:', err);
            try { alert('Erro ao vincular: ' + (err && err.message ? err.message : String(err))); } catch (e) { }
        } finally {
            setIsCalculating(false);
        }
    };

    const handleEnviarRota = async () => {
        setIsSending(true);
        try {
            if (!rotaPronta || !motoristaSelecionadoId) {
                try { alert('A rota precisa estar organizada e um motorista deve estar selecionado.'); } catch (e) { }
                return;
            }

            const idsParaAtualizar = (rotaOrdenadaState || []).map(i => i && i.id).filter(Boolean);
            if (!idsParaAtualizar || idsParaAtualizar.length === 0) {
                try { alert('Nenhuma entrega válida para enviar.'); } catch (e) { }
                return;
            }

            // Indica que estamos atualizando para evitar handlers realtime conflitantes
            isUpdatingRef.current = true;

            // 1) Atualização em massa: associa motorista (UUID) e MUDA status para 'em_rota'
            // em_rota = saiu da Central de Despacho, está a caminho do motorista
            const motoristaUUID = String(motoristaSelecionadoId).trim();
            console.log('[handleEnviarRota] motorista_id UUID:', motoristaUUID, '| ids:', idsParaAtualizar);

            const { error: upErr } = await supabase
                .from('entregas')
                .update({ status: 'em_rota', motorista_id: motoristaUUID })
                .in('id', idsParaAtualizar)
                .then(({ data, error }) => {
                    if (error) alert('Erro no Banco: ' + error.message);
                    return { data, error };
                });

            if (upErr) {
                console.error('Erro Supabase:', upErr);
                throw upErr;
            }

            // 2) LIMPEZA IMEDIATA DO ESTADO LOCAL
            // Remove exatamente os itens despachados (otimista) antes do reload
            try { setEntregas(prev => (prev || []).filter(p => !idsParaAtualizar.includes(p.id))); } catch (e) { /* ignore */ }
            try { if (typeof setEntregasMap === 'function') setEntregasMap(prev => (prev || []).filter(p => !idsParaAtualizar.includes(p.id))); } catch (e) { }
            try { setRotaOrdenadaState([]); } catch (e) { }
            try { setPedidosPendentes(prev => (prev || []).filter(p => !idsParaAtualizar.includes(p.id))); } catch (e) { }
            try { setRotaPronta(false); } catch (e) { }
            try { setPodeEnviar(false); } catch (e) { }
            try { setMapCleared(true); } catch (e) { }

            // 3) Recarrega apenas PENDENTES (carregarDados já faz o filtro)
            try { await carregarDados(); } catch (e) { console.error('carregarDados pós-envio erro', e); }

            // Libera o guard do formulário agora que os dados foram recarregados
            try { setMapCleared(false); } catch (e) { }

            try { alert('✅ Rota enviada e Dashboard limpo!'); } catch (e) { }
        } catch (e) {
            console.error('Erro no envio em massa:', e);
            try { alert(JSON.stringify(e)); } catch (er) { }
        } finally {
            isUpdatingRef.current = false;
            setIsSending(false);
        }
    };

    // --- NOVA INTERFACE (AQUI ESTÁ A MUDANÇA VISUAL) ---
    const motoristas = frota || [];
    // Use explicit aprovado boolean to split lists
    const motoristasAtivos = (frota || []).filter(m => m && m.aprovado === true);
    const motoristasPendentes = (frota || []).filter(m => m && m.aprovado === false);

    // Driver modal handler removed — selection now handled inline via the header select

    // Se estivermos na página de aprovação (/aprovar), renderiza a tela exclusiva
    try {
        if (typeof window !== 'undefined' && window.location.pathname === '/aprovar') {
            return <TelaAprovacaoMotorista />;
        }
    } catch (e) { /* ignore */ }

    // Debug visual removido para evitar logs repetitivos

    // Fallback de render: se supabase não estiver inicializado, não tente renderizar o dashboard completo
    try {
        if (!supabase) {
            return <div style={{ padding: 18 }}>Carregando...</div>;
        }
    } catch (e) { /* ignore */ }

    // entrega list passed to map: mantém todos os status visíveis exceto os arquivados
    const entregasMap = useMemo(() => {
        if (!entregas) return [];

        // Filtramos para tirar APENAS o que não deve ir para o mapa de jeito nenhum
        return entregas
            .filter(item => {
                const s = String(item && item.status || '').trim().toLowerCase();
                return s !== 'arquivado' && s !== 'cancelado';
            })
            .map(item => ({
                ...item,
                lat: item.lat == null ? item.lat : parseFloat(item.lat),
                lng: item.lng == null ? item.lng : parseFloat(item.lng)
            }));
    }, [entregas]); // Removido o motoristaDaRota da dependência para os pinos não sumirem ao trocar a seleção
    // Diagnostic: show first pin data to help debug render issues (lat/lng types)
    try { console.log('📌 Teste de renderização - Primeiro pino (entregasMap[0]):', entregasMap && entregasMap.length ? entregasMap[0] : null); } catch (e) { }

    const appContent = (
        <div style={{ minHeight: '100vh', width: '100vw', overflowX: 'hidden', margin: 0, padding: 0, backgroundColor: '#071228', fontFamily: "'Inter', sans-serif", color: theme.textMain }}>

            {/* 1. HEADER SUPERIOR (NAVBAR) */}
            <header style={{
                backgroundColor: theme.headerBg,
                color: theme.headerText,
                padding: '0 40px',
                height: '70px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                zIndex: 1300
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{ width: '56px', height: '56px', background: 'linear-gradient(135deg,#1E3A8A,#3B82F6)', borderRadius: '10px', display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#ffffff', fontWeight: 800, fontSize: '18px', boxShadow: '0 4px 12px rgba(0,0,0,0.25)' }}>V10</div>
                        <h2 className="dashboard-title" style={{ margin: 0, fontSize: '20px', fontFamily: "Inter, Roboto, sans-serif", background: 'linear-gradient(to right, #3B82F6, #FFFFFF)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>DASHBOARD</h2>
                    </div>

                    <nav style={{ display: 'flex', gap: '8px' }}>
                        {['Visão Geral', 'Nova Carga', 'Central de Despacho', 'Equipe', 'Gestão de Motoristas'].map(tab => (
                            <button key={tab} onClick={() => setAbaAtiva(tab)} style={{
                                padding: '10px 18px',
                                background: abaAtiva === tab ? 'rgba(255,255,255,0.1)' : 'transparent',
                                border: abaAtiva === tab ? `1px solid ${theme.primary}` : '1px solid transparent',
                                color: abaAtiva === tab ? theme.primary : '#94a3b8', // Texto colorido quando ativo
                                borderRadius: '20px',
                                cursor: 'pointer',
                                fontWeight: '600',
                                fontSize: '14px',
                                transition: '0.18s'
                            }}>
                                {tab.toUpperCase()}
                            </button>
                        ))}
                    </nav>
                </div>

                <div style={{ flex: 1 }} />

                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ textAlign: 'right', fontSize: '12px' }}>
                        <div style={{ color: theme.success, fontWeight: 'bold' }}>● SISTEMA ONLINE - {motoristaCidade || gestorLocation}</div>
                        <div style={{ opacity: 0.6 }}>Contato: 5548996525008</div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <button onClick={() => setDarkMode(d => !d)} style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)', background: 'transparent', color: theme.headerText, cursor: 'pointer' }}>{darkMode ? 'Modo Claro' : 'Modo Escuro'}</button>
                        <div style={{ color: theme.headerText, fontWeight: 700, marginLeft: '8px' }}>Gestor: Administrador</div>
                        <button type="button" onClick={async (e) => {
                            try { if (e && typeof e.preventDefault === 'function') e.preventDefault(); } catch (err) { }
                            try {
                                // Attempt to clear motorista coordinates BEFORE signOut (if a user session exists)
                                try {
                                    let userId = null;
                                    if (supabase && supabase.auth && typeof supabase.auth.getSession === 'function') {
                                        try {
                                            const sres = await supabase.auth.getSession();
                                            userId = sres?.data?.session?.user?.id || null;
                                        } catch (err) { userId = null; }
                                    }
                                    if (userId) {
                                        const { data: updData, error: updErr } = await supabase.from('motoristas').update({ latitude: null, longitude: null, lat: null, lng: null, ultima_atualizacao: new Date() }).eq('id', userId).select();
                                        if (updErr) {
                                            console.error('Erro ao limpar localização do motorista antes do signOut', updErr);
                                            return; // Não prosseguir com signOut se o update falhar para este user
                                        }
                                    }
                                } catch (err) {
                                    console.error('Falha ao tentar limpar localização antes do signOut', err);
                                }

                                // Sign out from Supabase
                                try { await supabase.auth.signOut(); } catch (e) { console.error('signOut failed', e); }

                                // Clear local/session storage to forget gestor identity
                                try { if (typeof window !== 'undefined' && window.localStorage) window.localStorage.clear(); } catch (err) { }
                                try { if (typeof window !== 'undefined' && window.sessionStorage) window.sessionStorage.clear(); } catch (err) { }

                                // Replace page with final message so user cannot see the app anymore
                                try {
                                    if (typeof document !== 'undefined' && document.body) {
                                        document.title = 'Sessão Encerrada';
                                        document.body.innerHTML = '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#071228;color:#fff;font-family:Inter, sans-serif;"><div style="text-align:center;padding:24px"><h1 style="font-size:20px;margin-bottom:12px">Sessão Encerrada</h1><p style="opacity:0.9">Sessão Encerrada. Feche esta aba.</p></div></div>';
                                    } else if (typeof window !== 'undefined') {
                                        try { window.location.href = 'about:blank'; } catch (err) { /* ignore */ }
                                    }
                                } catch (err) { try { window.location.href = 'about:blank'; } catch (e) { /* ignore */ } }
                            } catch (e) {
                                console.error('Erro no processo de logout', e);
                                try { window.location.href = 'about:blank'; } catch (err) { /* ignore */ }
                            }
                        }} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)', background: 'transparent', color: theme.headerText, cursor: 'pointer', fontWeight: 700 }}>Sair</button>
                    </div>
                </div>
            </header>

            {/* Google quota banner removed (project uses Mapbox/Leaflet) */}

            {/* Badge fixo removido — manter apenas o cabeçalho superior direito */}

            {/* 2. ÁREA DE CONTEÚDO */}


            <main style={{ maxWidth: '1450px', width: '95%', margin: '140px auto 0', padding: '0 20px' }}>

                {/* 3. KPIS (ESTATÍSTICAS RÁPIDAS) - Aparecem em todas as telas */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginBottom: '30px' }}>
                    <CardKPI titulo="TOTAL DE ENTREGAS" valor={pedidosPendentes.length} cor={theme.accent} />
                    <CardKPI titulo="MOTORISTAS ONLINE" valor={frota.filter(m => m.esta_online === true).length} cor={theme.success} />
                    <CardKPI titulo="ROTA ATIVA" valor={rotaAtiva.length > 0 ? 'EM ANDAMENTO' : 'AGUARDANDO'} cor={theme.primary} />
                </div>

                {/* VISÃO GERAL (DASHBOARD) */}
                {abaAtiva === 'Visão Geral' && (
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '30px' }}>

                        {/* MAPA EM CARD (DIMINUÍDO, REDIMENSIONÁVEL E ELEGANTE) */}
                        <div ref={mapContainerRef} style={{ background: theme.card, borderRadius: '16px', padding: '10px', boxShadow: theme.shadow, height: '500px', resize: 'vertical', overflow: 'hidden', minHeight: '450px', maxHeight: '800px', position: 'relative' }}>
                            <div style={{ height: '100%', borderRadius: '12px', overflow: 'hidden', position: 'relative' }}>
                                {
                                    // Render Leaflet-based map via MapaLogistica (no Google API dependencies)
                                    (
                                        <ErrorBoundary>
                                            <MapaLogistica darkMode={darkMode} clearMap={false} entregas={entregaMarkers} frota={frota} height={500} mobile={false} motoristaDaRota={motoristaDaRota} runtimePolylines={runtimePolylines} rotaCoordenadas={rotaCoordenadas} rotaOrdenadaState={rotaOrdenadaState} />
                                        </ErrorBoundary>
                                    )
                                }

                                {/* Map controls consolidated: single `BotoesMapa` is rendered INSIDE the <Map> */}

                                {/* Floating refresh button removed; use single `BotoesMapa` inside the <Map> */}

                                {/* Resize handle indicator */}
                                <div style={{ position: 'absolute', bottom: 8, right: 12, width: 36, height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 6, cursor: 'ns-resize', display: 'inline-block', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.02)' }} title="Arraste para redimensionar a altura do mapa" />

                            </div>
                        </div>

                        {/* INFO LATERAL */}
                        <div style={{ background: theme.card, borderRadius: '16px', padding: '18px', boxShadow: theme.shadow, height: '500px', display: 'flex', flexDirection: 'column', position: 'relative' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', marginBottom: 8, gap: 8 }}>
                                <button onClick={() => limparMarcadores()} style={{ padding: '10px', background: 'rgba(15,23,42,0.85)', color: '#fff', borderRadius: 10, border: '1px solid rgba(255,255,255,0.12)', cursor: 'pointer', fontWeight: 800 }} title="Limpar Mapa">🧹 Limpar Mapa</button>
                                <button
                                    onClick={() => {
                                        try {
                                            if (!entregasMap || entregasMap.length === 0) {
                                                alert('O mapa está limpo. Não há pontos ou rotas para recarregar no momento.');
                                                return;
                                            }
                                        } catch (e) {
                                            console.warn('Verificação de pontos do mapa falhou', e);
                                        }

                                        // lógica original de recarregar
                                        try {
                                            if (typeof carregarDados === 'function') carregarDados({ forceAll: true });
                                            alert('Pontos recarregados e atualizados com sucesso!');
                                        } catch (e) {
                                            console.warn('Falha ao recarregar o mapa', e);
                                        }
                                    }}
                                    style={{ padding: '10px', background: '#0b6b4a', color: '#fff', borderRadius: 10, border: '1px solid rgba(0,0,0,0.12)', cursor: 'pointer', fontWeight: 800 }}
                                    title="Recarregar Mapa"
                                >🔄 Recarregar Mapa</button>
                            </div>
                            <h3 style={{ marginTop: 20, color: theme.textMain }}>Status da Operação</h3>
                            {motoristaDaRota ? (
                                <div>
                                    <div style={{ padding: '15px', background: '#e0e7ff', borderRadius: '12px', marginBottom: '20px', color: theme.primary }}>
                                        <strong>🚛 Motorista:</strong> {motoristaDaRota.nome}<br />
                                        <strong>🔌 Status:</strong> {motoristaDaRota.esta_online === true ? 'Online' : 'Offline'}
                                        {motoristaDaRota.lat && motoristaDaRota.lng && (
                                            <div>
                                                <strong>📍</strong> {motoristaCidade ? `Localização: ${motoristaCidade}` : (motoristaDaRota.lat.toFixed ? `${motoristaDaRota.lat.toFixed(4)}, ${motoristaDaRota.lng.toFixed(4)}` : `${motoristaDaRota.lat}, ${motoristaDaRota.lng}`)}
                                            </div>
                                        )}
                                    </div>
                                    <h4 style={{ margin: '10px 0' }}>Próximas Entregas:</h4>
                                    <div style={{ flex: 1, overflowY: 'auto' }}>
                                        <ul style={{ paddingLeft: '20px', fontSize: '14px', color: theme.textMain, margin: 0 }}>
                                            {rotaAtiva?.map((p, i) => {
                                                const tipo = String(p.tipo || '').trim().toLowerCase();
                                                const color = tipo === 'recolha' ? '#fb923c' : (tipo === 'outros' || tipo === 'outro' ? '#c084fc' : '#60a5fa');
                                                return (
                                                    <li key={p.id} style={{ marginBottom: '8px', display: 'flex', gap: '8px', alignItems: 'baseline' }}>
                                                        <strong style={{ marginRight: '6px', color: theme.textLight }}>{(p.ordem_logistica != null && Number.isFinite(Number(p.ordem_logistica)) && Number(p.ordem_logistica) > 0) ? Number(p.ordem_logistica) : (i + 1)}.</strong>
                                                        <span style={{ color, fontWeight: 600 }}>{p.cliente}</span>
                                                    </li>
                                                );
                                            })}
                                        </ul>
                                    </div>
                                </div>
                            ) : (
                                <p style={{ color: theme.textLight }}>Nenhuma rota despachada no momento.</p>
                            )}
                            {/* Avisos removidos da Visão Geral — comunicação centralizada em 'Equipe' */}
                        </div>
                    </div>
                )}

                {/* NOVA CARGA */}
                {abaAtiva === 'Nova Carga' && (
                    <div style={{ display: 'flex', gap: '24px', background: 'transparent', alignItems: 'stretch' }}>
                        {/* Coluna Esquerda: Formulário */}
                        <div style={{ flex: '0 0 48%', background: theme.card, padding: '28px', borderRadius: '12px', boxShadow: theme.shadow }}>
                            <h2 style={{ marginTop: 0, color: theme.primary }}>Registrar Encomenda</h2>
                            <form autoComplete="off" onSubmit={adicionarAosPendentes} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                                <label style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                    <span style={{ fontSize: '13px', color: theme.textLight }}>Tipo:</span>
                                    <select name="tipo" value={tipoEncomenda} onChange={(e) => setTipoEncomenda(e.target.value)} style={{ padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1' }}>
                                        <option>Entrega</option>
                                        <option>Recolha</option>
                                        <option>Outros</option>
                                    </select>
                                </label>
                                <input ref={clienteInputRef} name="cliente" placeholder="Nome do Cliente" style={inputStyle} required value={nomeCliente} onChange={(e) => setNomeCliente(e.target.value)} />
                                <div style={{ position: 'relative' }}>
                                    <div style={{ width: '93% !important', boxSizing: 'border-box' }}>
                                        <input
                                            type="text"
                                            name="endereco"
                                            placeholder="Ex: Rua Lauro Bechtold, 147, Centro - Palhoça"
                                            value={enderecoEntrega}
                                            onChange={(e) => { setEnderecoEntrega(e.target.value); setEnderecoGeocodeNotFound(false); }}
                                            className="v10-mapbox-search-input"
                                            style={{ ...inputStyle, border: inputEnderecoInvalid ? '1px solid #ef4444' : '1px solid #cbd5e1' }}
                                        />
                                        <div style={{ marginTop: 8, fontSize: 12, color: '#94a3b8' }}>Exemplo ideal: Rua Dom Pedro II, 176, Campinas, São José, SC</div>
                                        {enderecoGeocodeNotFound && (
                                            <div style={{ marginTop: 8, color: '#f59e0b', fontSize: 13 }}>⚠️ Endereço não encontrado! Melhore sua digitação ou siga o padrão: Rua, Número, Bairro, Cidade.</div>
                                        )}
                                    </div>
                                </div>
                                <textarea name="obs" placeholder="Observações do Gestor (ex: Cuidado com o cachorro)" value={observacoesGestor} onChange={(e) => setObservacoesGestor(e.target.value)} style={{ ...inputStyle, minHeight: '92px', resize: 'vertical', width: '95% !important', boxSizing: 'border-box' }} />
                                {/* Disable add if address has no number */}
                                <button
                                    type="submit"
                                    disabled={adicionando || !!duplicateTipoMsg || !(/\d/.test(enderecoEntrega || ''))}
                                    style={{
                                        ...btnStyle(theme.primary),
                                        opacity: adicionando || duplicateTipoMsg ? 0.6 : (/\d/.test(enderecoEntrega || '') ? 1 : 0.5),
                                        cursor: adicionando || !!duplicateTipoMsg || !(/\d/.test(enderecoEntrega || '')) ? 'not-allowed' : 'pointer'
                                    }}
                                >
                                    {adicionando ? 'Salvando...' : 'ADICIONAR À LISTA'}
                                </button>
                                {duplicateTipoMsg && <div style={{ marginTop: 8, fontSize: 13, color: '#f97316' }}>{duplicateTipoMsg}</div>}
                                {!(/\d/.test(enderecoEntrega || '')) && <div style={{ marginTop: 8, fontSize: 12, color: '#f97316' }}>Endereço precisa conter um número para salvar automaticamente.</div>}
                            </form>
                        </div>

                        {/* Coluna Direita: Histórico (scroll) */}
                        <div className="v10-history-panel" style={{ flex: '1 1 0', minWidth: 0, background: theme.card, padding: '18px', borderRadius: '12px', boxShadow: theme.shadow, display: 'flex', flexDirection: 'column', alignSelf: 'stretch' }}>
                            {/* CSS específico para forçar alinhamento e larguras do painel de histórico (v156) */}
                            <style>{`
                                .v10-history-panel{ position:relative; max-width:none !important; width:100% !important; padding-right:12px !important; box-sizing:border-box; }
                                .v10-history-controls{ display:flex; width:100% !important; gap:10px; align-items:center; }
                                .v10-history-input{ flex:1 1 auto !important; min-width:0 !important; width:100% !important; padding-right:56px !important; }
                                .v10-history-trash{ position:absolute !important; top:12px !important; right:12px !important; width:40px !important; height:40px !important; display:flex !important; align-items:center !important; justify-content:center !important; cursor:pointer !important; background:transparent !important; border:none !important; }
                                .v10-history-list{ overflow-y:auto; max-height:420px; padding-right:6px; margin-top:0; flex:1; min-height:0; }
                                .v10-history-card{ width:100% !important; box-sizing:border-box; padding:12px; border-radius:8px; margin-bottom:10px; cursor:pointer; background: rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.06); transition: background 160ms ease, box-shadow 160ms ease; overflow:hidden; }
                                .v10-history-card:hover{ background: rgba(255,255,255,0.08); box-shadow:0 6px 18px rgba(0,0,0,0.25); }
                                .v10-history-card .title, .v10-history-card .addr{ overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
                            `}</style>

                            <div>
                                <h3 style={{ marginTop: 0, color: theme.textMain, marginBottom: 6 }}>Histórico de Clientes</h3>
                                <div style={{ color: theme.textLight, fontSize: '13px', marginBottom: 8 }}>Clique para preencher o formulário à esquerda</div>

                                {/* Linha de controle (busca + lixeira) */}
                                <div className="v10-history-controls" style={{ marginBottom: 8 }}>
                                    <input
                                        className="v10-history-input"
                                        aria-label="Buscar histórico"
                                        value={historyFilter || ''}
                                        onChange={(e) => setHistoryFilter(e.target.value)}
                                        placeholder="Pesquisar..."
                                        style={{ background: theme.card, color: theme.textMain, border: '1px solid rgba(255,255,255,0.06)', padding: '8px 12px', borderRadius: 10, outline: 'none', boxSizing: 'border-box' }}
                                    />
                                    {/* input file oculto */}
                                    <input ref={fileInputRef} style={{ display: 'none' }} type="file" accept=".csv" onChange={(e) => { try { const f = e.target.files && e.target.files[0]; if (f) handleImportarCSV(f); e.target.value = null; } catch (err) { console.error(err); } }} />
                                    <button
                                        className="v10-history-import"
                                        title="Importar histórico (CSV)"
                                        onClick={() => { try { if (fileInputRef && fileInputRef.current) fileInputRef.current.click(); } catch (e) { console.error(e); } }}
                                        style={{ marginRight: 8, width: 40, height: 40, borderRadius: 8, background: 'transparent', border: 'none', cursor: 'pointer' }}
                                    >
                                        📁
                                    </button>
                                    <button
                                        className="v10-history-trash"
                                        title="Limpar histórico (local)"
                                        onClick={() => {
                                            try {
                                                const ok = window.confirm('Deseja apagar todo o histórico de endereços?');
                                                if (!ok) return;
                                                setRecentList([]);
                                                setHistoryFilter('');
                                            } catch (e) { }
                                        }}
                                    >
                                        🗑️
                                    </button>
                                </div>

                            </div>
                            <div className="v10-history-list">
                                {(!filteredRecentList || filteredRecentList.length === 0) ? (
                                    <div style={{ color: theme.textLight, padding: '12px' }}>Nenhum histórico disponível.</div>
                                ) : (
                                    (filteredRecentList || []).map((it, idx) => {
                                        const gpsInfo = gpsValidationMap[it.cliente];
                                        const precisaCorrecao = gpsInfo && !gpsInfo.validado && gpsInfo.distMetros !== null && gpsInfo.distMetros > 300;
                                        const foiValidado = gpsInfo && gpsInfo.validado;
                                        return (
                                            <div key={idx}
                                                className="v10-history-card"
                                                onClick={async () => {
                                                    try {
                                                        setNomeCliente(it.cliente || '');
                                                        setEnderecoEntrega(it.endereco || '');
                                                    } catch (e) { }
                                                }}
                                            >
                                                <div className="title" style={{ fontWeight: 700, color: theme.textMain }}>{it.cliente}</div>
                                                <div className="addr" style={{ fontSize: '13px', color: theme.textLight }}>{it.endereco}</div>
                                                {precisaCorrecao && (
                                                    <button
                                                        onClick={(e) => corrigirEnderecoCliente(e, it.cliente, gpsInfo.entregaId, gpsInfo.latConclusao, gpsInfo.lngConclusao)}
                                                        style={{
                                                            marginTop: 8,
                                                            padding: '5px 11px',
                                                            borderRadius: 6,
                                                            background: '#f97316',
                                                            border: 'none',
                                                            color: '#fff',
                                                            fontSize: 12,
                                                            fontWeight: 700,
                                                            cursor: 'pointer',
                                                            display: 'inline-flex',
                                                            alignItems: 'center',
                                                            gap: 4
                                                        }}
                                                        title={`GPS real desviou ${Math.round(gpsInfo.distMetros)}m do endereço registrado`}
                                                    >
                                                        ⚠️ Corrigir Endereço
                                                    </button>
                                                )}
                                                {foiValidado && (
                                                    <div style={{ marginTop: 8, fontSize: 12, color: '#22c55e', fontWeight: 600 }}>✅ Validado</div>
                                                )}
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* CENTRAL DE DESPACHO */}
                {abaAtiva === 'Central de Despacho' && (
                    <div style={{ background: theme.card, padding: '30px', borderRadius: '16px', boxShadow: theme.shadow }}>
                        <style>{`
                        .v10-driver-select{ -webkit-appearance:none; -moz-appearance:none; appearance:none; width:200px; max-width:160px; height:56px; padding:0 16px; border-radius:12px; background-color:#374151; color:#ffffff; font-weight:800 !important; font-size:1.25rem !important; border:2px solid #3b82f6; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='white'><path d='M5.23 7.21a.75.75 0 011.06.02L10 10.939l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z'/></svg>"); background-repeat:no-repeat; background-position: right 12px center; background-size:18px; box-sizing:border-box; cursor:pointer; }
                        .v10-driver-select:focus{ outline:none; box-shadow:0 0 0 4px rgba(59,130,246,0.12); border-color:#60a5fa; }
                        .v10-driver-select option{ font-weight:800; font-size:1rem; }
                        `}</style>
                        {/* --- INÍCIO DO CABEÇALHO (DIVIDIDO EM DUAS LINHAS) --- */}
                        <div style={{ display: 'flex', flexDirection: 'column', width: '100%', marginBottom: '32px', paddingBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>

                            {/* LINHA SUPERIOR: Seletor (Esquerda) e Título (Centro) */}
                            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginBottom: '24px' }}>

                                {/* Esquerda: Seletor de Motorista */}
                                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, alignItems: 'flex-start' }}>
                                    <label style={{ color: theme.textLight, fontWeight: '700', marginBottom: '6px', fontSize: '14px' }}>Selecionar Motorista:</label>
                                    <select
                                        value={motoristaSelecionadoId || ''}
                                        onChange={(e) => { setMotoristaSelecionadoId((e.target.value || '').trim() || null); setPodeEnviar(false); }}
                                        className="v10-driver-select"
                                        style={{ height: '48px', fontSize: '15px', cursor: 'pointer', width: '220px' }}
                                    >
                                        <option value="">Selecione...</option>
                                        {(frota || []).filter(m => m && (m.esta_online === true || String(m.esta_online) === 'true')).map(m => (
                                            <option key={m.id} value={String(m.uuid || m.id).trim()}>{m.nome}</option>
                                        ))}
                                    </select>
                                </div>

                                {/* Centro: Título */}
                                <div style={{ display: 'flex', flex: 1, justifyContent: 'center' }}>
                                    <h2 style={{ margin: 0, color: theme.textMain, fontSize: '24px', fontWeight: 800 }}>Fila de Preparação</h2>
                                </div>

                                {/* Direita: Vazio (Apenas para empurrar o título perfeitamente para o centro) */}
                                <div style={{ flex: 1 }}></div>
                            </div>

                            {/* LINHA INFERIOR: Distância (Esquerda) e Botões (Direita) */}
                            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', width: '100%' }}>

                                {/* Esquerda: Distância Estimada */}
                                <div style={{ color: theme.textLight, fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px', whiteSpace: 'nowrap' }}>
                                    <span>Distância Estimada:</span>
                                    <span style={{ color: theme.primary, fontSize: '16px' }}>
                                        {estimatedDistanceKm ? `${estimatedDistanceKm} KM` : (distanceCalculating ? 'Calculando...' : 'Pronto')}
                                    </span>
                                    <button title="Histórico de otimizações" onClick={() => setShowLogsPopover(s => !s)} style={{ background: 'transparent', border: 'none', color: theme.textLight, cursor: 'pointer', fontSize: '18px', marginLeft: '4px' }}>📜</button>

                                    {showLogsPopover && (
                                        <div style={{ position: 'absolute', left: '40px', top: '180px', background: theme.card, color: theme.textMain, padding: '15px', borderRadius: '8px', boxShadow: theme.shadow, width: '320px', zIndex: 2200, border: '1px solid rgba(255,255,255,0.1)' }}>
                                            <div style={{ fontWeight: 700, marginBottom: '8px' }}>Últimas otimizações</div>
                                            {logsHistory?.length === 0 ? <div style={{ color: theme.textLight }}>Nenhum registro recente.</div> : (
                                                logsHistory?.map((l, i) => (
                                                    <div key={i} style={{ padding: '8px 0', borderBottom: i < (logsHistory?.length || 0) - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
                                                        <div style={{ fontSize: '12px', color: theme.textLight }}>{new Date(l.created_at).toLocaleString()}</div>
                                                        <div style={{ fontSize: '13px', fontWeight: 700 }}>{(l.distancia_nova != null) ? `${l.distancia_nova} KM` : '—'} • {l.nova_ordem ? l.nova_ordem.join(', ') : '—'}</div>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* Direita: Botões */}
                                <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '24px' }}>
                                    <button
                                        onClick={handleReorganizarRota}
                                        disabled={isCalculating}
                                        style={{
                                            backgroundColor: '#fbbf24',
                                            color: '#000',
                                            padding: '14px 28px',
                                            borderRadius: '8px',
                                            border: 'none',
                                            fontWeight: '800',
                                            fontSize: '14px',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            whiteSpace: 'nowrap',
                                            boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
                                        }}
                                    >
                                        {isCalculating ? 'Processando...' : '🔄 REORGANIZAR ROTA'}
                                        {pendingRecalcCount > 0 && (
                                            <span style={{ marginLeft: '8px', background: '#ef4444', color: '#fff', borderRadius: '10px', padding: '2px 8px', fontSize: '12px', fontWeight: 700 }}>{pendingRecalcCount}</span>
                                        )}
                                    </button>

                                    <button
                                        disabled={!(podeEnviar && rotaPronta && motoristaSelecionadoId)}
                                        onClick={(e) => { handleEnviarRota(e); }}
                                        style={{
                                            backgroundColor: (podeEnviar && rotaPronta && motoristaSelecionadoId) ? '#16a34a' : '#4b5563',
                                            color: 'white',
                                            cursor: (podeEnviar && rotaPronta && motoristaSelecionadoId) ? 'pointer' : 'not-allowed',
                                            padding: '14px 28px',
                                            borderRadius: '8px',
                                            border: 'none',
                                            fontWeight: 'bold',
                                            fontSize: '14px',
                                            opacity: (podeEnviar && rotaPronta && motoristaSelecionadoId) ? 1 : 0.6,
                                            whiteSpace: 'nowrap',
                                            boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
                                        }}
                                    >
                                        {isSending ? "ENVIANDO..." : "ENVIAR ROTA"}
                                    </button>
                                </div>

                            </div>

                        </div>
                        {/* --- FIM DO CABEÇALHO --- */}
                        {/* BOTÃO COPIAR TUDO */}
                        {pedidosPendentes && pedidosPendentes.length > 0 && (
                            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px', position: 'relative' }}>
                                {toastCopiarTudo && (
                                    <span style={{ position: 'absolute', top: '-32px', right: 0, background: '#16a34a', color: '#fff', padding: '4px 14px', borderRadius: '20px', fontSize: '13px', fontWeight: 700, boxShadow: '0 2px 8px rgba(0,0,0,0.2)' }}>
                                        ✅ Todos os cards copiados!
                                    </span>
                                )}
                                <button
                                    onClick={() => {
                                        const ativos = (pedidosPendentes || []).filter(e => {
                                            const s = String(e.status || '').trim().toLowerCase();
                                            return s === 'pendente' || s === 'adicionado';
                                        }).sort((a, b) => {
                                            const orA = Number(a.ordem_logistica) > 0 ? Number(a.ordem_logistica) : 999;
                                            const orB = Number(b.ordem_logistica) > 0 ? Number(b.ordem_logistica) : 999;
                                            return orA - orB;
                                        });
                                        const blocos = ativos.map(p => {
                                            const tipoLower = String(p.tipo || 'entrega').toLowerCase().trim();
                                            const titulo = tipoLower === 'recolha'
                                                ? '*RECOLHA*'
                                                : tipoLower === 'outros'
                                                    ? '*OUTROS/ATAS*'
                                                    : '*ENTREGA*';
                                            const obs = p.obs || p.observacoes || 'Sem observa\u00e7\u00f5es';
                                            return `${titulo}\n*CLIENTE:* ${p.cliente || ''}\n*ENDERE\u00c7O:* ${p.endereco || ''}\n*OBS:* ${obs}`;
                                        });
                                        const texto = blocos.join('\n---------------------------\n');
                                        navigator.clipboard.writeText(texto).catch(() => { });
                                        window.open('https://wa.me/?text=' + encodeURIComponent(texto), '_blank', 'noopener');
                                        setToastCopiarTudo(true);
                                        setTimeout(() => setToastCopiarTudo(false), 2500);
                                    }}
                                    style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px 20px', fontWeight: 700, fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }}
                                >
                                    📋 Copiar Todos os Dados
                                </button>
                            </div>
                        )}
                        {(!pedidosPendentes || pedidosPendentes.length === 0) ? <p style={{ textAlign: 'center', color: theme.textLight }}>Tudo limpo! Sem pendências.</p> : (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px' }}>
                                {pedidosPendentes
                                    ?.filter(e => {
                                        const s = String(e.status || '').trim().toLowerCase();
                                        // Central mostra apenas pendente (em_rota = já despachado ao motorista)
                                        return s === 'pendente' || s === 'adicionado';
                                    })
                                    // 🛡️ Ordena do 1 ao X. Quem não tem número vai lá pro final (999)
                                    .sort((a, b) => {
                                        const ordemA = (Number(a.ordem_logistica) > 0) ? Number(a.ordem_logistica) : 999;
                                        const ordemB = (Number(b.ordem_logistica) > 0) ? Number(b.ordem_logistica) : 999;
                                        return ordemA - ordemB;
                                    })
                                    .map((p, index) => {
                                        const tipo = p.tipo || 'Entrega';
                                        const tipoColor = getColorForType(tipo);
                                        const contrast = getContrastText(tipoColor);

                                        // 🛡️ FORÇA A CONVERSÃO: Transforma qualquer lixo que vier do banco em número
                                        const valorOrdem = Number(p.ordem_logistica);
                                        // A TRAVA BLINDADA: Se for maior que zero, usa ele. Se for 0, nulo ou NaN, usa a fila (index + 1)
                                        const numeroVisual = (valorOrdem > 0) ? valorOrdem : (index + 1);

                                        return (
                                            <div key={p.id} style={{ border: `1px solid ${tipoColor}`, padding: '20px', borderRadius: '12px', borderLeft: `6px solid ${tipoColor}`, background: theme.card }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                                        <div style={{ width: 36, height: 36, borderRadius: '50%', background: theme.primary, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>{numeroVisual}</div>
                                                        <h4 style={{ margin: '0 0 5px 0' }}>{p.cliente}</h4>
                                                    </div>
                                                    <span style={{ fontSize: '12px', padding: '6px 10px', borderRadius: '12px', background: tipoColor, color: contrast, fontWeight: 700 }}>{tipo}</span>
                                                </div>
                                                <p style={{ fontSize: '13px', color: theme.textLight, margin: '4px 0' }}>📍 {p.endereco} {(!(p.lat && p.lng)) && <span title="Sem coordenadas: não participará da roteirização automática" style={{ color: '#f59e0b', marginLeft: 8 }}>⚠️ Sem coords</span>}</p>
                                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, margin: '6px 0', flexWrap: 'wrap' }}>
                                                    <span style={{ fontSize: '13px', fontWeight: 700, color: '#FF8C00', whiteSpace: 'nowrap' }}>Obs:</span>
                                                    <span style={{ fontSize: '13px', fontWeight: 700, color: '#FF8C00', flex: 1, wordBreak: 'break-word', minWidth: 0 }}>
                                                        {p.obs || p.observacoes || 'Sem observações'}
                                                    </span>
                                                    <button
                                                        title="Editar observação"
                                                        onClick={async () => {
                                                            const atual = p.obs || p.observacoes || '';
                                                            const nova = window.prompt('Editar observação:', atual);
                                                            if (nova === null) return;
                                                            const obsAtualizada = nova.trim();
                                                            try {
                                                                await supabase.from('entregas').update({ obs: obsAtualizada }).eq('id', p.id);
                                                                setPedidosPendentes(prev => (prev || []).map(item =>
                                                                    item.id === p.id ? { ...item, obs: obsAtualizada } : item
                                                                ));
                                                            } catch (e) {
                                                                alert('Erro ao salvar observação: ' + (e && e.message ? e.message : String(e)));
                                                            }
                                                        }}
                                                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', padding: '2px 4px', color: '#FF8C00', lineHeight: 1, flexShrink: 0 }}
                                                    >🖊️</button>
                                                    <button
                                                        title="Copiar para WhatsApp"
                                                        onClick={() => {
                                                            const tipoLower = String(p.tipo || 'entrega').toLowerCase().trim();
                                                            const tituloCopia = tipoLower === 'recolha'
                                                                ? '*RECOLHA*'
                                                                : tipoLower === 'outros'
                                                                    ? '*OUTROS/ATAS*'
                                                                    : '*ENTREGA*';
                                                            const obsTexto = p.obs || p.observacoes || 'Sem observa\u00e7\u00f5es';
                                                            const texto =
                                                                `${tituloCopia}\n` +
                                                                `*CLIENTE:* ${p.cliente || ''}\n` +
                                                                `*ENDERE\u00c7O:* ${p.endereco || ''}\n` +
                                                                `*OBS:* ${obsTexto}`;
                                                            navigator.clipboard.writeText(texto).catch(() => { });
                                                            window.open('https://wa.me/?text=' + encodeURIComponent(texto), '_blank', 'noopener');
                                                            setCardCopiado(p.id);
                                                            setTimeout(() => setCardCopiado(null), 2000);
                                                        }}
                                                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', padding: '2px 4px', color: cardCopiado === p.id ? '#22c55e' : '#FF8C00', lineHeight: 1, flexShrink: 0, transition: 'color 0.2s' }}
                                                    >{cardCopiado === p.id ? '✅' : '📋'}</button>
                                                </div>
                                                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                                                    <button onClick={() => excluirPedido(p.id)} style={{ background: 'none', border: 'none', color: theme.danger, cursor: 'pointer', fontSize: '12px' }}>Remover</button>
                                                    {(p.lat && p.lng) ? (
                                                        <button onClick={() => { try { window.open('https://www.google.com/maps/dir/?api=1&destination=' + Number(p.lat) + ',' + Number(p.lng), '_blank', 'noopener'); } catch (e) { } }} style={{ background: '#0ea5e9', border: 'none', color: '#fff', padding: '6px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>Navegar</button>
                                                    ) : null}
                                                </div>
                                            </div>
                                        );
                                    })}
                            </div>
                        )}
                    </div>
                )}

                {/* EQUIPE (FROTA) */}
                {abaAtiva === 'Equipe' && (
                    <div style={{ background: theme.card, padding: '30px', borderRadius: '16px', boxShadow: theme.shadow }}>
                        <h2 style={{ marginTop: 0 }}>Motoristas Cadastrados</h2>

                        {/* campo de telefone do gestor removido (v149 rollback) */}

                        {/* Central de Comunicados (seletivo) */}
                        <div style={{ marginBottom: '18px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <label style={{ fontWeight: 700, color: theme.textMain }}>Central de Comunicados</label>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                                <select value={destinatario} onChange={(e) => setDestinatario(e.target.value)} style={{ padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1', minWidth: '220px' }}>
                                    <option value="all">📢 Enviar para Todos</option>
                                    {motoristasAtivos?.map(m => (
                                        <option key={m.id} value={String(m.id)}>{m.nome}</option>
                                    ))}
                                </select>
                                <div style={{ flex: 1 }}>
                                    <textarea value={mensagemGeral} onChange={(e) => setMensagemGeral(e.target.value)} placeholder="Escreva a mensagem..." style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #cbd5e1', minHeight: '96px', resize: 'vertical', fontSize: '14px' }} />
                                </div>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', alignItems: 'center' }}>
                                <button
                                    title="Configurar WhatsApp da Central"
                                    onClick={() => { setShowGestorModal(true); try { loadGestorPhone(); } catch (e) { } }}
                                    style={{ padding: '8px 10px', background: '#0ea5e9', border: 'none', color: '#fff', borderRadius: '8px', fontWeight: 700, cursor: 'pointer', boxShadow: '0 6px 14px rgba(14,165,233,0.18)' }}
                                >
                                    📱
                                </button>

                                <button
                                    onMouseDown={() => setBtnPressed(true)}
                                    onMouseUp={() => setBtnPressed(false)}
                                    onMouseLeave={() => setBtnPressed(false)}
                                    onClick={async () => {
                                        const texto = String(mensagemGeral || '').trim();
                                        if (!texto) return alert('Digite a mensagem antes de enviar.');
                                        if (!HAS_SUPABASE_CREDENTIALS) return alert('Chaves Supabase ausentes. Não é possível enviar.');
                                        let motorista_id = null;
                                        if (destinatario !== 'all') {
                                            const mid = Number(destinatario);
                                            if (!Number.isFinite(mid)) return alert('Seleção de motorista inválida.');
                                            motorista_id = mid;
                                        }
                                        try {
                                            setEnviandoGeral(true);
                                            const payload = { titulo: 'Comunicado', mensagem: texto, lida: false, motorista_id };
                                            const { data, error } = await supabase.from('avisos_gestor').insert([payload]);
                                            if (error) throw error;
                                            setMensagemGeral('');
                                            setDestinatario('all');
                                            try { alert('Mensagem enviada com sucesso.'); } catch (e) { }
                                            try { carregarDados(); } catch (e) { }
                                        } catch (e) {
                                            console.error('Erro enviando comunicado:', e);
                                            try { alert('Falha ao enviar mensagem: ' + (e && e.message ? e.message : String(e))); } catch (e2) { }
                                        } finally { setEnviandoGeral(false); setBtnPressed(false); }
                                    }}
                                    style={{ padding: '10px 16px', background: '#0ea5e9', border: 'none', color: '#fff', borderRadius: '8px', fontWeight: 700, cursor: 'pointer', opacity: btnPressed ? 0.7 : 1, transition: 'opacity 120ms ease-in-out', boxShadow: '0 6px 14px rgba(14,165,233,0.18)' }}
                                >
                                    {enviandoGeral ? 'ENVIANDO...' : 'ENVIAR MENSAGEM'}
                                </button>

                                {/* Modal de configuração do WhatsApp da Central */}
                                {showGestorModal && (
                                    <div style={{ position: 'fixed', left: 0, top: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 12000 }}>
                                        <div style={{ width: 420, maxWidth: '94%', background: theme.card, padding: 20, borderRadius: 12, boxShadow: theme.shadow, color: theme.textMain }}>
                                            <h3 style={{ marginTop: 0, marginBottom: 8 }}>Configurar WhatsApp da Central</h3>
                                            <div style={{ marginBottom: 8, color: theme.textLight, fontSize: 13 }}>Digite o número com código do país e DDD (ex: 5548996525008).</div>
                                            <input value={gestorPhoneInput} onChange={(e) => setGestorPhoneInput(e.target.value)} placeholder="5548996525008" style={{ width: '100%', padding: '10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)', background: '#071228', color: '#fff', boxSizing: 'border-box' }} />
                                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                                                <button onClick={() => setShowGestorModal(false)} style={{ padding: '8px 12px', borderRadius: 8, background: 'transparent', color: theme.textLight, border: '1px solid rgba(255,255,255,0.06)', cursor: 'pointer' }}>Cancelar</button>
                                                <button onClick={saveGestorPhone} disabled={gestorPhoneLoading} style={{ padding: '8px 12px', borderRadius: 8, background: '#0ea5e9', color: '#000', border: 'none', fontWeight: 700, cursor: 'pointer' }}>{gestorPhoneLoading ? 'SALVANDO...' : 'Salvar'}</button>
                                            </div>
                                            {gestorPhoneMessage ? <div style={{ marginTop: 10, color: '#34d399', fontWeight: 700 }}>{gestorPhoneMessage}</div> : null}
                                        </div>
                                    </div>
                                )}
                                {/* Modal: Backup antes de zerar DB */}
                                {showBackupModal && (
                                    <div style={{ position: 'fixed', left: 0, top: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 12000 }}>
                                        <div style={{ width: 520, maxWidth: '96%', background: theme.card, padding: 20, borderRadius: 12, boxShadow: theme.shadow, color: theme.textMain }}>
                                            <h3 style={{ marginTop: 0 }}>Atenção: Antes de zerar, deseja exportar um backup das entregas?</h3>
                                            <div style={{ marginBottom: 12, color: theme.textLight }}>Recomendado: baixe o CSV para manter uma cópia externa antes de prosseguir.</div>
                                            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                                                <button onClick={() => setShowBackupModal(false)} style={{ padding: '8px 12px', borderRadius: 8, background: 'transparent', color: theme.textLight, border: '1px solid rgba(255,255,255,0.06)', cursor: 'pointer' }}>Cancelar</button>
                                                <button onClick={async () => {
                                                    try {
                                                        setBackupLoading(true);
                                                        if (!HAS_SUPABASE_CREDENTIALS) return alert('Chaves Supabase ausentes. Não é possível exportar.');
                                                        const { data, error } = await supabase.from('entregas').select('*');
                                                        if (error) throw error;
                                                        const rows = Array.isArray(data) ? data : [];
                                                        if (rows.length === 0) {
                                                            try { alert('Não há entregas para exportar.'); } catch (e) { }
                                                            return;
                                                        }
                                                        // Usar função compartilhada para gerar CSV compatível com Excel BR
                                                        try {
                                                            baixarRelatorioCSV(rows);
                                                        } catch (errCsv) {
                                                            console.error('Erro gerando CSV via baixarRelatorioCSV', errCsv);
                                                            throw errCsv;
                                                        }
                                                    } catch (e) {
                                                        console.error('Erro exportando CSV', e);
                                                        try { alert('Falha ao exportar backup: ' + (e && e.message ? e.message : String(e))); } catch (err) { }
                                                    } finally { setBackupLoading(false); }
                                                }} style={{ padding: '8px 12px', borderRadius: 8, background: '#0ea5e9', color: '#000', border: 'none', fontWeight: 700, cursor: 'pointer' }}>{backupLoading ? 'GERANDO...' : 'Baixar CSV'}</button>
                                                <button onClick={async () => {
                                                    try {
                                                        setShowBackupModal(false);
                                                        // Segundo aviso: confirmação final
                                                        const ok = window.confirm('VOCÊ TEM CERTEZA? Isso apagará TODAS as entregas e históricos permanentemente. Esta ação não pode ser desfeita.');
                                                        if (!ok) return;
                                                        if (!HAS_SUPABASE_CREDENTIALS) return alert('Chaves Supabase ausentes. Não é possível executar a operação.');
                                                        setDeletingDb(true);
                                                        try {
                                                            // Delete entregas (apenas rotativas) - usar .not('id','is',null) para contornar restrição de WHERE
                                                            const { error: err1 } = await supabase.from('entregas').delete().not('id', 'is', null);
                                                            if (err1) throw err1;
                                                            // Delete logs_roteirizacao (histórico) - também proteger com .not
                                                            const { error: err2 } = await supabase.from('logs_roteirizacao').delete().not('id', 'is', null);
                                                            if (err2) throw err2;
                                                            setDeleteResultMessage('Banco de dados zerado com sucesso.');
                                                            try { alert('Banco de dados zerado com sucesso.'); } catch (e) { }
                                                            try { await carregarDados(); } catch (e) { }
                                                        } catch (e) {
                                                            console.error('Erro ao zerar banco', e);
                                                            try { alert('Falha ao zerar banco: ' + (e && e.message ? e.message : String(e))); } catch (err) { }
                                                        } finally { setDeletingDb(false); }
                                                    } catch (e) { console.error('Erro no fluxo de zerar DB', e); }
                                                }} style={{ padding: '8px 12px', borderRadius: 8, background: '#ef4444', color: '#fff', border: 'none', fontWeight: 900, cursor: 'pointer' }}>{deletingDb ? 'APAGANDO...' : 'Continuar'}</button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                                {/* Botão de manutenção crítica: Zerar Banco de Dados */}
                                <div style={{ marginLeft: 8 }}>
                                    <style>{`@keyframes blink {0%{box-shadow:0 0 0 rgba(239,68,68,0.85)}50%{box-shadow:0 0 20px rgba(239,68,68,0.5)}100%{box-shadow:0 0 0 rgba(239,68,68,0.85)}} .v10-blink-red{animation: blink 1s infinite;}`}</style>
                                    <button
                                        onClick={() => setShowBackupModal(true)}
                                        title="Zerar Banco de Dados (ação irreversível)"
                                        style={{
                                            padding: '10px 14px',
                                            borderRadius: 8,
                                            border: totalEntregas > 450 ? '2px solid #ef4444' : '1px solid rgba(255,0,0,0.16)',
                                            background: totalEntregas > 450 ? '#fff1f0' : 'transparent',
                                            color: totalEntregas > 450 ? '#7f1d1d' : '#ef4444',
                                            fontWeight: 900,
                                            cursor: 'pointer'
                                        }}
                                        className={totalEntregas > 450 ? 'v10-blink-red' : ''}
                                    >
                                        ⚠️ Zerar Banco de Dados
                                    </button>
                                </div>
                            </div>
                        </div>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.06)', color: theme.textLight }}>
                                    <th style={{ padding: '10px' }}>NOME</th>
                                    <th>STATUS</th>
                                    <th>VEÍCULO</th>
                                    <th>PLACA</th>
                                    <th>PROGRESSO</th>
                                </tr>
                            </thead>
                            <tbody>
                                {motoristasAtivos?.map(m => {
                                    const isOnline = m.esta_online === true;
                                    const dotColor = isOnline ? '#10b981' : '#ef4444';
                                    const dotShadow = isOnline ? '0 0 10px rgba(16,185,129,0.45)' : '0 0 6px rgba(239,68,68,0.18)';
                                    const nameStyle = isOnline ? { color: '#10b981', fontWeight: 700, textShadow: '0 1px 6px rgba(16,185,129,0.25)' } : { color: '#9ca3af', fontWeight: 400, opacity: 0.9 };
                                    const statusText = isOnline ? 'Disponível' : 'Offline';
                                    const statusColor = isOnline ? '#10b981' : 'rgba(239,68,68,0.6)';

                                    // Progresso de carga: contar entregas vinculadas ao motorista a partir de entregasAtivos
                                    const entregasMot = (entregasAtivos || []).filter(e => String(e.motorista_id) === String(m.id));
                                    const total = entregasMot.length;
                                    const feitas = entregasMot.filter(e => String(e.status || '').trim().toLowerCase() === 'concluido').length;
                                    // Tipo principal (para rótulo dinâmico) — preferir o primeiro tipo conhecido
                                    const tipoPrincipal = (entregasMot.find(e => e.tipo && String(e.tipo).trim().length > 0) || {}).tipo || null;
                                    const tipoColor = tipoPrincipal ? getColorForType(tipoPrincipal) : null;
                                    const verbByTipo = (t) => {
                                        const tt = String(t || '').trim().toLowerCase();
                                        if (tt === 'entrega') return 'Entregando';
                                        if (tt === 'recolha') return 'Recolhendo';
                                        if (tt === 'outros' || tt === 'outro') return 'Ativo';
                                        return 'Em serviço';
                                    };

                                    return (
                                        <tr key={m.id} onClick={() => aoSelecionarMotorista && aoSelecionarMotorista(m)} style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }}>
                                            <td style={{ padding: '15px 10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <span style={{ width: '12px', height: '12px', borderRadius: '50%', background: dotColor, display: 'inline-block', boxShadow: dotShadow }} />
                                                <span style={{ color: '#ffffff', fontWeight: 600 }}>{m.nome}</span>
                                                {(m.lat && m.lng) ? (
                                                    <button onClick={(ev) => { ev.stopPropagation(); try { window.open('https://www.google.com/maps/search/?api=1&query=' + Number(m.lat) + ',' + Number(m.lng), '_blank', 'noopener'); } catch (e) { } }} style={{ marginLeft: 8, background: 'transparent', border: '1px solid rgba(255,255,255,0.06)', color: '#fff', padding: '4px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>Navegar</button>
                                                ) : null}
                                            </td>
                                            <td>
                                                {/* Texto dinâmico: se tiver carga, mostrar verbo + contador; senão Disponível/Offline */}
                                                <span style={{ padding: '6px 10px', borderRadius: '12px', background: 'transparent', color: (total > 0 ? (tipoColor || statusColor) : statusColor), fontSize: '12px', fontWeight: 700, textShadow: isOnline ? '0 1px 6px rgba(16,185,129,0.35)' : 'none', opacity: isOnline ? 1 : 0.6 }}>
                                                    {total > 0 ? `${verbByTipo(tipoPrincipal)} ${feitas}/${total}` : statusText}
                                                </span>
                                            </td>
                                            <td style={{ color: isOnline ? undefined : '#9ca3af' }}>{m.veiculo}</td>
                                            <td style={{ fontFamily: 'monospace', color: isOnline ? undefined : '#9ca3af' }}>{m.placa}</td>
                                            <td style={{ padding: '10px' }}>
                                                {/* Mostrar contador sempre (0/0 quando vazio) */}
                                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#0f172a', color: '#fff', padding: '6px 10px', borderRadius: '999px', fontSize: '13px', fontWeight: 700 }}>
                                                    <span style={{ color: '#10b981' }}>{feitas}</span>
                                                    <span style={{ color: '#9ca3af', fontWeight: 600 }}>/</span>
                                                    <span style={{ color: '#ef4444', opacity: 0.9 }}>{total}</span>
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* GESTÃO DE MOTORISTAS */}
                {abaAtiva === 'Gestão de Motoristas' && (
                    <div style={{ background: 'transparent', padding: '30px', borderRadius: '16px', boxShadow: theme.shadow, width: '100%' }}>
                        <h2 style={{ marginTop: 0 }}>Gestão de Motoristas</h2>
                        <p style={{ color: theme.textLight, marginTop: 0 }}>Lista de motoristas cadastrados. Aprove ou revogue acessos.</p>

                        <div style={{ width: '100%', maxWidth: '1450px', margin: '0 auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', background: 'transparent' }}>
                                <thead>
                                    <tr style={{ textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.06)', color: theme.textLight }}>
                                        <th style={{ padding: '10px' }}>NOME</th>
                                        <th style={{ padding: '10px' }}>EMAIL</th>
                                        <th style={{ padding: '10px' }}>TELEFONE</th>
                                        <th style={{ padding: '10px', textAlign: 'right' }}>AÇÕES</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {motoristasPendentes?.map(m => (
                                        <MotoristaRow key={m.id} m={m} onClick={(mm) => setMotoristaSelecionadoId(String(mm.uuid || mm.id).trim())} entregasAtivos={entregasAtivos} theme={theme} onApprove={(mm) => aprovarMotorista(mm.id)} onReject={(mm) => rejectDriver(mm)} />
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

            </main>

            {/* Driver selection is now inline; modal-based selection removed. */}
        </div>
    );

    // estado do botão gerenciado exclusivamente em recalcRotaForMotorista (true) ou logout do motorista (false)
    return appContent;

    // Componentes Pequenos
    function CardKPI({ titulo, valor, cor }) {
        return (
            <div style={{ background: '#fff', padding: '20px', borderRadius: '16px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', borderLeft: `5px solid ${cor}` }}>
                <h4 style={{ margin: 0, color: '#94a3b8', fontSize: '12px', textTransform: 'uppercase' }}>{titulo}</h4>
                <div style={{ fontSize: '28px', fontWeight: '800', color: '#1e293b' }}>{valor}</div>
            </div>
        );
    }

    // inputStyle and btnStyle moved to top-level to avoid ReferenceError

    // DriverSelectModal removed: selection is now inline via header select

}

export default App;