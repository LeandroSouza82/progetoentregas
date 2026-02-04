import React from 'react';
import { useRef, useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import supabase, { subscribeToTable, onSupabaseReady, SUPABASE_CONNECTED, onSupabaseConnected, checkSupabaseConnection, getLastSupabaseError, buscarTodasEntregas } from './supabaseClient';
import { haversineDistance, nearestNeighborRoute, calculateTotalDistance, getOSRMRoute } from './geoUtils';
import HistoricoEntregas from './components/HistoricoEntregas';
import {
    isValidSC,
    fetchPredictions as getMapboxPredictions,
    geocodeMapbox,
    geocodePhoton,
    geocodeNominatim,
    haversineKm,
    computeRouteDistanceKm
} from './services/GeocodingService';

const HAS_SUPABASE_CREDENTIALS = Boolean(supabase && typeof supabase.from === 'function');

// ===== CONFIGURAÇÕES E UTILIDADES =====

// Coordenadas padrão (Florianópolis - sede)
const DEFAULT_MAP_CENTER = { lat: -27.5969, lng: -48.5495 };


// Ícones de Ponto de Entrega (Checkpoints) - Bolinhas/Gotas coloridas
function createPinIcon(tipo, status, obs = '') {
    const statusLower = String(status || '').toLowerCase().trim();
    const tipoLower = String(tipo || '').toLowerCase().trim();

    // Configuração de Cores Dinâmicas (Novo Padrão Unificado)
    let color = '#9b59b6'; // Default Roxo (Outros tipos em rota)

    // 1. Status 'em_rota' -> Cores por Tipo (Pendente/Ativa)
    if (statusLower === 'em_rota') {
        if (tipoLower === 'entrega') color = '#3498db'; // Azul Entrega
        else if (tipoLower === 'recolha') color = '#f39c12'; // Laranja Recolha
    }
    // 2. Status 'entregue' = Sucesso (Verde)
    else if (statusLower === 'entregue') {
        color = '#2ecc71'; // Verde
    }
    // 3. Status 'falha' = Erro/Problema (Vermelho)
    else if (statusLower === 'falha' || statusLower === 'recusado') {
        color = '#e74c3c'; // Vermelho
    }

    // SVG Pin (Gota de mapa padrão)
    const html = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="36" height="36" style="filter: drop-shadow(0 2px 3px rgba(0,0,0,0.3)); transition: fill 0.3s ease;">
            <path fill="${color}" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
            <circle cx="12" cy="9" r="3.5" fill="#ffffff" opacity="0.9" />
        </svg>
    `;

    return L.divIcon({
        html: html,
        className: 'custom-pin-point',
        iconSize: [36, 36],
        iconAnchor: [18, 36],
        popupAnchor: [0, -36]
    });
}

// Ícone do motorista - LEANDRO (Bicicleta de Entrega)
const bikeIcon = L.divIcon({
    html: `<img src="/bicicleta-de-entrega.png" style="width: 45px; height: 45px; filter: drop-shadow(0 4px 6px rgba(0,0,0,0.3));" />`,
    className: 'marker-motorista-limpo',
    iconSize: [45, 45],
    iconAnchor: [22, 22],
    popupAnchor: [0, -22]
});


// Simple scheduler (DESABILITADO para evitar loops)
function scheduleRetry(ms = 5000) {
    return; // DESABILITADO
}

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

// Helper: build full name from nome + sobrenome (DB fields)
function fullName(record) {
    try {
        const first = record && record.nome ? String(record.nome).trim() : '';
        const last = record && record.sobrenome ? String(record.sobrenome).trim() : '';
        const combined = (first + (last ? (' ' + last) : '')).trim();
        return combined || (record && (record.nome || record.email) ? String(record.nome || record.email) : 'Motorista');
    } catch (e) { return 'Motorista'; }
}

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

// theme state will be set inside the App component
// Status padrão para novas cargas — sempre em minúsculas
const NEW_LOAD_STATUS = 'em_rota';

// --- LÓGICA (NÃO MEXEMOS EM NADA AQUI) ---

// ErrorBoundary para evitar que falhas no componente do mapa quebrem o app
class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false };
    }
    static getDerivedStateFromError() {
        return { hasError: true };
    }
    componentDidCatch(error, info) {
        console.error('ErrorBoundary capturou erro:', error, info);
    }
    render() {
        if (this.state.hasError) {
            return <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af' }}>Erro ao carregar componente de mapa.</div>;
        }
        return this.props.children;
    }
}

// Nota: badge fixo do gestor removido para evitar duplicidade visual

// Componentes antigos do Google Maps removidos (MarkerList, DeliveryMarkers)
// Agora usamos Leaflet diretamente no JSX do mapa

// Linha da tabela de motorista memoizada (modo 'Gestão'): mostra apenas NOME | EMAIL | ENDEREÇO | AÇÕES
const MotoristaRow = React.memo(function MotoristaRow({ m, onClick, entregasAtivos, theme, onApprove, onReject }) {
    // Mostrar apenas dados reais do Supabase: nome, email e telefone
    const email = m.email || null;
    const telefone = (m.telefone && String(m.telefone).trim().length > 0) ? m.telefone : null;

    // Mensagem profissional que solicita resposta 'OK' — sem link de aprovação automática
    const waMessage = `Olá! Sou o gestor do V10. Recebemos seu cadastro para trabalhar conosco. Para validar seu perfil e liberar seu acesso agora, por favor, responda com um 'OK' a esta mensagem.`;

    return (
        <tr key={m.id} onClick={() => onClick && onClick(m)} style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', cursor: 'pointer' }}>
            <td style={{ padding: '15px 10px' }}>
                <span style={{ color: '#ffffff', fontWeight: 600 }}>{fullName(m)}</span>
            </td>

            <td style={{ padding: '15px 10px', color: theme.textLight, fontSize: '13px' }}>{email || 'Sem email'}</td>

            <td style={{ padding: '15px 10px', color: theme.textLight, fontSize: '13px' }}>
                {telefone ? (
                    <a
                        href={`https://api.whatsapp.com/send?phone=${encodeURIComponent(String(m.telefone).replace(/\D/g, ''))}&text=${encodeURIComponent(waMessage)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: '#60a5fa', textDecoration: 'none', fontWeight: 700 }}
                        onClick={(e) => { e.stopPropagation && e.stopPropagation(); }}
                    >
                        {m.telefone}
                    </a>
                ) : 'Sem telefone'}
            </td>

            {(onApprove || onReject) && (
                <td style={{ padding: '10px', display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                    {onApprove && (
                        <button onClick={(e) => { e.stopPropagation && e.stopPropagation(); try { onApprove && onApprove(m); } catch (err) { } }} style={{ background: '#10b981', color: '#fff', fontWeight: 700, border: 'none', padding: '8px 10px', borderRadius: '8px', cursor: 'pointer' }} className="action-btn green">APROVAR</button>
                    )}
                    {onReject && (
                        <button onClick={(e) => { e.stopPropagation && e.stopPropagation(); try { onReject && onReject(m); } catch (err) { } }} style={{ background: '#ef4444', color: '#fff', fontWeight: 700, border: 'none', padding: '8px 10px', borderRadius: '8px', cursor: 'pointer' }} className="action-btn red">REPROVAR</button>
                    )}
                </td>
            )}
        </tr>
    );
}, (p, n) => p.m === n.m && p.entregasAtivos === n.entregasAtivos && p.theme === n.theme);

function App() {
    // Estados principais
    const [loadingFrota, setLoadingFrota] = useState(false);
    const [darkMode, setDarkMode] = useState(true);
    const theme = darkMode ? darkTheme : lightTheme;
    const [abaAtiva, setAbaAtiva] = useState('Visão Geral');
    const [filterStatus, setFilterStatus] = useState('TOTAL'); // Filtro do Dashboard

    // Local supabase ref to ensure we use the right client instance when it becomes available
    const supabaseRef = React.useRef(supabase);

    // Otimização de Rota (Mudança para dentro do componente para acessar supabaseRef)
    const otimizarRota = (pontoPartida, listaEntregas) => {
        let rotaOrdenada = [];
        let atual = pontoPartida;
        let pendentes = [...listaEntregas];
        let maxIterations = 1000;
        while (pendentes.length > 0 && maxIterations-- > 0) {
            let maisProximo = null;
            let menorDistancia = Infinity;
            let indexMaisProximo = -1;
            pendentes.forEach((pedido, index) => {
                if (!atual || !Array.isArray(atual) || atual.length < 2) atual = [0, 0];
                if (!pedido || pedido.lat == null || pedido.lng == null) return;
                const dist = Math.sqrt(Math.pow(Number(pedido.lat) - Number(atual[0]), 2) + Math.pow(Number(pedido.lng) - Number(atual[1]), 2));
                if (dist < menorDistancia) {
                    menorDistancia = dist;
                    maisProximo = pedido;
                    indexMaisProximo = index;
                }
            });
            if (maisProximo) {
                rotaOrdenada.push(maisProximo);
                atual = [maisProximo.lat, maisProximo.lng];
                pendentes.splice(indexMaisProximo, 1);
            } else break;
        }
        return rotaOrdenada;
    };

    async function otimizarRotaLocal(pontoPartida, listaEntregas, motoristaId = null) {
        const remaining = (listaEntregas || []).filter(p => {
            const status = String(p.status || '').trim().toLowerCase();
            return status === 'em_rota';
        });
        if (remaining.length === 0) return [];
        const comCoordenadas = remaining.filter(p => p.lat && p.lng && !isNaN(Number(p.lat)) && !isNaN(Number(p.lng)) && isValidSC(Number(p.lat), Number(p.lng)));
        if (comCoordenadas.length === 0) return [];

        const sb = supabaseRef.current || supabase;
        if (!sb || typeof sb.from !== 'function') return comCoordenadas;

        let originLatLng = null;
        if (motoristaId != null) {
            try {
                const { data: mdata } = await sb.from('motoristas').select('lat,lng,esta_online').eq('id', motoristaId).single();
                if (mdata && mdata.esta_online && mdata.lat != null && mdata.lng != null) {
                    originLatLng = { lat: Number(mdata.lat), lng: Number(mdata.lng) };
                }
            } catch (e) { console.warn('Falha ao buscar motorista:', e); }
        }
        if (!originLatLng) {
            originLatLng = (pontoPartida && pontoPartida.lat != null) ? { lat: Number(pontoPartida.lat), lng: Number(pontoPartida.lng) } : DEFAULT_MAP_CENTER;
        }

        const baseCoord = (pontoPartida && pontoPartida.lat != null) ? { lat: Number(pontoPartida.lat), lng: Number(pontoPartida.lng) } : DEFAULT_MAP_CENTER;
        const ordered = nearestNeighborRoute(originLatLng, comCoordenadas, baseCoord);

        if (motoristaId != null) {
            try {
                // Persistência em lote para evitar 1000 chamadas
                const updates = ordered.map((p, i) => sb.from('entregas').update({ ordem_logistica: i + 1 }).eq('id', p.id));
                await Promise.all(updates);
                console.log(`✅ ordem_logistica persistida para ${ordered.length} entregas`);
            } catch (e) { console.warn('Falha ao persistir ordem_logistica:', e); }
        }
        return ordered;
    }

    // Update ref when supabase becomes ready (async)
    React.useEffect(() => {
        if (supabase && typeof supabase.from === 'function') {
            supabaseRef.current = supabase;
            console.log('🔵 supabaseRef atualizado (imediato):', typeof supabase?.from);
        }

        // Garantir que onSupabaseReady atualize o ref
        if (typeof onSupabaseReady === 'function') {
            onSupabaseReady((client) => {
                supabaseRef.current = client;
                console.log('✅ supabaseRef atualizado via onSupabaseReady:', typeof client?.from);
            });
        }
    }, []);

    const [googleUnavailable, setGoogleUnavailable] = useState(false); // set when Places/Maps services are temporarily failing
    const [supabaseConnectedLocal, setSupabaseConnectedLocal] = useState(Boolean(SUPABASE_CONNECTED));
    const [supabaseChecking, setSupabaseChecking] = useState(false);
    const [supabaseErrorLocal, setSupabaseErrorLocal] = useState(() => { try { return getLastSupabaseError ? getLastSupabaseError() : null; } catch (e) { return null; } });
    const [motoristasOnlineCount, setMotoristasOnlineCount] = useState(0);
    // Localização do gestor removida do dashboard: não solicitamos GPS aqui

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
                        <button onClick={() => { try { window.location.href = '/motorista'; } catch (e) { } }} style={{ padding: '14px 20px', borderRadius: '10px', border: 'none', background: '#10b981', color: '#000', cursor: 'pointer', fontWeight: 800 }}>ABRIR APLICATIVO V10</button>
                        <button onClick={() => { try { window.location.href = '/'; } catch (e) { } }} style={{ padding: '14px 20px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.06)', background: 'transparent', color: '#fff', cursor: 'pointer', fontWeight: 700 }}>VOLTAR AO SITE</button>
                    </div>
                </div>
            </div>
        );
    }

    // Estados do Supabase
    const [entregasEmEspera, setEntregasEmEspera] = useState([]); // agora vem de `entregas`
    const [entregas, setEntregas] = useState([]); // debug-visible entregas (sempre array)
    const [frota, setFrota] = useState([]); // agora vem de `motoristas`
    const [totalEntregas, setTotalEntregas] = useState(0);
    const [historicoCompleto, setHistoricoCompleto] = useState([]);
    const [showHistory, setShowHistory] = useState(false);
    const [isFilteringRoute, setIsFilteringRoute] = useState(false);
    const DEBUG_FORCE_SHOW_ALL = true; // força mostrar tudo temporariamente (debug)
    const [avisos, setAvisos] = useState([]);
    const [gestorPhone, setGestorPhone] = useState(null);
    const [nomeGestor, setNomeGestor] = useState(null);
    const [rotaAtiva, setRotaAtiva] = useState([]);
    const [motoristaDaRota, setMotoristaDaRota] = useState(null);
    const [isGeocoding, setIsGeocoding] = useState(false); // Estado de loading para geocodificação

    // VERIFICAÇÃO CRUZADA: Estados para modal de escolha de cidade
    const [showCityChoiceModal, setShowCityChoiceModal] = useState(false);
    const [cityChoiceOptions, setCityChoiceOptions] = useState([]);
    const [pendingAddressData, setPendingAddressData] = useState(null);

    // FUZZY SEARCH: Estados para sugestões de correção
    const [addressSuggestion, setAddressSuggestion] = useState(null);

    // Estado para mensagens de erro de geocodificação visíveis na tela
    const [geocodingError, setGeocodingError] = useState(null);

    // Initial fetch: load entregas once on mount (minimal logging)
    React.useEffect(() => {
        let mounted = true;
        async function carregarEntregasInicial() {
            try {
                const data = await buscarTodasEntregas();
                // SEMPRE normalizar e setar, mesmo se vazio
                const normalized = Array.isArray(data) ? data.map(it => ({ ...it, motorista_id: it.motorista_id != null ? String(it.motorista_id) : null, cliente: it.cliente || it.cli || it.customer || '', endereco: it.endereco || it.address || '' })) : [];

                if (mounted) {
                    setEntregas(normalized);
                    // FILTRO CRÍTICO: Na Central de Despacho, mostrar apenas o que está 'em_rota' e sem motorista
                    const apenasPendentes = normalized.filter(e => {
                        const status = String(e.status || '').toLowerCase().trim();
                        const semMotorista = (e.motorista_id === null || e.motorista_id === undefined || String(e.motorista_id) === 'null');
                        const isAguardando = status === 'em_rota';
                        return semMotorista && isAguardando;
                    });
                    setEntregasEmEspera(apenasPendentes);
                    setAllEntregas(normalized);
                    setTotalEntregas(normalized.length);
                    console.log('✅ Entregas carregadas com sucesso:', normalized.length);
                    console.log('✅ ESTADO entregasEmEspera (filtrado):', apenasPendentes.length);
                }

                // Carregar motoristas também
                try {
                    console.log('🔵 Tentando carregar motoristas...');
                    const sb = supabaseRef.current || supabase;
                    if (sb && typeof sb.from === 'function') {
                        const { data: motoristas, error: motorErr } = await sb.from('motoristas').select('*').order('id');
                        console.log('🔵 Resposta motoristas:', { motoristas, motorErr, count: motoristas?.length });

                        if (motorErr) {
                            console.error('❌ Erro ao carregar motoristas:', motorErr);
                        } else if (motoristas && mounted) {
                            const normalized = (motoristas || []).map(m => ({
                                ...m,
                                lat: m.lat != null ? Number(String(m.lat).trim()) : m.lat,
                                lng: m.lng != null ? Number(String(m.lng).trim()) : m.lng
                            }));
                            setFrota(normalized);
                            console.log('✅ Motoristas carregados com sucesso:', normalized.length);
                            console.log('✅ Lista de motoristas:', normalized);
                        } else {
                            console.warn('⚠️ Nenhum motorista encontrado no banco');
                            setFrota([]);
                        }
                    } else {
                        console.error('❌ Supabase não disponível para carregar motoristas');
                    }
                } catch (e) {
                    console.error('❌ Erro carregando motoristas (inicial):', e);
                    setFrota([]);
                }
            } catch (err) {
                console.error('❌ Erro ao carregar entregas (inicial):', err);
                if (mounted) { setEntregas([]); setEntregasEmEspera([]); setAllEntregas([]); }
            }
        }
        carregarEntregasInicial();
        return () => { mounted = false; };
    }, []);

    // Draft preview state: a temporary point selected by gestor and the optimized preview order
    const [draftPoint, setDraftPoint] = useState(null);
    const [draftPreview, setDraftPreview] = useState([]);
    const draftPolylineRef = useRef(null);
    const draftOptimizeTimerRef = useRef(null);
    const lastDraftHashRef = useRef(null);
    const inputIdleRef = useRef(true);
    const inputIdleTimerRef = useRef(null);
    const pendingRecalcRef = useRef(new Set());
    const [pendingRecalcCount, setPendingRecalcCount] = useState(0);
    const [selectedMotorista, setSelectedMotorista] = useState(null);
    const [showDriverSelect, setShowDriverSelect] = useState(false);
    // Distance and driver-select mode state
    const [estimatedDistanceKm, setEstimatedDistanceKm] = useState(null);
    const [estimatedTimeSec, setEstimatedTimeSec] = useState(null);
    const [estimatedTimeText, setEstimatedTimeText] = useState(null);
    const [distanceCalculating, setDistanceCalculating] = useState(false);
    const [routeGeometry, setRouteGeometry] = useState(null); // Geometria OSRM para desenhar rota
    const [driverSelectMode, setDriverSelectMode] = useState('dispatch'); // 'dispatch' | 'reopt'
    const [logsHistory, setLogsHistory] = useState([]);
    const [showLogsPopover, setShowLogsPopover] = useState(false);

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
    const [observacoesGestor, setObservacoesGestor] = useState('');
    const [dispatchLoading, setDispatchLoading] = useState(false);
    const [mensagemGeral, setMensagemGeral] = useState('');
    const [enviandoGeral, setEnviandoGeral] = useState(false);
    const [btnPressed, setBtnPressed] = useState(false);
    const [destinatario, setDestinatario] = useState('all');
    const [nomeCliente, setNomeCliente] = useState('');
    const [enderecoEntrega, setEnderecoEntrega] = useState('');
    const enderecoRef = useRef(null);
    const [enderecoCoords, setEnderecoCoords] = useState(null); // { lat, lng } when chosen via Nominatim
    const [predictions, setPredictions] = useState([]);
    const [historySuggestions, setHistorySuggestions] = useState([]);
    const searchTimeoutRef = useRef(null); // debounce para Nominatim
    const [enderecoFromHistory, setEnderecoFromHistory] = useState(false); // flag: clicked from history

    // Inicializar recentList com dados do localStorage (se existirem)
    const [recentList, setRecentList] = useState(() => {
        try {
            const stored = localStorage.getItem('adecell_historico_entregas');
            if (stored) {
                const parsed = JSON.parse(stored);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    console.log('🔄 Histórico carregado do localStorage na inicialização:', parsed.length, 'itens');
                    return parsed;
                }
            }
        } catch (err) {
            console.warn('⚠️ Erro ao carregar histórico do localStorage:', err);
        }
        return [];
    });

    const [historicoFilter, setHistoricoFilter] = useState(''); // Filtro de pesquisa do histórico
    const [allEntregas, setAllEntregas] = useState([]); // raw entregas from DB (no filters)
    const [user, setUser] = useState(null);
    const [session, setSession] = useState(null);
    const [tipoEncomenda, setTipoEncomenda] = useState('Entrega');
    const audioRef = useRef(new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3'));
    const rotaFinalizadaAudioTocadoRef = useRef(false); // Flag para garantir execução única do áudio

    const mapRef = useRef(null);
    const mapRefUnused = mapRef; // preserve ref usage pattern; no history counters needed
    const mapContainerRef = useRef(null);

    // ===== PERSISTÊNCIA DO HISTÓRICO NO LOCALSTORAGE =====
    // useEffect para sincronizar recentList com localStorage automaticamente
    useEffect(() => {
        if (recentList && recentList.length > 0) {
            try {
                // Limitar a 15 endereços mais recentes para não sobrecarregar
                const limited = recentList.slice(0, 15);
                localStorage.setItem('adecell_historico_entregas', JSON.stringify(limited));
                console.log('💾 Histórico sincronizado com localStorage:', limited.length, 'itens');
            } catch (err) {
                console.warn('⚠️ Erro ao sincronizar histórico com localStorage:', err);
            }
        }
    }, [recentList]); // Executar sempre que recentList mudar

    // Função para limpar histórico
    const limparHistorico = () => {
        const confirmar = confirm('🗑️ Deseja realmente limpar todo o histórico de endereços?');
        if (confirmar) {
            try {
                localStorage.removeItem('adecell_historico_entregas');
                setRecentList([]);
                setAllEntregas([]);
                console.log('✅ Histórico limpo com sucesso');
                alert('✅ Histórico limpo!');
            } catch (err) {
                console.warn('⚠️ Erro ao limpar histórico:', err);
                alert('❌ Erro ao limpar histórico');
            }
        }
    };


    // Fetch control refs to avoid concurrent fetches and manage retries
    const fetchInProgressRef = useRef(false);
    const retryTimerRef = useRef(null);
    const retryCountRef = useRef(0); // counts consecutive retry attempts to avoid infinite loops
    const routingInProgressRef = useRef(false); // prevents concurrent heavy route computations
    const lastRouteCacheRef = useRef(new Map()); // cache per motoristaId => { hash, result, timestamp }
    const lastDirectionsQueryRef = useRef(null); // cache last query hash to avoid duplicate Directions calls
    const lastDrawResultRef = useRef(null); // store last draw result {meters,secs}
    const motoristaDebounceMapRef = useRef(new Map()); // per-motorista debounce timers for realtime events
    const lastFrotaRef = useRef([]);

    // Emergency brake: ensure we only load once to avoid loops while debugging
    const hasLoadedOnce = useRef(false);
    // Global switch to disable background polling/intervals during emergency stabilization
    const EMERGENCY_POLLING_DISABLED = true;

    // Cleanup on unmount for any pending retry
    useEffect(() => {
        return () => { try { if (retryTimerRef.current) clearTimeout(retryTimerRef.current); } catch (e) { } };
    }, []);

    // When Supabase client becomes ready, clear caches and reload primary data to ensure dashboard shows live info
    const carregamentoInicialRef = useRef(false);
    useEffect(() => {
        // DESABILITADO: causa múltiplas chamadas a carregarDados
        // Apenas o useEffect de buscarTodasEntregas (linha ~500) deve rodar
        return;

        try {
            onSupabaseReady(() => {
                try {
                    if (carregamentoInicialRef.current) { try { console.warn('⚠️ Carregamento inicial já executado, ignorando chamada duplicada'); } catch (e) { } return; }
                    carregamentoInicialRef.current = true;
                } catch (e) { /* ignore */ }
                try {
                    retryCountRef.current = 0;
                } catch (e) { }
                try { if (lastRouteCacheRef.current && typeof lastRouteCacheRef.current.clear === 'function') lastRouteCacheRef.current.clear(); } catch (e) { }
                try { carregarDados(); } catch (e) { /* non-blocking */ }
            });
        } catch (e) { /* ignore */ }
    }, []);

    // define map center EARLY to avoid ReferenceError in effects
    const [zoomLevel, setZoomLevel] = useState(13);
    // Estados de centro do mapa (usa DEFAULT_MAP_CENTER global definido na linha 23)
    const [mapCenterState, setMapCenterState] = useState(DEFAULT_MAP_CENTER);
    const [pontoPartida, setPontoPartida] = useState(DEFAULT_MAP_CENTER); // sede/company fallback or dynamic driver origin
    const [gestorLocation, setGestorLocation] = useState('São Paulo, BR');

    // Geolocalização ao carregar o mapa
    React.useEffect(() => {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    const userLocation = {
                        lat: position.coords.latitude,
                        lng: position.coords.longitude
                    };
                    setMapCenterState(userLocation);
                    console.log('📍 Mapa centralizado na localização do usuário:', userLocation);
                },
                (error) => {
                    console.warn('⚠️ Geolocalização falhou, usando localização do motorista Leandro:', error);
                    setMapCenterState(DEFAULT_MAP_CENTER);
                }
            );
        } else {
            console.warn('⚠️ Geolocalização não disponível, usando localização do motorista Leandro');
        }
    }, []);

    // Ensure Leaflet resizes correctly
    useEffect(() => {
        if (!mapRef.current) return;

        const notifyResize = () => {
            // 1. BLINDAGEM DO LEAFLET (Evita erro _leaflet_pos undefined)
            if (mapRef.current && typeof mapRef.current.invalidateSize === 'function' && typeof mapRef.current.getPane === 'function') {
                try {
                    mapRef.current.invalidateSize();
                } catch (e) {
                    // Silencia falha se mapa não estiver pronto
                }
            }
        };

        const t = setTimeout(() => notifyResize(), 250);
        return () => clearTimeout(t);
    }, [mapCenterState, abaAtiva]); // Recalcular também ao trocar de aba

    // Draft polyline drawing: dashed preview connecting origin + draftPreview points
    useEffect(() => {
        // DESABILITADO TEMPORARIAMENTE: pode causar re-renders ao desenhar polylines
        return;
    }, [draftPreview, pontoPartida, mapCenterState]);

    // Nominatim: não precisa de inicialização (fetch direto HTTP)

    // Draft point: set when gestor seleciona um endereço
    useEffect(() => {
        // DESABILITADO TEMPORARIAMENTE: pode causar re-renders excessivos
        return;

        if (!enderecoCoords || !enderecoEntrega) { setDraftPoint(null); return; }
        try {
            const lat = Number(enderecoCoords.lat);
            const lng = Number(enderecoCoords.lng);

            // VALIDAÇÃO RIGOROSA: Nunca criar draft com coordenadas inválidas
            if (!lat || !lng || lat === 0 || lng === 0 || !Number.isFinite(lat) || !Number.isFinite(lng)) {
                console.warn('⚠️ Coordenadas inválidas para draft:', { lat, lng });
                setDraftPoint(null);
                return;
            }

            setDraftPoint({ cliente: (nomeCliente || '').trim(), endereco: enderecoEntrega, lat: lat, lng: lng, tipo: String(tipoEncomenda || 'Entrega').trim(), id: `draft-${Date.now()}` });
        } catch (e) {
            setDraftPoint(null);
        }
    }, [enderecoCoords, enderecoEntrega, tipoEncomenda, nomeCliente]);

    // Draft preview optimization: compute suggested order for entregasEmEspera + draftPoint (visual only)
    useEffect(() => {
        // DESABILITADO TEMPORARIAMENTE: causa loops infinitos ao depender de entregasEmEspera
        return;

        let mounted = true;
        const list = Array.isArray(entregasEmEspera) ? entregasEmEspera.slice() : [];
        if (draftPoint) list.push(draftPoint);
        const hash = JSON.stringify({ ids: (list || []).map(p => p && (p.id || (p.lat + ',' + p.lng) || p.endereco || '')), draftId: draftPoint ? draftPoint.id : null });
        if (lastDraftHashRef.current === hash) return () => { mounted = false; };
        lastDraftHashRef.current = hash;

        clearTimeout(draftOptimizeTimerRef.current);
        draftOptimizeTimerRef.current = setTimeout(async () => {
            try {
                if (!mounted) return;
                if (!list || list.length === 0) {
                    setDraftPreview([]);
                    return;
                }
                const origin = pontoPartida || mapCenterState || DEFAULT_MAP_CENTER;
                // Use local heuristic for draft preview to avoid calling Google
                try { setDistanceCalculating(true); } catch (e) { }
                const optimizedLocal = otimizarRota(origin, list);
                if (!mounted) return;
                setDraftPreview((optimizedLocal && optimizedLocal.length > 0) ? optimizedLocal : list);
                // Compute estimated distance for preview (non-persistent)
                try {
                    const pts = (optimizedLocal && optimizedLocal.length > 0) ? optimizedLocal : list;
                    const dist = computeRouteDistanceKm(origin, pts, pontoPartida || mapCenterState || DEFAULT_MAP_CENTER);
                    setEstimatedDistanceKm(Number(dist.toFixed(1)));
                } catch (e) { /* ignore */ } finally { try { setDistanceCalculating(false); } catch (e) { } }
            } catch (e) {
                console.warn('draftPreview: erro ao calcular pré-roteiro', e);
                if (mounted) setDraftPreview([]);
            }
        }, 700);

        return () => { mounted = false; clearTimeout(draftOptimizeTimerRef.current); };
    }, [entregasEmEspera, draftPoint, pontoPartida, mapCenterState]);

    // Suggestions: fetch history matches from Supabase
    async function fetchHistoryMatches(q) {
        try {
            if (!q || String(q).trim().length < 3) { setHistorySuggestions([]); return; }
            const sb = supabaseRef.current || supabase;
            if (!sb || typeof sb.from !== 'function') {
                // Supabase not ready; clear suggestions and exit
                setHistorySuggestions([]);
                return;
            }
            const { data, error } = await sb.from('entregas').select('cliente,endereco,lat,lng').ilike('endereco', `%${q}%`).limit(6);
            if (error) { setHistorySuggestions([]); return; }
            setHistorySuggestions(Array.isArray(data) ? data : []);
        } catch (e) { setHistorySuggestions([]); }
    }

    // NOMINATIM: buscar sugestões de endereço
    async function fetchPredictions(q) {
        try {
            if (!q || q.length < 3) {
                setPredictions([]);
                return;
            }

            // Debounce para evitar muitas requisições
            if (searchTimeoutRef.current) {
                clearTimeout(searchTimeoutRef.current);
            }

            searchTimeoutRef.current = setTimeout(async () => {
                try {
                    // 🗺️ USAR SERVIÇO DE PREDIÇÕES (MAPBOX)
                    const results = await getMapboxPredictions(q);
                    setPredictions(results);
                    console.log('✅ Mapbox Autosuggest retornou:', results.length, 'sugestões');
                } catch (e) {
                    console.warn('⚠️ Mapbox Autosuggest error:', e);
                    setPredictions([]);
                }
            }, 500); // 500ms debounce
        } catch (e) {
            console.warn('fetchPredictions error:', e);
            setPredictions([]);
        }
    }

    // MAPBOX AUTOSUGGEST: ao clicar numa sugestão, usar coordenadas já retornadas
    async function handleSelect(pred) {
        try {
            setEnderecoFromHistory(false);
            const enderecoVal = pred.display_name || pred.text || pred.place_name || '';
            setEnderecoEntrega(enderecoVal);

            // Mapbox já retorna lat/lng na busca, não precisa de segunda chamada!
            if (pred.lat != null && pred.lng != null) {
                const lat = Number(pred.lat);
                const lng = Number(pred.lng);
                console.log('✅ Coordenadas capturadas do Mapbox Autosuggest:', { lat, lng });
                setEnderecoCoords({ lat, lng });

                // Colocar o pino no mapa instantaneamente (preview)
                setDraftPoint({
                    cliente: (nomeCliente || '').trim() || 'Cliente Novo',
                    endereco: enderecoVal,
                    lat: lat,
                    lng: lng,
                    tipo: String(tipoEncomenda || 'Entrega').trim(),
                    id: `draft-${Date.now()}`
                });
            } else {
                console.warn('⚠️ Predição sem coordenadas válidas');
                setEnderecoCoords(null);
                setDraftPoint(null);
            }
        } catch (e) {
            console.warn('handleSelect error:', e);
            setEnderecoCoords(null);
            setDraftPoint(null);
        }
        try { setPredictions([]); setHistorySuggestions([]); } catch (e) { }
    }

    // FUNÇÃO: Salvar nova posição quando marcador for arrastado
    const handleMarkerDrag = React.useCallback(async (entregaId, newLat, newLng) => {
        try {
            console.log(`📍 Marcador arrastado - ID: ${entregaId}, Nova posição: [${newLat}, ${newLng}]`);

            const sb = supabaseRef.current || supabase;
            if (!sb || typeof sb.from !== 'function') {
                console.error('❌ Supabase não disponível para salvar posição');
                return;
            }

            // Validar se coordenadas estão em SC
            if (!isValidSC(newLat, newLng)) {
                alert('⚠️ Posição inválida! O marcador deve estar dentro de Santa Catarina.');
                await carregarDados(); // Recarregar para reverter posição
                return;
            }

            // Atualizar coordenadas no banco de dados
            const { error } = await sb
                .from('entregas')
                .update({ lat: newLat, lng: newLng })
                .eq('id', entregaId);

            if (error) {
                console.error('❌ Erro ao salvar nova posição:', error);
                alert('❌ Erro ao salvar nova posição do marcador.');
                await carregarDados(); // Recarregar para reverter
            } else {
                console.log('✅ Nova posição salva com sucesso!');
                // Atualizar estados locais
                setEntregasEmEspera(prev => prev.map(e =>
                    e.id === entregaId ? { ...e, lat: newLat, lng: newLng } : e
                ));
                setAllEntregas(prev => prev.map(e =>
                    e.id === entregaId ? { ...e, lat: newLat, lng: newLng } : e
                ));
            }
        } catch (err) {
            console.error('❌ Erro ao processar arraste do marcador:', err);
        }
    }, []);

    // FUNÇÃO: Limpar entregas concluídas do mapa (Arquivar)
    const handleLimparConcluidos = async () => {
        try {
            // "Limpar tudo" agora arquiva todas as entregas marcadas como entregues ou falhas
            // O usuário quer apagar TUDO (limpeza total) da visão do mapa.
            const concluidos = (rotaAtiva || []).filter(e => {
                const s = String(e.status || '').toLowerCase().trim();
                return ['entregue', 'falha', 'concluido'].includes(s);
            });

            if (concluidos.length === 0) {
                alert('✨ Nenhuma entrega finalizada (verde/vermelha) para limpar no momento.');
                return;
            }

            const confirmar = confirm(`🧹 Deseja limpar DEFINITIVAMENTE ${concluidos.length} entregas da visão?\n\nIsso arquivará as entregas no banco de dados. Elas não aparecerão mais no mapa.`);
            if (!confirmar) return;

            const ids = concluidos.map(c => c.id);
            const sb = supabaseRef.current || supabase;

            if (sb && typeof sb.from === 'function') {
                // Arquivar no banco de dados para sumir de vez
                const { error } = await sb.from('entregas').update({ status: 'arquivado' }).in('id', ids);
                if (error) {
                    console.error('Erro ao arquivar no banco:', error);
                    alert('Erro ao arquivar no banco de dados.');
                    return;
                }
            }

            // Atualiza localmente e recarrega para sincronizar estatísticas
            setRotaAtiva(prev => prev.filter(p => !ids.includes(p.id)));
            await carregarDados();

            alert('✅ Mapa limpo e entregas arquivadas com sucesso!');
        } catch (err) {
            console.error('❌ Erro ao arquivar entregas:', err);
            alert('Erro ao limpar mapa. Verifique a conexão.');
        }
    };

    // FUNÇÃO: Gerar Entrega Teste (Bicicleta do Leandro)
    const gerarEntregaTeste = async () => {
        const sb = supabaseRef.current || supabase;
        if (!sb) {
            alert("Erro: Banco de dados não disponível.");
            return;
        }

        const confirmar = confirm("Deseja gerar uma entrega de teste para a 'Bicicleta do Leandro'? \n\nEla entrará com status 'em_rota' conforme o novo padrão.");
        if (!confirmar) return;

        const entregaTeste = {
            cliente: "Leandro Teste (Bicicleta)",
            endereco: "Centro, Florianópolis - SC",
            lat: -27.596,
            lng: -48.549,
            status: "em_rota",
            tipo: "Entrega",
            observacoes: "Entrega de teste gerada para validação do fluxo completo."
        };

        const { error } = await sb.from('entregas').insert([entregaTeste]);

        if (error) {
            alert("❌ Erro ao criar entrega de teste: " + error.message);
        } else {
            alert("✅ Entrega de teste 'em_rota' criada com sucesso!");
            if (typeof carregarDados === 'function') carregarDados();
        }
    };

    const carregarDados = React.useCallback(async () => {
        console.log('🔵 carregarDados CHAMADO - hasLoadedOnce:', hasLoadedOnce.current);
        // MODIFICADO: permitir carregar pelo menos 1 vez, mas não bloquear completamente
        // O useEffect inicial já carrega via buscarTodasEntregas, mas este pode ser chamado para refresh

        // If module-level client is not ready yet, DO NOT register callback (prevents recursion)
        if (!supabaseRef.current || typeof supabaseRef.current.from !== 'function') {
            console.log('❌ carregarDados ABORTADO - supabase não pronto');
            return;
        }
        // REMOVIDO: Guard supabaseConnectedLocal que estava bloqueando execução
        // use local ref for client
        const sb = supabaseRef.current || supabase;
        if (!sb || typeof sb.from !== 'function') return;
        // Fetch control refs to avoid concurrent fetches
        if (fetchInProgressRef.current) return;
        fetchInProgressRef.current = true;
        setLoadingFrota(true);

        try {
            let q = sb.from('motoristas').select('*');
            if (q && typeof q.order === 'function') q = q.order('id');
            const { data: motoristas, error: motorErr } = await q;
            if (motorErr) {
                console.error('Erro na Tabela Motoristas:', motorErr);
                // Preserve last known valid frota
                setFrota(prev => prev && prev.length ? prev : (lastFrotaRef.current || []));
            } else {
                const normalized = (motoristas || []).map(m => ({
                    ...m,
                    lat: m.lat != null ? Number(String(m.lat).trim()) : m.lat,
                    lng: m.lng != null ? Number(String(m.lng).trim()) : m.lng
                }));

                const merged = (function (prev) {
                    try {
                        const byId = new Map((prev || []).map(p => [p.id, p]));
                        return normalized.map(n => {
                            const existing = byId.get(n.id);
                            if (existing && Number(existing.lat) === Number(n.lat) && Number(existing.lng) === Number(n.lng) && existing.nome === n.nome) {
                                return existing;
                            }
                            return n;
                        });
                    } catch (e) {
                        return normalized;
                    }
                })(lastFrotaRef.current || []);

                setFrota(merged);
                lastFrotaRef.current = merged;
                // update online counter
                try { setMotoristasOnlineCount((merged || []).filter(m => m && (m.esta_online === true || String(m.esta_online) === 'true')).length); } catch (e) { }
                // clear any pending retry
                if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
                // reset retry counter on success
                try {
                    retryCountRef.current = 0;
                } catch (err) {
                    /* ignore */
                }
            }
        } catch (e) {
            console.warn('Erro carregando motoristas:', e);
            // keep previous frota
            setFrota(prev => prev && prev.length ? prev : (lastFrotaRef.current || []));
        } finally {
            fetchInProgressRef.current = false;
            setLoadingFrota(false);
        }


        // entregas: carregar todas as entregas relevantes para Central de Despacho e Histórico
        try {
            // Buscar todas as entregas ativas (pendente, em_rota, entregue, falha)
            // IMPORTANTE: Incluir 'pendente' explicitamente para aparecer no Dashboard
            const { data: rawList, error: entregasErr } = await sb.from('entregas')
                .select('id,cliente,endereco,lat,lng,status,ordem_logistica,motorista_id,tipo,created_at,observacoes')
                .in('status', ['pendente', 'em_rota', 'entregue', 'falha', 'concluido'])
                .order('created_at', { ascending: false });

            if (entregasErr) {
                console.error('Erro na Tabela Entregas:', entregasErr);
                setEntregasEmEspera([]);
            } else {
                // normalize motorista_id to string and ensure cliente/endereco keys exist
                const list = (rawList || []).map(it => ({
                    ...it,
                    motorista_id: it.motorista_id != null ? String(it.motorista_id) : null,
                    cliente: it.cliente || it.cli || it.customer || '',
                    endereco: it.endereco || it.address || '',
                    tipo: it.tipo || 'Entrega'
                }));

                // Armazenar todas as entregas (para estatísticas e filtragem)
                setAllEntregas(list);

                // SINCRONIZAÇÃO EM TEMPO REAL E PERSISTÊNCIA DA ROTA ATIVA:
                setRotaAtiva(prev => {
                    // Caso 1: Refresh da página ou rota zerada - Recuperar do banco
                    if (!prev || prev.length === 0) {
                        const recovered = list.filter(e => {
                            const s = String(e.status || '').toLowerCase().trim();
                            const temMotorista = e.motorista_id !== null && e.motorista_id !== 'null';
                            // No mapa, mostramos apenas o que já está atribuído
                            return temMotorista && ['em_rota', 'entregue', 'falha', 'concluido'].includes(s);
                        }).sort((a, b) => (a.ordem_logistica || 0) - (b.ordem_logistica || 0));

                        return recovered;
                    }

                    // Caso 2: Atualização em tempo real - Manter o que já está no mapa, mas atualizar status
                    return prev.map(item => {
                        const dbItem = list.find(d => String(d.id) === String(item.id));
                        return dbItem ? { ...item, ...dbItem } : item;
                    });
                });

                // FILTRO DO DASHBOARD: Mostrar entregas pendentes ou em rota que ainda não têm motorista.
                const pendentesOnly = list.filter(e => {
                    const status = String(e.status || '').toLowerCase().trim();
                    const semMotorista = (e.motorista_id === null || e.motorista_id === undefined || String(e.motorista_id) === 'null');
                    return semMotorista && (status === 'pendente' || status === 'em_rota');
                });

                console.log('🟢 Dashboard Sync: Encontradas', pendentesOnly.length, 'entregas aguardando despacho de um total de', list.length);
                setEntregasEmEspera(pendentesOnly);
                setTotalEntregas(list.length);

                // Backup states
                setEntregas(pendentesOnly);
                hasLoadedOnce.current = true;
                retryCountRef.current = 0;
            }
        } catch (e) {
            console.warn('Erro fatal no carregarDados:', e);
        }

        // avisos do gestor
        try {
            let q3 = sb.from('avisos_gestor').select('titulo, mensagem, created_at');
            if (q3 && typeof q3.order === 'function') q3 = q3.order('created_at', { ascending: false });
            if (q3 && typeof q3.limit === 'function') q3 = q3.limit(10);
            const { data: avisosData, error: avisosErr } = await q3;
            if (avisosErr) { console.error('Erro na Tabela avisos_gestor:', avisosErr); setAvisos([]); } else setAvisos(avisosData || []);
        } catch (e) { console.error('Erro carregando avisos:', e); setAvisos([]); }

        // configuracoes (gestor_phone)
        try {
            let q4 = sb.from('configuracoes').select('valor').eq('chave', 'gestor_phone');
            if (q4 && typeof q4.limit === 'function') q4 = q4.limit(1);
            const { data: cfg } = await q4;
            if (cfg && cfg.length > 0) setGestorPhone(cfg[0].valor); else setGestorPhone(null);
        } catch (e) { console.warn('Erro carregando configuracoes:', e); setGestorPhone(null); }

        // Histórico recente - BUSCAR DA TABELA 'entregas'
        try {
            // Buscar últimas 20 entregas com endereços
            const { data: entregas, error: entregasErr } = await sb
                .from('entregas')
                .select('endereco, cliente, created_at')
                .order('created_at', { ascending: false })
                .limit(20);

            if (entregasErr) {
                console.error('❌ Erro ao buscar histórico de entregas:', entregasErr);
            } else if (entregas && entregas.length > 0) {
                // Filtrar endereços únicos (sem repetição)
                const seen = new Set();
                const unique = [];

                for (const entrega of entregas) {
                    const endereco = (entrega.endereco || '').trim();
                    const cliente = (entrega.cliente || '').trim();

                    if (!endereco) continue;

                    // Usar endereço como chave única
                    const key = endereco.toLowerCase();
                    if (seen.has(key)) continue;

                    seen.add(key);
                    unique.push({
                        cliente: cliente,
                        endereco: endereco
                    });
                }

                // ✅ MOSTRAR TODOS OS ENDEREÇOS ÚNICOS (SEM LIMITE)
                // Removido o .slice(0, 15) para recuperar histórico completo

                // ✅ APENAS ATUALIZAR SE HOUVER DADOS NOVOS (evita piscar/resetar)
                if (unique.length > 0) {
                    setRecentList(unique);

                    // Salvar no localStorage para persistência
                    try {
                        localStorage.setItem('adecell_historico_entregas', JSON.stringify(unique));
                        console.log('✅ Histórico carregado da tabela entregas:', unique.length, 'endereços únicos (completo)');
                    } catch (storageErr) {
                        console.warn('⚠️ Erro ao salvar histórico no localStorage:', storageErr);
                    }
                } else {
                    console.log('ℹ️ Banco retornou vazio - mantendo histórico atual do localStorage');
                }
            } else {
                console.log('ℹ️ Nenhuma entrega encontrada - mantendo histórico atual');
            }
        } catch (e) {
            console.warn('⚠️ Erro ao carregar histórico de entregas:', e);
            // Manter dados do localStorage que já foram carregados na inicialização
        }

        setLoadingFrota(false);
    }, []);

    // Função para buscar TODO o histórico do banco de dados (sem filtro de data)
    const buscarHistoricoCompleto = React.useCallback(async () => {
        const sb = supabaseRef.current || supabase;
        if (!sb || typeof sb.from !== 'function') return;

        try {
            console.log('📜 Buscando histórico completo das entregas...');
            const { data, error } = await sb
                .from('entregas')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) {
                console.error('❌ Erro ao buscar histórico completo:', error);
            } else if (data) {
                setHistoricoCompleto(data);
                console.log(`✅ ${data.length} registros de histórico carregados.`);
            }
        } catch (e) {
            console.error('❌ Erro inesperado ao buscar histórico:', e);
        }
    }, []);

    // Atualizar histórico quando a gaveta for aberta
    useEffect(() => {
        if (showHistory) {
            buscarHistoricoCompleto();
        }
    }, [showHistory, buscarHistoricoCompleto]);

    // Approve / Reject handlers for Gestão de Motoristas
    // New admin-facing approve by id
    const aprovarMotorista = async (id) => {
        try {
            if (!id) return;
            const sb = supabaseRef.current || supabase;
            if (!sb || typeof sb.from !== 'function') {
                console.warn('aprovarMotorista: supabase client not initialized');
                return { error: new Error('Supabase não inicializado') };
            }
            const sid = String(id);
            const { data, error } = await sb.from('motoristas').update({ aprovado: true, acesso: 'aprovado' }).eq('id', sid).select();
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
            const sb = supabaseRef.current || supabase;
            if (!sb || typeof sb.from !== 'function') {
                console.warn('rejectDriver: supabase client not initialized');
                return { error: new Error('Supabase não inicializado') };
            }
            const sid = String(id);
            const { data, error } = await sb.from('motoristas').delete().eq('id', sid).select();
            if (error) {
                console.error('rejectDriver db error:', error);
                return { error };
            }
            try { await carregarDados(); } catch (e) { /* non-blocking */ }
            return { data };
        } catch (e) {
            console.error('rejectDriver error:', e);
            return { error: e };
        }
    };

    // Limpador de localStorage: remove caches relacionados a entregas/rotas ao iniciar (evita 'lixo' em celulares)
    useEffect(() => {
        try {
            if (typeof window === 'undefined' || !window.localStorage) return;
            const denyPatterns = [/entregas/i, /rota/i, /route/i, /draft/i, /mock_/i, /lastRouteCache/i];
            const allowlist = ['motorista', 'v10_email'];
            const toRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
                try {
                    const key = localStorage.key(i);
                    if (!key) continue;
                    if (allowlist.includes(key)) continue;
                    const should = denyPatterns.some(rx => rx.test(key) || rx.test(String(localStorage.getItem(key) || '')));
                    if (should) toRemove.push(key);
                } catch (e) { /* ignore */ }
            }
            toRemove.forEach(k => { try { localStorage.removeItem(k); console.info('localStorage cleanup removed', k); } catch (e) { } });
        } catch (e) { /* ignore */ }
    }, []);

    // Remover definição interna do ícone (usamos `motoIcon` definida no topo)

    // NOTE: Google Maps loading is delegated to the maps library's `APIProvider` when available.

    // Debug: log do estado dos motoristas sempre que `frota` mudar
    useEffect(() => {
        // debug logs removed for production dashboard
    }, [frota]);

    // DO NOT block the entire app render when Supabase credentials are missing.
    // Instead show a non-blocking warning banner and let the UI load in degraded/local mode.
    const missingSupabase = !HAS_SUPABASE_CREDENTIALS;

    useEffect(() => {
        // Carrega dados iniciais (sem solicitar GPS no dashboard)
        const init = async () => {
            try {
                await carregarDados();
            } catch (e) { /* ignore */ }
        };

        // If supabase isn't ready yet, register to run init when it is; otherwise run now
        try {
            if (supabase && typeof supabase.from === 'function') {
                init();
            } else if (typeof onSupabaseReady === 'function') {
                onSupabaseReady(init);
            }
        } catch (e) { /* ignore */ }

        // On page load or when opening the dashboard, try to reuse last saved estimated distance from DB to avoid calling Google
        (async () => {
            try {
                const sb = supabaseRef.current || supabase;
                if (!HAS_SUPABASE_CREDENTIALS || !sb || typeof sb.from !== 'function') return;
                const { data: lastLog, error } = await sb.from('logs_roteirizacao').select('distancia_nova, created_at').order('created_at', { ascending: false }).limit(1);
                if (!error && lastLog && lastLog.length > 0 && lastLog[0].distancia_nova != null) {
                    try {
                        const val = Number(lastLog[0].distancia_nova);
                        if (val && (!estimatedDistanceKm || estimatedDistanceKm === null)) setEstimatedDistanceKm(Number(val));
                    } catch (e) { /* ignore */ }
                }
            } catch (e) { /* ignore */ }
        })();
    }, []);

    // react to supabase ready/connected signal: run healthcheck and auto-load data once without user action
    useEffect(() => {
        // DESABILITADO: causa múltiplas chamadas a carregarDados que quebram hasLoadedOnce
        // Apenas o useEffect inicial (buscarTodasEntregas) deve carregar dados
        return;

        async function handleReady() {
            try {
                // If the module-level flag is already true, accept it and load immediately
                if (SUPABASE_CONNECTED) {
                    setSupabaseConnectedLocal(true);
                    setSupabaseErrorLocal(null);
                    try { await carregarDados(); } catch (e) { console.warn('carregarDados after SUPABASE_CONNECTED failed', e); }
                    return;
                }

                // Attempt an immediate health-check (network / RLS / permission)
                try {
                    setSupabaseChecking(true);
                    const res = await checkSupabaseConnection();
                    setSupabaseChecking(false);
                    if (res && res.connected) {
                        setSupabaseConnectedLocal(true);
                        setSupabaseErrorLocal(null);
                        try { await carregarDados(); } catch (e) { console.warn('carregarDados after healthcheck failed', e); }
                        return;
                    } else {
                        setSupabaseConnectedLocal(false);
                        setSupabaseErrorLocal(res && res.error ? res.error : new Error('Supabase healthcheck failed'));
                    }
                } catch (e) {
                    setSupabaseChecking(false);
                    setSupabaseErrorLocal(e);
                }

                // Ensure we still react when onSupabaseConnected fires later
                try {
                    onSupabaseConnected(async () => {
                        setSupabaseConnectedLocal(true);
                        setSupabaseErrorLocal(null);
                        try { await carregarDados(); } catch (e) { console.warn('carregarDados after connected failed', e); }
                    });
                } catch (e) { /* ignore */ }
            } catch (e) { /* ignore */ }
        }

        try {
            // Ensure local ref is set and carregarDados runs as soon as client exists
            onSupabaseReady((client) => {
                try {
                    supabaseRef.current = client || supabaseRef.current;
                    setSupabaseErrorLocal(null);
                    if (client) setSupabaseConnectedLocal(true);
                    try { carregarDados(); } catch (e) { console.warn('carregarDados after onSupabaseReady handler failed', e); }
                } catch (e) { /* ignore */ }
            });
            // Also run the health-check driven handler
            onSupabaseReady(handleReady);
        } catch (e) {
            // fallback: run immediately
            try { handleReady(); } catch (err) { /* ignore */ }
        }
    }, [carregarDados]);

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
                // Usar Nominatim (OpenStreetMap) para reverse geocoding
                const resp = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}`, {
                    headers: { 'User-Agent': 'ProjetoEntregas/1.0' }
                });

                if (resp.ok) {
                    const j = await resp.json();
                    const addr = j.address || {};
                    const city = addr.city || addr.town || addr.village || addr.county || '';
                    const state = addr.state || addr.region || '';
                    if (city || state) {
                        setGestorLocation(`${city || 'São Paulo'}, ${state || 'BR'}`);
                    } else {
                        setGestorLocation('São Paulo, BR');
                    }
                    return;
                }
            } catch (e) {
                console.warn('Reverse geocoding falhou:', e);
            }
            if (mounted) setGestorLocation('São Paulo, BR');
        };

        const fail = () => { if (mounted) setGestorLocation('São Paulo, BR'); };

        navigator.geolocation.getCurrentPosition(success, fail, { timeout: 10000, maximumAge: 600000 });
        return () => { mounted = false; };
    }, []);

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
    const orderedRota = rotaAtiva && rotaAtiva.slice ? rotaAtiva.slice().sort((a, b) => {
        const orderA = a.ordem_logistica || a.ordem || 0;
        const orderB = b.ordem_logistica || b.ordem || 0;
        return orderA - orderB;
    }) : [];

    // FILTRO DINÂMICO DO PAINEL DE STATUS (Realtime)
    const filteredRota = React.useMemo(() => {
        if (!orderedRota) return [];
        if (filterStatus === 'TOTAL') return orderedRota;

        return orderedRota.filter(e => {
            const status = String(e.status || '').toLowerCase().trim();

            if (filterStatus === 'OK') {
                return status === 'entregue';
            }
            if (filterStatus === 'FAIL') {
                return status === 'falha';
            }
            if (filterStatus === 'PEND') {
                return status === 'em_rota';
            }
            return true;
        });
    }, [orderedRota, filterStatus]);

    // ENTREGAS NO MAPA: Mostrar os 103 itens (Pendente/Em Rota/Entregue/Falha)
    const entregasAtivasNoMapa = React.useMemo(() => {
        if (!rotaAtiva || rotaAtiva.length === 0) {
            return [];
        }

        return rotaAtiva.filter(e => {
            const status = String(e.status || '').toLowerCase().trim();

            // Apenas mostrar entregas com coordenadas VÁLIDAS
            const hasValidCoords = e.lat != null && e.lng != null &&
                Number.isFinite(Number(e.lat)) &&
                Number.isFinite(Number(e.lng));

            return ['em_rota', 'entregue', 'falha', 'concluido', 'concluída'].includes(status) && hasValidCoords;
        });
    }, [rotaAtiva]);

    // Verificar se a rota foi finalizada (todas as entregas concluídas)
    const rotaFinalizada = React.useMemo(() => {
        if (!orderedRota || orderedRota.length === 0) return false;
        const statusFinais = ['entregue', 'falha'];
        const todasConcluidas = orderedRota.every(e => {
            const status = String(e.status || '').toLowerCase().trim();
            return statusFinais.includes(status);
        });
        return todasConcluidas;
    }, [orderedRota]);

    // Reset do mapa quando rota é finalizada
    React.useEffect(() => {
        // TRAVA CRÍTICA: NÃO executar durante carregamento inicial (refresh)
        // Só permitir limpeza após dados terem sido carregados pelo menos uma vez
        if (!hasLoadedOnce.current) {
            console.log('⚠️ Bloqueando limpeza de mapa - carregamento inicial ainda não completou');
            return;
        }

        // TRAVA ADICIONAL: Só limpar se houver uma rota ativa (não limpar em dashboard vazio)
        if (!rotaAtiva || rotaAtiva.length === 0) {
            console.log('⚠️ Bloqueando limpeza de mapa - sem rota ativa');
            return;
        }

        if (rotaFinalizada && mapRef.current) {
            console.log('🏁 Rota finalizada! Limpando mapa...');

            // 🎵 GATILHO DE ÁUDIO: Tocar sucesso.mp3 APENAS UMA VEZ
            if (!rotaFinalizadaAudioTocadoRef.current) {
                console.log('🔊 Tocando áudio de sucesso...');
                try {
                    // BLINDAGEM DE ÁUDIO: Toca apenas se possível, sem quebrar o fluxo
                    const playSound = async () => {
                        try {
                            const audio = new Audio('/sucesso.mp3');
                            // Promessa com timeout para não travar
                            const playPromise = audio.play();
                            if (playPromise !== undefined) {
                                playPromise.catch(error => {
                                    // Auto-play policy failure etc.
                                    console.warn('Áudio bloqueado pelo navegador:', error);
                                });
                            }
                        } catch (err) {
                            console.warn('Áudio sucesso.mp3 falhou:', err);
                        }
                    };
                    playSound();

                    // Rota finalizada - Apenas manter os pinos cinzas/verdes conforme solicitado
                    console.log('✅ Rota finalizada detectada. Mantendo pinos para visualização.');

                    // Marcar que áudio foi tocado para esta rota
                    rotaFinalizadaAudioTocadoRef.current = true;
                } catch (e) {
                    console.warn('Erro ao tocar áudio de sucesso:', e);
                }
            }

            // AVISO: Auto-limpeza desativada a pedido do usuário. 
            // Os pinos verdes agora permanecem no mapa. A limpeza deve ser manual no botão 'Limpar'.
            console.log('✅ Rota concluída (Áudio tocado). Pinos permanecem visíveis.');

            return () => { }; // Removido o timer de limpeza automática
        }
    }, [rotaFinalizada, frota, mapCenterState, rotaAtiva]);

    // REMOVIDO: Ajuste automático de bounds (dependia do Google Maps LatLngBounds)
    // Com Leaflet, pode ser implementado usando map.fitBounds() se necessário

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
        // SmoothMarker desabilitado (usava Google Maps AdvancedMarker)
        // Com Leaflet, os markers são renderizados diretamente no JSX do mapa
        return null;
    };

    // Helper: map type to color
    function colorForType(tipo) {
        const t = String(tipo || '').trim().toLowerCase();
        if (t === 'recolha') return '#fb923c'; // laranja
        if (t === 'outros' || t === 'outro') return '#c084fc'; // roxo
        return '#2563eb'; // azul (entrega default)
    }

    function capitalize(s) { return String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1); }

    // Componentes antigos do Google Maps removidos (DeliveryMarkers e BotoesMapa)
    // Agora usamos Leaflet com Markers diretamente no JSX

    // Helpers para cores por tipo de carga
    const getColorForType = (tipo) => {
        const t = String(tipo || '').trim().toLowerCase();
        if (t === 'entrega') return '#2563eb'; // azul
        if (t === 'recolha') return '#f59e0b'; // laranja
        if (t === 'outros' || t === 'outro') return '#a855f7'; // lilás
        return '#10b981'; // verde livre / padrão
    };

    const getDriverServiceType = (motoristaId) => {
        try {
            const found = (rotaAtiva || []).find(r => String(r.motorista_id) === String(motoristaId) && String(r.status || '').trim().toLowerCase() === 'em_rota');
            return found ? (found.tipo || null) : null;
        } catch (e) { return null; }
    };

    const getDriverColor = (motoristaId) => {
        const tipo = getDriverServiceType(motoristaId);
        return tipo ? getColorForType(tipo) : '#10b981';
    };

    // Combina entregas em espera e rota ativa para analisar status por motorista
    const entregasAtivos = [...(entregasEmEspera || []), ...(rotaAtiva || [])];



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

        // handler used by both realtime channel and polling fallback
        const handleRealtimeMotoristas = (payload) => {
            try {
                const rec = payload.new || payload.record || null;
                if (!rec || !rec.id) return;
                const parsed = { ...rec };
                if (parsed.lat != null) parsed.lat = Number(parsed.lat);
                if (parsed.lng != null) parsed.lng = Number(parsed.lng);

                // Atualiza por mapeamento para preservar referências de objetos
                setFrota(prev => {
                    try {
                        const arr = Array.isArray(prev) ? prev : [];
                        const found = arr.find(m => String(m.id) === String(parsed.id));
                        if (found) {
                            return arr.map(m => String(m.id) === String(parsed.id) ? { ...m, ...parsed } : m);
                        }
                        // Se não existir, adiciona ao final
                        return [...arr, parsed];
                    } catch (e) {
                        return prev || [];
                    }
                });

                // If a motorista updated location and we have an active route for them, optionally recompute or refresh polyline
                try {
                    if (parsed && parsed.id) {
                        if (routePolylineRef.current && routePolylineRef.current.setPath) {
                            // optional: nudge polyline
                        }
                    }
                } catch (e) { /* ignore */ }
            } catch (e) {
                console.warn('Erro no handler realtime motoristas:', e);
            }
        };

        // Prefer native Supabase realtime channel when available
        const sb = supabaseRef.current || supabase;
        if (sb && typeof sb.channel === 'function') {
            const canal = sb
                .channel('rastreio-v10')
                .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'motoristas' }, handleRealtimeMotoristas)
                .subscribe();

            return () => {
                try { sb.removeChannel(canal); } catch (e) { try { canal.unsubscribe && canal.unsubscribe(); } catch (err) { } }
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

    // Draw route on map: prefer OSRM/Google for path data, then render via Leaflet state using setRouteGeometry
    async function drawRouteOnMap(origin, orderedList = [], includeHQ = false, pontoPartida = null, motoristaId = null) {
        try {
            // Limpa rota anterior visualmente
            setRouteGeometry(null);

            // Trava de segurança: se mapa não existe, apenas ignora
            if (!mapRef.current) {
                // Não retorna erro, pois podemos querer apenas calcular distâncias (se necessário)
                // mas sem mapa, não há visualização.
            }

            // Build waypoints array
            const waypts = orderedList.map(p => ({ lat: Number(p.lat), lng: Number(p.lng) }));

            // If includeHQ true, insert pontoPartida after first chunk
            if (includeHQ && pontoPartida) {
                const limit = Number((typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_ROUTE_CYCLE_LIMIT) || 10);
                if (waypts.length > limit) {
                    waypts.splice(limit, 0, { lat: Number(pontoPartida.lat), lng: Number(pontoPartida.lng) });
                }
            }

            const baseDest = (pontoPartida && pontoPartida.lat != null && pontoPartida.lng != null)
                ? pontoPartida
                : mapCenterState || DEFAULT_MAP_CENTER;

            // 1. OSRM (Priority)
            try {
                const allPoints = [
                    [origin.lng, origin.lat],
                    ...waypts.map(w => [w.lng, w.lat]),
                    [baseDest.lng, baseDest.lat]
                ];

                // Busca geometria compatível com Leaflet (arrays de [lat,lng])
                const osrmResult = await getOSRMRoute(allPoints);
                if (osrmResult && osrmResult.geometry) {
                    setRouteGeometry(osrmResult.geometry);
                    if (osrmResult.distance) setEstimatedDistanceKm(Number(osrmResult.distance));
                    return { meters: (osrmResult.distance || 0) * 1000, secs: 0 };
                }
            } catch (e) { /* Fallback to Google */ }

            // 2. Google Directions (Fallback)
            // Extraímos apenas os DADOS do Google, sem criar objetos Google Maps no Leaflet
            if (typeof window !== 'undefined' && window.google && window.google.maps && window.google.maps.DirectionsService) {
                try {
                    const directionsService = new window.google.maps.DirectionsService();
                    const dsWaypoints = waypts.map(w => ({ location: w, stopover: true }));
                    const request = {
                        origin,
                        destination: baseDest,
                        travelMode: window.google.maps.TravelMode.DRIVING,
                        waypoints: dsWaypoints,
                        optimizeWaypoints: true
                    };

                    const res = await new Promise((resolve, reject) =>
                        directionsService.route(request, (r, s) => s === 'OK' ? resolve(r) : reject(s))
                    );

                    // Extrair path e converter para Leaflet
                    const overviewPath = res.routes?.[0]?.overview_path;
                    if (overviewPath) {
                        const leafPath = overviewPath.map(p => [
                            typeof p.lat === 'function' ? p.lat() : p.lat,
                            typeof p.lng === 'function' ? p.lng() : p.lng
                        ]);
                        setRouteGeometry(leafPath);
                    }

                    // Extrair métricas
                    const legs = res.routes?.[0]?.legs || [];
                    const meters = legs.reduce((s, l) => s + ((l && l.distance && l.distance.value) ? l.distance.value : 0), 0);
                    const secs = legs.reduce((s, l) => s + ((l && l.duration && l.duration.value) ? l.duration.value : 0), 0);

                    if (meters > 0) setEstimatedDistanceKm(Number((meters / 1000).toFixed(1)));
                    if (secs > 0) setEstimatedTimeSec(secs);

                    return { meters: meters || 0, secs: secs || 0 };

                } catch (googleErr) {
                    console.warn('Google Routing failed, falling back to straight line');
                }
            }

            // 3. Fallback Final: Linha Reta
            const straightPath = [
                [origin.lat, origin.lng],
                ...waypts.map(w => [w.lat, w.lng]),
                [baseDest.lat, baseDest.lng]
            ];
            setRouteGeometry(straightPath);
            return { meters: 0, secs: 0 };

        } catch (e) {
            console.warn('drawRouteOnMap failed:', e);
            setRouteGeometry(null);
        }
    }

    // Recalculate route for a specific motorista (used on new recolhas and manual trigger)
    // Recalculate route for a specific motorista (used on new recolhas and manual trigger)
    // This function sets pontoPartida dynamically (driver location or sede fallback) and runs routing safely
    const recalcRotaForMotorista = React.useCallback(async (motoristaId) => {
        try {
            if (!motoristaId) return;

            // VALIDAÇÃO CRÍTICA: verificar se há entregas antes de processar
            if (!entregasEmEspera || entregasEmEspera.length === 0) {
                console.warn('recalcRotaForMotorista: nenhuma entrega disponível para roteirizar');
                return;
            }

            // Prevent concurrent routing operations to avoid resource exhaustion (ERR_INSUFFICIENT_RESOURCES)
            if (routingInProgressRef.current) {
                console.warn('recalcRotaForMotorista: route calculation already in progress; skipping');
                try { setMensagemGeral('Roteamento em andamento — aguarde o término antes de reexecutar.'); } catch (e) { }
                return;
            }
            routingInProgressRef.current = true;
            // capture previous distance for audit
            const previousDistanceKm = (typeof estimatedDistanceKm !== 'undefined' && estimatedDistanceKm != null) ? Number(estimatedDistanceKm) : null;

            // Usar supabaseRef para evitar erro "Cannot read properties of null"
            const sb = supabaseRef.current || supabase;
            if (!sb || typeof sb.from !== 'function') {
                console.warn('recalcRotaForMotorista: supabase não disponível');
                return;
            }

            // Fetch motorista to ensure online and get current lat/lng
            const { data: mdata, error: merr } = await sb.from('motoristas').select('id,lat,lng,esta_online').eq('id', motoristaId);
            if (merr) { console.warn('recalcRotaForMotorista: erro ao buscar motorista:', merr); return; }
            const motor = mdata && mdata[0] ? mdata[0] : null;
            if (!motor) return;
            if (motor.esta_online !== true) return; // RULE: only online drivers receive routing

            // Determine origin: prefer current driver lat/lng, fallback to sede/mapCenter
            let origin = null;
            if (motor.lat != null && motor.lng != null) {
                origin = { lat: Number(motor.lat), lng: Number(motor.lng) };
                // Update pontoPartida to the driver's current location (dynamic)
                try { setPontoPartida(origin); } catch (e) { /* ignore */ }
            } else {
                // fallback to company HQ / mapCenterState
                origin = (pontoPartida && pontoPartida.lat != null && pontoPartida.lng != null) ? pontoPartida : mapCenterState || DEFAULT_MAP_CENTER;
                try { setPontoPartida(origin); } catch (e) { /* ignore */ }
            }

            // Fetch remaining deliveries for this motorista (or ALL when DEBUG_FORCE_SHOW_ALL)
            let qR = sb.from('entregas').select('*').in('status', ['em_rota']).order('ordem_logistica', { ascending: true });
            if (!DEBUG_FORCE_SHOW_ALL && motoristaId != null) qR = qR.eq('motorista_id', motoristaId);
            const { data: remData } = await qR;
            // normalize motorista_id to string for consistent comparisons
            const remainingForDriver = Array.isArray(remData) ? remData.map(it => ({ ...it, motorista_id: it.motorista_id != null ? String(it.motorista_id) : null })) : [];
            if (!remainingForDriver || remainingForDriver.length === 0) return;

            // Cache guard: avoid recalculating if remaining set hasn't changed recently
            try {
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
                        try { return; } catch (e) { }
                    } catch (e) { /* ignore cache read issues */ }
                }
            } catch (e) { /* ignore hashing issues */ }

            // Compute optimized order using local algorithm (Nearest Neighbor + Haversine)
            try { setDistanceCalculating(true); } catch (e) { }
            let optimized = await otimizarRotaLocal(mapCenterState || pontoPartida || DEFAULT_MAP_CENTER, remainingForDriver, motoristaId);
            // Safety: avoid processing extremely large routes in one go to preserve browser stability
            try {
                if (Array.isArray(optimized) && optimized.length > 200) {
                    try { setMensagemGeral('Rota muito longa — processando primeiros 200 pontos para estabilidade.'); } catch (e) { }
                    optimized = optimized.slice(0, 200);
                }
            } catch (e) { /* ignore */ }
            try { setDistanceCalculating(false); } catch (e) { }

            // Draw on map (include HQ if necessary). Always pass company HQ as the destination to keep base as final point
            const includeHQ = (remainingForDriver.length > Number((typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_ROUTE_CYCLE_LIMIT) || 10));
            // ensure UI shows calculating while we call Directions
            try { setDistanceCalculating(true); } catch (e) { }
            let drawResult = null;
            try {
                drawResult = await drawRouteOnMap(origin, optimized, includeHQ, mapCenterState || DEFAULT_MAP_CENTER, motoristaId);
                // Immediately reflect distance/time on UI from Google response (don't wait DB)
                try {
                    if (drawResult && typeof drawResult.meters === 'number') {
                        setEstimatedDistanceKm(Number((drawResult.meters / 1000).toFixed(1)));
                    }
                    if (drawResult && typeof drawResult.secs === 'number') {
                        setEstimatedTimeSec(drawResult.secs);
                        try { setEstimatedTimeText(formatDuration(drawResult.secs)); } catch (e) { }
                    }
                } catch (e) { /* ignore UI update errors */ }
                // cache final result per motorista and remaining hash
                try {
                    const hash2 = JSON.stringify((remainingForDriver || []).map(r => `${r.id || ''}:${r.lat || ''},${r.lng || ''}`));
                    const cacheKey2 = String(motoristaId) + '|' + hash2;
                    lastRouteCacheRef.current.set(cacheKey2, { optimized, drawResult, timestamp: Date.now() });
                } catch (e) { /* ignore cache set */ }
            } finally {
                try { setDistanceCalculating(false); } catch (e) { }
            }

            // Persist ordem_logistica per item (batched to avoid blocking UI and resource exhaustion)
            let newOrderIds = [];
            let allOk = true;
            const failedUpdates = [];
            try {
                if (Array.isArray(optimized) && motoristaId != null) {
                    const BATCH_SIZE = 10;
                    const updates = (optimized || []).map((item, i) => ({ id: item && item.id, ordem: Number(i + 1) })).filter(u => u.id);
                    for (let start = 0; start < updates.length; start += BATCH_SIZE) {
                        const batch = updates.slice(start, start + BATCH_SIZE);
                        // perform batch updates in parallel, but await the batch to yield to the event loop
                        await Promise.all(batch.map(async (u) => {
                            newOrderIds.push(u.id);
                            try {
                                const { data: updData, error } = await sb.from('entregas').update({ ordem_logistica: u.ordem }).eq('id', u.id);
                                if (error) {
                                    allOk = false;
                                    failedUpdates.push({ id: u.id, error });
                                    console.error('recalcRotaForMotorista: erro atualizando ordem_logistica para id', u.id, error && error.message ? error.message : error);
                                } else {
                                    // successful update — no verbose console logging to avoid log pressure
                                }
                            } catch (err) {
                                allOk = false;
                                failedUpdates.push({ id: u.id, error: err });
                                console.error('recalcRotaForMotorista: exceção ao atualizar ordem_logistica para id', u.id, err && err.message ? err.message : err);
                            }
                        }));
                        // small pause to yield and avoid freezing the browser
                        await new Promise(res => setTimeout(res, 150));
                    }
                    // Refresh data so other components see updated ordem_logistica
                    try { await carregarDados(); } catch (err) { /* non-blocking */ }
                }
            } catch (e) { console.warn('recalcRotaForMotorista: erro persistindo ordem_logistica', e); }
            // If any updates failed, surface a non-blocking message and log details
            try {
                if (failedUpdates.length > 0) {
                    const ids = failedUpdates.map(f => f.id).slice(0, 10);
                    const msg = `Falha ao gravar ordem_logistica para ${failedUpdates.length} entregas (ex.: ${ids.join(', ')}). Verifique logs.`;
                    try { setMensagemGeral(msg); } catch (e) { }
                    console.warn('recalcRotaForMotorista: failedUpdates details:', failedUpdates.slice(0, 20));
                }
            } catch (e) { /* ignore */ }

            // After persistence, create an audit log entry with previous/new distances and the new order
            try {
                if (motoristaId != null) {
                    if (!allOk) {
                        console.error('recalcRotaForMotorista: nem todas atualizações foram concluídas com sucesso. Log de auditoria não será gravado.');
                        try { alert('Atenção: algumas atualizações falharam. Verifique os logs.'); } catch (e) { }
                    } else {
                        try {
                            const prevDist = Number(previousDistanceKm) || null;
                            const newDist = Number((drawResult && drawResult.meters ? drawResult.meters / 1000 : (estimatedDistanceKm || null))) || null;
                            const payload = [{ motorista_id: motoristaId, distancia_antiga: prevDist, distancia_nova: newDist, created_at: (new Date()).toISOString(), nova_ordem: Array.isArray(newOrderIds) ? newOrderIds : [] }];
                            const { data: logData, error: logErr } = await sb.from('logs_roteirizacao').insert(payload);
                            if (logErr) { console.error('recalcRotaForMotorista: falha ao gravar log_roteirizacao', logErr); try { setMensagemGeral('Falha ao gravar log de auditoria: ' + (logErr && logErr.message ? logErr.message : JSON.stringify(logErr))); } catch (e) { } }
                            else { console.log('recalcRotaForMotorista: log_roteirizacao gravado', logData); }
                            // refresh local logs preview
                            try { await fetchLogsForMotorista(String(motoristaId)); } catch (e) { /* ignore */ }
                        } catch (e) { console.error('recalcRotaForMotorista: exceção ao gravar log_roteirizacao', e); }
                    }
                }
            } catch (e) { /* ignore */ }

            // Update UI state immediately so dashboard shows new order and motorista app can pick it via realtime DB changes
            try {
                const optimizedWithOrder = (optimized || []).map((p, i) => ({ ...p, ordem: Number(i + 1), ordem_logistica: Number(i + 1), motorista_id: String(motoristaId) }));
                setRotaAtiva(optimizedWithOrder);
                const foundDriver = (frota || []).find(m => String(m.id) === String(motoristaId));
                if (foundDriver) setMotoristaDaRota(foundDriver);
                // ensure visual feedback: set distance/time from draw result if available
                try {
                    if (drawResult && drawResult.meters) setEstimatedDistanceKm(Number((drawResult.meters / 1000).toFixed(1)));
                    if (drawResult && drawResult.secs) setEstimatedTimeSec(drawResult.secs);
                } catch (e) { /* ignore */ }
            } catch (err) { console.warn('recalcRotaForMotorista: falha ao atualizar UI com rota otimizada', err); }

            // Update UI state immediately so dashboard shows new order and motorista app can pick it via realtime DB changes
            try {
                const optimizedWithOrder = (optimized || []).map((p, i) => ({ ...p, ordem: Number(i + 1), ordem_logistica: Number(i + 1), motorista_id: String(motoristaId) }));
                setRotaAtiva(optimizedWithOrder);
                const foundDriver = (frota || []).find(m => String(m.id) === String(motoristaId));
                if (foundDriver) setMotoristaDaRota(foundDriver);
                // ensure visual feedback: set distance/time if drawRouteOnMap couldn't
                try {
                    if (estimatedDistanceKm == null || estimatedTimeSec == null) {
                        const originForCalc = pontoPartida || mapCenterState || DEFAULT_MAP_CENTER;
                        const dist = computeRouteDistanceKm(originForCalc, optimizedWithOrder, originForCalc);
                        if (dist && dist > 0 && (estimatedDistanceKm == null)) setEstimatedDistanceKm(Number(dist.toFixed(1)));
                    }
                } catch (e) { /* ignore */ }
            } catch (err) { console.warn('recalcRotaForMotorista: falha ao atualizar UI com rota otimizada', err); }
        } catch (e) {
            console.warn('recalcRotaForMotorista failed:', e);
        } finally {
            // release routing lock with a small grace period
            try { setTimeout(() => { routingInProgressRef.current = false; }, 400); } catch (e) { routingInProgressRef.current = false; }
        }
    }, [pontoPartida, mapCenterState]);

    // Fetch last 3 logs for a given motorista
    async function fetchLogsForMotorista(motoristaId) {
        try {
            if (!motoristaId) { setLogsHistory([]); return; }
            const sb = supabaseRef.current || supabase;
            if (!sb || typeof sb.from !== 'function') {
                console.warn('fetchLogsForMotorista: supabase não disponível');
                setLogsHistory([]);
                return;
            }
            const { data, error } = await sb.from('logs_roteirizacao').select('*').eq('motorista_id', motoristaId).order('created_at', { ascending: false }).limit(3);
            if (error) { console.error('fetchLogsForMotorista: erro', error); setLogsHistory([]); return; }
            setLogsHistory(Array.isArray(data) ? data : []);
        } catch (e) { console.error('fetchLogsForMotorista: exceção', e); setLogsHistory([]); }
    }

    useEffect(() => { try { if (motoristaDaRota && motoristaDaRota.id) fetchLogsForMotorista(String(motoristaDaRota.id)); else setLogsHistory([]); } catch (e) { /* ignore */ } }, [motoristaDaRota]);

    // Realtime: Conexão FORÇADA para atualização instantânea (Pinos Verdes/Vermelhos)
    useEffect(() => {
        if (!HAS_SUPABASE_CREDENTIALS) return;

        // 1. Carrega as entregas iniciais
        const fetchEntregas = async () => { try { await carregarDados(); } catch (e) { } };
        fetchEntregas();

        // 2. Cria o canal de escuta em tempo real (Modelo Exato solicitado)
        const sb = supabaseRef.current || supabase;
        if (!sb || typeof sb.channel !== 'function') return;

        const canal = sb.channel('monitoramento-entregas')
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'entregas' }, (payload) => {
                // FIXED: Lógica de atualização realtime robusta (Merge em vez de replace)
                const newRec = payload.new;
                if (!newRec || !newRec.id) return;
                const idStr = String(newRec.id);

                console.log('🔄 REALTIME UPDATE RECEIVED:', idStr, newRec.status);

                // 1. ATUALIZAÇÃO INSTANTÂNEA: Forçar re-render com novo status
                setEntregas((prev) => prev.map((e) => String(e.id) === idStr ? { ...e, status: newRec.status, observacoes: newRec.observacoes } : e));

                // 2. ATUALIZAÇÃO DA ROTA ATIVA (Pinos no Mapa)
                setRotaAtiva((prev) => {
                    if (!prev) return prev;

                    // Merge completo para garantir mudança de cor instantânea
                    const updated = prev.map((e) => {
                        if (String(e.id) === idStr) {
                            console.log('✅ ATUALIZANDO PINO NO MAPA:', idStr, 'Status:', newRec.status);
                            return { ...e, ...newRec };
                        }
                        return e;
                    });

                    // Se não estava na rota mas agora tem motorista e status relevante, adicionar (Independente de arquivado)
                    const statusLower = String(newRec.status || '').toLowerCase();
                    const temMotorista = !!newRec.motorista_id && String(newRec.motorista_id) !== 'null';

                    if (!prev.find(e => String(e.id) === idStr) && temMotorista) {
                        if (['em_rota', 'entregue', 'falha'].includes(statusLower)) {
                            console.log('🆕 ADICIONANDO PINO AO MAPA:', idStr);
                            return [...updated, { ...newRec }];
                        }
                    }

                    return updated;
                });

                // Atualiza Entregas em Espera
                setEntregasEmEspera((prev) => {
                    if (!prev) return prev;
                    const statusLower = String(newRec.status || '').toLowerCase().trim();
                    const temMotorista = (newRec.motorista_id !== null && newRec.motorista_id !== undefined && String(newRec.motorista_id) !== 'null');

                    // Se mudou para em_rota e JA tem motorista, remove da espera
                    // Se mudou para entregue ou falha, remove da espera
                    if (statusLower === 'entregue' || statusLower === 'falha' || temMotorista) {
                        return prev.filter(e => String(e.id) !== idStr);
                    }
                    return prev.map((e) => String(e.id) === idStr ? { ...e, ...newRec } : e);
                });

                // Atualiza AllEntregas
                setAllEntregas((prev) => (prev || []).map((e) => String(e.id) === idStr ? { ...e, ...newRec } : e));
            })
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'entregas' }, (payload) => {
                if (payload.new) {
                    const statusLower = String(payload.new.status || '').toLowerCase().trim();
                    if (statusLower === 'pendente') {
                        setEntregasEmEspera(prev => [payload.new, ...(prev || [])]);
                    }
                    setAllEntregas(prev => [payload.new, ...(prev || [])]);
                }
            })
            .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'entregas' }, (payload) => {
                if (payload.old && payload.old.id) {
                    const id = String(payload.old.id);
                    setRotaAtiva(prev => prev.filter(e => String(e.id) !== id));
                    setEntregasEmEspera(prev => prev.filter(e => String(e.id) !== id));
                    setEntregas(prev => prev.filter(e => String(e.id) !== id));
                }
            })
            .subscribe();

        // 3. Limpa o canal ao fechar a página
        return () => {
            const currentSb = supabaseRef.current || supabase;
            if (currentSb && typeof currentSb.removeChannel === 'function') {
                currentSb.removeChannel(canal);
            }
        };
    }, [supabaseConnectedLocal]);

    // Auto-zoom / fitBounds behavior for Leaflet Map when pontos mudam (only SC-valid points)
    // ESTABILIZAÇÃO GURMET: Só dispara fitBounds se a contagem de pinos mudar significativamente
    // ou se for o primeiro carregamento da rota. Evita o bug de "pular na bike".
    const lastPinsCountRef = useRef(0);
    useEffect(() => {
        if (!mapRef.current || typeof mapRef.current.getPane !== 'function') return;
        const map = mapRef.current;
        if (!map._loaded) return;

        const pinsDeliveries = (orderedRota || []).filter(p => isValidSC(Number(p.lat), Number(p.lng))).map(p => [Number(p.lat), Number(p.lng)]);
        const motoCoords = (frota || []).filter(m => m.esta_online === true && isValidSC(Number(m.lat), Number(m.lng))).map(m => [Number(m.lat), Number(m.lng)]);

        const todosOsPontos = [...pinsDeliveries, ...motoCoords];

        // Se não mudou o número de entregas, não pula a câmera (evita jitter/jump ao atualizar GPS)
        if (pinsDeliveries.length === lastPinsCountRef.current && pinsDeliveries.length > 0) {
            return;
        }

        lastPinsCountRef.current = pinsDeliveries.length;

        if (todosOsPontos.length === 0) return;

        // Se SÓ houver moto (sem entregas), NÃO pula nela (mantém o contexto)
        if (pinsDeliveries.length === 0) {
            console.log('ℹ️ Estabilização: Apenas moto detectada, mantendo câmera fixa.');
            return;
        }

        try {
            const bounds = L.latLngBounds(todosOsPontos);
            if (bounds.isValid()) {
                map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
            }
        } catch (e) { }
    }, [orderedRota, frota]);

    // Remover motoristas sem atualização há mais de 2 minutos (evita 'fantasmas')
    useEffect(() => {
        if (EMERGENCY_POLLING_DISABLED) return; // disabled temporarily for stabilization
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

    // ===== FUZZY SEARCH: Funções de similaridade e sugestões =====

    // Calcula distância de Levenshtein (similaridade entre strings)
    const levenshteinDistance = (str1, str2) => {
        const s1 = str1.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const s2 = str2.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

        const len1 = s1.length;
        const len2 = s2.length;
        const matrix = [];

        for (let i = 0; i <= len2; i++) {
            matrix[i] = [i];
        }

        for (let j = 0; j <= len1; j++) {
            matrix[0][j] = j;
        }

        for (let i = 1; i <= len2; i++) {
            for (let j = 1; j <= len1; j++) {
                if (s2.charAt(i - 1) === s1.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }

        return matrix[len2][len1];
    };

    // Calcula similaridade percentual entre duas strings
    const calcularSimilaridade = (str1, str2) => {
        const distance = levenshteinDistance(str1, str2);
        const maxLen = Math.max(str1.length, str2.length);
        return maxLen === 0 ? 100 : ((maxLen - distance) / maxLen) * 100;
    };

    // Busca sugestões de ruas similares usando Nominatim
    const buscarSugestaoSimilar = async (enderecoOriginal, bairro, cidade) => {
        try {
            console.log(`🔍 Buscando sugestão similar para: "${enderecoOriginal}" em ${bairro}, ${cidade}`);

            // Extrair nome da rua do endereço original
            const ruaOriginal = enderecoOriginal.split(',')[0].trim()
                .replace(/^(rua|avenida|av|travessa|trav|alameda|estrada)\s+/i, ''); // Remove prefixos

            console.log(`📍 Rua extraída para comparação: "${ruaOriginal}"`);

            // Buscar especificamente por ruas/streets no bairro usando Nominatim
            const searchQuery = `street ${bairro} ${cidade} SC`;
            const viewbox = '-48.85,-27.85,-48.35,-27.35';

            const url = `https://nominatim.openstreetmap.org/search?` +
                `q=${encodeURIComponent(searchQuery)}` +
                `&format=json` +
                `&viewbox=${viewbox}` +
                `&bounded=1` +
                `&addressdetails=1` +
                `&featuretype=street` +
                `&limit=50`;

            console.log(`🌐 URL Nominatim para busca de ruas: ${url}`);

            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Adecell_Logistica_v2',
                    'Accept-Language': 'pt-BR,pt;q=0.9'
                }
            });

            if (!response.ok) {
                console.warn('⚠️ Nominatim retornou erro na busca de ruas');
                return null;
            }

            const data = await response.json();
            console.log(`📊 Nominatim retornou ${data.length} resultados`);

            // Buscar melhor correspondência
            let melhorMatch = null;
            let melhorSimilaridade = 0;

            data.forEach(item => {
                const ruaEncontrada = item.address?.road || item.address?.street || item.display_name?.split(',')[0];

                if (ruaEncontrada) {
                    const ruaLimpa = ruaEncontrada.replace(/^(rua|avenida|av|travessa|trav|alameda|estrada)\s+/i, '');
                    const similaridade = calcularSimilaridade(ruaOriginal, ruaLimpa);

                    console.log(`🔍 Comparando "${ruaOriginal}" vs "${ruaLimpa}": ${similaridade.toFixed(1)}%`);

                    // Considerar sugestão se similaridade >= 60%
                    if (similaridade >= 60 && similaridade > melhorSimilaridade) {
                        melhorSimilaridade = similaridade;
                        melhorMatch = {
                            rua: ruaEncontrada,
                            endereco: item.display_name,
                            lat: parseFloat(item.lat),
                            lng: parseFloat(item.lon),
                            similaridade: similaridade.toFixed(1)
                        };
                    }
                }
            });

            if (melhorMatch) {
                console.log(`✨ Sugestão encontrada: "${melhorMatch.rua}" (${melhorMatch.similaridade}% similar)`);
            } else {
                console.warn('❌ Nenhuma rua similar encontrada (threshold 60%)');
            }

            return melhorMatch;
        } catch (error) {
            console.error('❌ Erro ao buscar sugestão similar:', error);
            return null;
        }
    };

    // Função auxiliar para salvar entrega com coordenadas
    const salvarEntregaComCoordenadas = async (lat, lng, cliente, endereco, observacoes, tipo) => {
        const sb = supabaseRef.current || supabase;
        if (!sb || typeof sb.from !== 'function') {
            console.error('❌ Supabase não disponível');
            alert('Banco de dados indisponível no momento. Aguarde alguns segundos e tente novamente.');
            return;
        }

        // Validação final: NUNCA salvar sem coordenadas válidas
        if (lat === null || lng === null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
            console.error('❌ BLOQUEIO: Tentativa de salvar entrega sem coordenadas válidas');
            alert('❌ Erro: Não é possível salvar entrega sem coordenadas exatas.');
            return;
        }

        // VALIDAÇÃO: Verificar duplicatas (< 10 metros) - APENAS para entregas de HOJE
        try {
            const now = new Date();
            // Início do dia em UTC para comparação robusta com Supabase (created_at)
            const hojeInicioUtc = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

            const { data: existentes } = await sb.from('entregas')
                .select('id,cliente,endereco,lat,lng,created_at')
                .gte('created_at', hojeInicioUtc); // Filtro rigoroso: Ignorar alertas de endereços antigos

            if (existentes && existentes.length > 0) {
                const TOLERANCIA_METROS = 10;
                const duplicata = existentes.find(e => {
                    if (!e.lat || !e.lng) return false;
                    const distancia = haversineKm({ lat: e.lat, lng: e.lng }, { lat, lng }) * 1000;
                    return distancia < TOLERANCIA_METROS;
                });

                if (duplicata) {
                    const confirmar = confirm(
                        `⚠️ ATENÇÃO: Coordenadas muito próximas!\n\n` +
                        `Já existe entrega cadastrada a menos de ${TOLERANCIA_METROS}m deste local:\n\n` +
                        `• Cliente: ${duplicata.cliente}\n` +
                        `• Endereço: ${duplicata.endereco}\n\n` +
                        `Deseja continuar mesmo assim?`
                    );

                    if (!confirmar) {
                        console.log('⚠️ Usuário cancelou salvamento por coordenadas duplicadas');
                        return;
                    }
                }
            }
        } catch (err) {
            console.warn('⚠️ Não foi possível verificar duplicatas (não crítico):', err);
        }

        console.log('✅ Salvando entrega com coordenadas validadas:', { cliente, endereco, lat, lng });

        // Adicionar observações diretamente
        const observacoesFinais = observacoes;

        const { error } = await sb.from('entregas').insert([{
            cliente: cliente,
            endereco: endereco,
            tipo: String(tipo || '').trim(),
            lat: lat,
            lng: lng,
            status: String(NEW_LOAD_STATUS).trim().toLowerCase(),
            observacoes: observacoesFinais
        }]);

        if (!error) {
            alert("✅ Salvo com sucesso!");
            setNomeCliente('');
            setEnderecoEntrega('');
            setObservacoesGestor('');
            setEnderecoCoords(null);
            setEnderecoFromHistory(false);
            setDraftPoint(null);
            try { carregarDados(); } catch (e) { }
        } else {
            alert('❌ Erro ao salvar: ' + (error.message || 'Erro desconhecido'));
        }
    };

    // Função auxiliar para continuar geocodificação após escolha de cidade
    const continuarGeocod = async (enderecoCompleto, cidadeDetectada, clienteVal, obsValue, tipoEncomenda) => {
        try {
            console.log('🔍 GEOCODIFICAÇÃO CIRÚRGICA:', { enderecoCompleto, cidadeDetectada });
            console.log('� Tentando Photon primeiro...');
            let result = await geocodeMapbox(enderecoCompleto);

            // Fallback 1: Photon se Mapbox falhar
            if (!result) {
                console.log('🔄 Mapbox falhou, tentando Photon...');
                result = await geocodePhoton(enderecoCompleto);
            }

            // Fallback 2: Nominatim se Photon falhar
            if (!result) {
                console.log('🔄 Photon falhou, tentando Nominatim...');
                result = await geocodeNominatim(enderecoCompleto);
            }

            let lat = null;
            let lng = null;

            if (result && result.lat != null && result.lng != null) {
                lat = result.lat;
                lng = result.lng;

                console.log('✅ Endereço geocodificado com sucesso:', enderecoCompleto, '->', { lat, lng });

                // Salvar entrega com coordenadas
                await salvarEntregaComCoordenadas(lat, lng, clienteVal, enderecoCompleto.split(',')[0], obsValue, tipoEncomenda);
            } else {
                console.error('❌ Nominatim não encontrou coordenadas para:', enderecoCompleto);

                // FUZZY SEARCH: Tentar buscar sugestão similar
                const partes = enderecoCompleto.split(',');
                const bairroDetectado = partes[partes.length - 3]?.trim();

                if (cidadeDetectada && bairroDetectado) {
                    console.log(`🔍 Tentando buscar sugestão similar...`);
                    const sugestao = await buscarSugestaoSimilar(enderecoCompleto, bairroDetectado, cidadeDetectada);

                    if (sugestao) {
                        setAddressSuggestion({
                            original: enderecoCompleto,
                            sugestao: sugestao.rua,
                            endereco: sugestao.endereco,
                            lat: sugestao.lat,
                            lng: sugestao.lng,
                            similaridade: sugestao.similaridade,
                            cliente: clienteVal,
                            observacoes: obsValue,
                            tipo: tipoEncomenda,
                            alertaSemNumero
                        });
                        setIsGeocoding(false);
                        setPendingAddressData(null);
                        return; // Não mostrar alert - mostrar sugestão
                    }
                }

                // Sem sugestão - mostrar erro visual na tela
                console.warn('❌ Endereço não encontrado e sem sugestões similares:', enderecoCompleto);

                setGeocodingError({
                    message: `Endereço "${enderecoCompleto}" não foi encontrado`,
                    suggestions: 'Verifique: 1) Nome da rua, 2) Número, 3) Bairro correto, 4) Cidade (Biguaçu, São José, Florianópolis, Palhoça, Santo Amaro da Imperatriz)'
                });

                setIsGeocoding(false);
                setPendingAddressData(null);
            }
        } catch (error) {
            console.error('❌ Erro na geocodificação:', error);
            console.warn('Verifique sua conexão com a internet.');
        } finally {
            setIsGeocoding(false);
            setPendingAddressData(null);
        }
    };

    const adicionarAosPendentes = async (e) => {
        e.preventDefault();

        let lat = enderecoCoords?.lat;
        let lng = enderecoCoords?.lng;

        const obsValue = (observacoesGestor || '').trim();
        const clienteVal = (nomeCliente || '').trim();
        const enderecoVal = (enderecoEntrega || '').trim();

        if (!clienteVal || !enderecoVal) {
            alert('Preencha nome do cliente e endereço.');
            return;
        }

        setIsGeocoding(true);
        try {
            // Geocodificação via serviço EXTERNO se não vier do autocomplete
            if (!lat || !lng) {
                console.log('🔍 Geocodificando endereço via GeocodingService:', enderecoVal);
                const result = await geocodeMapbox(enderecoVal) ||
                    await geocodePhoton(enderecoVal) ||
                    await geocodeNominatim(enderecoVal);

                if (result) {
                    lat = result.lat;
                    lng = result.lng;
                    console.log('✅ Localizado:', { lat, lng });

                    // Bloqueio de Fallback Genérico (Praça 15)
                    const PRACA_15 = { lat: -27.5969, lng: -48.5495 };
                    const distPraca15 = haversineKm(PRACA_15, { lat, lng }) * 1000;
                    const addrLower = enderecoVal.toLowerCase();
                    const isCentro = addrLower.includes('centro') || addrLower.includes('praça') || addrLower.includes('praca');

                    if (distPraca15 < 100 && !isCentro) {
                        alert(`⚠️ Localização imprecisa!\n\nO endereço foi mapeado no centro de Florianópolis (Praça 15).\n\nVerifique se o número e bairro estão corretos para garantir a entrega no local exato.`);
                        setIsGeocoding(false);
                        return;
                    }
                } else {
                    setGeocodingError({
                        message: `Endereço "${enderecoVal}" não encontrado.`,
                        suggestions: 'Verifique o número, bairro e cidade (Florianópolis, São José, Palhoça, etc).'
                    });
                    setIsGeocoding(false);
                    return;
                }
            }

            const sb = supabaseRef.current || supabase;
            if (!sb) return;

            // VALIDAÇÃO DE DUPLICIDADE (Hoje + Pendente/Em Rota + <10m + Mesmo Tipo)
            const nowForHoje = new Date();
            const hojeInicioUtc = new Date(nowForHoje.getFullYear(), nowForHoje.getMonth(), nowForHoje.getDate()).toISOString();

            const { data: existentes } = await sb.from('entregas')
                .select('id, cliente, lat, lng, created_at, status, tipo')
                .in('status', ['pendente', 'em_rota', 'em rota'])
                .gte('created_at', hojeInicioUtc);

            if (existentes && existentes.length > 0) {
                const duplicata = existentes.find(ex => {
                    const d = haversineKm({ lat: ex.lat, lng: ex.lng }, { lat, lng }) * 1000;
                    const mesmoTipo = String(ex.tipo || '').toLowerCase() === String(tipoEncomenda || '').toLowerCase();
                    return d < 10 && mesmoTipo;
                });

                if (duplicata) {
                    confirm(`⚠️ Entrega DUPLICADA hoje!\n\nJá existe uma ${duplicata.tipo} pendente para este local hoje (Cliente: ${duplicata.cliente}).\n\nEste é apenas um aviso.`);
                }
            }

            console.log('💾 Salvando entrega...');
            const { error } = await sb.from('entregas').insert([{
                cliente: clienteVal,
                endereco: enderecoVal,
                tipo: String(tipoEncomenda || 'Entrega').trim(),
                lat, lng,
                status: 'pendente',
                observacoes: obsValue
            }]);

            if (!error) {
                alert("✅ Salvo com sucesso!");
                setNomeCliente(''); setEnderecoEntrega(''); setObservacoesGestor('');
                setEnderecoCoords(null); setDraftPoint(null);
                carregarDados();
            } else {
                alert('❌ Erro ao salvar: ' + error.message);
            }
        } catch (err) {
            console.error('❌ adiconarAosPendentes falhou:', err);
        } finally {
            setIsGeocoding(false);
        }
    };

    const excluirPedido = async (id) => {
        const parsedId = typeof id === 'string' ? parseInt(id, 10) : id;
        if (!parsedId || isNaN(parsedId)) {
            console.warn('❌ excluirPedido: id inválido', id);
            return;
        }

        const sb = supabaseRef.current || supabase;
        if (!sb || typeof sb.from !== 'function') {
            console.warn('❌ excluirPedido: supabase not initialized');
            return;
        }

        console.log('🗑️ Cancelando entrega (Soft Delete) ID:', parsedId);
        // Em vez de deletar fisicamente, mudamos o status para 'cancelado'
        // Assim protegemos os dados e o pedido some do despacho pelo filtro de status
        const { error } = await sb.from('entregas').update({ status: 'cancelado' }).eq('id', parsedId);

        if (error) {
            console.error('❌ Erro ao cancelar entrega:', error);
        } else {
            console.log('✅ Entrega cancelada com sucesso!');
            carregarDados();
        }
    };

    // Marcar entrega como concluída com atualização instantânea (otimista)
    const marcarComoConcluida = async (entregaId) => {
        const sb = supabaseRef.current || supabase;
        if (!sb || typeof sb.from !== 'function') {
            console.error('❌ Supabase não disponível');
            return;
        }

        // Atualização otimista: atualizar estado local ANTES do banco
        setAllEntregas(prev =>
            prev.map(e => e.id === entregaId ? { ...e, status: 'entregue' } : e)
        );
        setEntregasEmEspera(prev =>
            prev.map(e => e.id === entregaId ? { ...e, status: 'entregue' } : e)
        );
        setRotaAtiva(prev =>
            prev.map(e => e.id === entregaId ? { ...e, status: 'entregue' } : e)
        );

        // Atualizar no banco
        const { error } = await sb.from('entregas')
            .update({ status: 'entregue' })
            .eq('id', entregaId);

        if (error) {
            console.error('❌ Erro ao marcar como concluída:', error);
            // Reverter atualização otimista em caso de erro
            carregarDados();
        } else {
            console.log('✅ Entrega marcada como concluída:', entregaId);
        }
    };

    // Marcar entrega como falha/cancelada com atualização instantânea (otimista)
    const marcarComoFalha = async (entregaId) => {
        const sb = supabaseRef.current || supabase;
        if (!sb || typeof sb.from !== 'function') {
            console.error('❌ Supabase não disponível');
            return;
        }

        // Atualização otimista: atualizar estado local ANTES do banco
        setAllEntregas(prev =>
            prev.map(e => e.id === entregaId ? { ...e, status: 'falha' } : e)
        );
        setEntregasEmEspera(prev =>
            prev.map(e => e.id === entregaId ? { ...e, status: 'falha' } : e)
        );
        setRotaAtiva(prev =>
            prev.map(e => e.id === entregaId ? { ...e, status: 'falha' } : e)
        );

        // Atualizar no banco
        const { error } = await sb.from('entregas')
            .update({ status: 'falha' })
            .eq('id', entregaId);

        if (error) {
            console.error('❌ Erro ao marcar como falha:', error);
            // Reverter atualização otimista em caso de erro
            carregarDados();
        } else {
            console.log('⚠️ Entrega marcada como falha:', entregaId);
        }
    };

    const dispararRota = async () => {
        if (entregasEmEspera.length === 0) return alert("⚠️ Fila vazia.");
        // Open driver selector modal to choose which driver will receive the route
        setShowDriverSelect(true);
    };

    // Assign a selected driver: optimize route and update each entrega to 'em_rota' with motorista_id e ordem
    const assignDriver = async (driver) => {
        // allow caller to omit driver and use selectedMotorista from state
        if ((!driver || !driver.id) && selectedMotorista) driver = selectedMotorista;
        const selectedDriver = driver || selectedMotorista || null;
        if (!selectedDriver?.id) {
            console.error('Erro: Nenhum motorista selecionado');
            return;
        }
        // Garantir que usamos UUID como string (nunca converter para Number)
        const motoristaIdVal = String(selectedDriver.id);

        // Obter referência do Supabase uma única vez para toda a função
        const sb = supabaseRef.current || supabase;

        const nomeCompleto = `${selectedDriver.nome || ''} ${selectedDriver.sobrenome || ''}`.trim();

        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('🚀 INICIANDO ENVIO DE ROTA');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('🆔 ID do Motorista:', motoristaIdVal);
        console.log('👤 Nome Completo:', nomeCompleto);
        console.log('🔌 Status:', selectedDriver.esta_online ? 'Online ✅' : 'Offline ⚠️');
        console.log('📦 Entregas a enviar:', entregasEmEspera.length);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

        // VALIDAÇÃO CRÍTICA: verificar se há entregas antes de processar
        if (!entregasEmEspera || entregasEmEspera.length === 0) {
            console.error('❌ Nenhuma entrega disponível para despacho');
            alert('❌ Erro: Não há entregas disponíveis para enviar. Verifique se há pedidos pendentes na Central de Despacho.');
            setDispatchLoading(false);
            return;
        }

        setDispatchLoading(true);
        try {
            try { audioRef.current.play().catch(() => { }); } catch (e) { }
            let rotaOtimizada = [];
            let tempoEstimado = 0;

            // Otimizar com algoritmo local (Nearest Neighbor)
            try {
                try { setDistanceCalculating(true); } catch (e) { }
                rotaOtimizada = await otimizarRotaLocal(mapCenterState, entregasEmEspera, motoristaIdVal);
                try { setDistanceCalculating(false); } catch (e) { }
            } catch (e) {
                console.warn('⚠️ Otimização local falhou:', e);
            }

            // FALLBACK: Se otimização retornar vazio, usar TODAS as entregas em espera
            if (!rotaOtimizada || rotaOtimizada.length === 0) {
                console.warn('⚠️ Otimização retornou 0 entregas - usando lista completa de espera');
                rotaOtimizada = [...entregasEmEspera]; // Clonar array

                // Adicionar ordem sequencial básica
                rotaOtimizada = rotaOtimizada.map((e, idx) => ({
                    ...e,
                    ordem: idx + 1,
                    ordem_logistica: idx + 1
                }));

                console.log('✅ Rota criada com ordem sequencial:', rotaOtimizada.length, 'entregas');
            }

            console.log('🗺️ Rota final para despacho:', rotaOtimizada.length, 'paradas');

            // Validate motorista exists in local `frota` to avoid sending wrong id
            const motoristaExists = frota && frota.find ? frota.find(m => String(m.id) === String(motoristaIdVal)) : null;
            if (!motoristaExists) console.warn('assignDriver: motorista_id não encontrado na frota local', motoristaIdVal);
            // status para despacho: seguir regra solicitada ('pendente')
            const statusValue = String('em_rota').trim().toLowerCase();

            // Determine entregas to dispatch and collect their IDs (preserve original type)
            const entregasParaDespachar = rotaOtimizada || []; // use rota otimizada as the set to dispatch
            const assignedIds = entregasParaDespachar.map(p => p.id).filter(id => id !== undefined && id !== null);
            const assignedIdsStr = assignedIds.map(id => String(id));

            console.log('🎯 IDs das entregas:', assignedIds);
            console.log('📝 Status a aplicar:', statusValue);
            console.log('🔗 Vinculando entregas ao motorista_id:', motoristaIdVal);

            if (assignedIds.length === 0) {
                console.warn('⚠️ assignDriver: nenhum pedido válido para atualizar');
                alert('❌ Erro: Nenhuma entrega válida para enviar. Verifique se há entregas selecionadas.');
                return;
            } else {
                if (!sb || typeof sb.from !== 'function') {
                    console.error('❌ Supabase não disponível para atualizar entregas');
                    alert('❌ Erro: Sistema não está conectado ao banco de dados.');
                    return;
                }

                console.log('💾 Atualizando entregas no banco de dados...');
                console.log('   Campo motorista_id =', motoristaIdVal);
                console.log('   Campo status =', statusValue);

                let updErr = null;
                try {
                    // Atualizar EXCLUSIVAMENTE por ID (UUID) - nunca por nome
                    let q = sb.from('entregas').update({ motorista_id: motoristaIdVal, status: statusValue });
                    if (q && typeof q.in === 'function') {
                        const { data: updData, error } = await q.in('id', assignedIds);
                        updErr = error;
                        if (!updErr) {
                            console.log('✅ Entregas atualizadas no banco (bulk update)');

                            // GRAVAÇÃO DA ORDEM LOGÍSTICA (Crucial para o Motorista)
                            console.log('📦 Gravando sequência de entrega no banco...');
                            for (let i = 0; i < rotaOtimizada.length; i++) {
                                const pedido = rotaOtimizada[i];
                                const ordemSeq = i + 1;
                                try {
                                    await sb.from('entregas')
                                        .update({ ordem_logistica: ordemSeq })
                                        .eq('id', pedido.id);
                                } catch (errOrder) {
                                    console.error(`❌ Erro ao salvar ordem da entrega ${pedido.id}:`, errOrder);
                                }
                            }
                            console.log('✅ Sequência logística gravada!');

                            setEntregasEmEspera(prev => prev.filter(p => !assignedIdsStr.includes(String(p.id))));
                        } else {
                            console.error('❌ Erro no bulk update:', error);
                        }
                    } else {
                        // Fallback: update one by one
                        for (const id of assignedIds) {
                            try {
                                const { error } = await sb.from('entregas').update({ motorista_id: motoristaIdVal, status: statusValue }).eq('id', id);
                                if (error) { updErr = error; console.error('Erro atualizando entrega individual:', error); break; }
                            } catch (e) { updErr = e; console.error('Erro na requisição individual:', e); break; }
                        }
                        if (!updErr) setEntregasEmEspera(prev => prev.filter(p => !assignedIdsStr.includes(String(p.id))));
                    }
                } catch (err) {
                    updErr = err;
                    console.error('Erro ao tentar atualizar entregas (bulk ou individual):', err && err.message ? err.message : err);
                }

                // Update local rotaOtimizada objects with ordem for UI only
                for (let i = 0; i < rotaOtimizada.length; i++) {
                    const pedido = rotaOtimizada[i];
                    const pid = pedido.id;
                    rotaOtimizada[i] = { ...pedido, ordem: i + 1, ordem_logistica: i + 1, motorista_id: motoristaIdVal, id: pid };
                }

                // Update estimated distance (after assignment)
                try {
                    const originForCalc = mapCenterState || pontoPartida || DEFAULT_MAP_CENTER;
                    const dist = computeRouteDistanceKm(originForCalc, rotaOtimizada, originForCalc);
                    setEstimatedDistanceKm(Number(dist.toFixed(1)));
                } catch (e) { /* ignore */ }

                // Only close modal and clear selection if update succeeded
                if (!updErr) {
                    console.log('✅ Bulk update bem-sucedido - sincronizando estado local...');
                    // Forçar atualização do estado local IMEDIATAMENTE
                    setEntregasEmEspera(prev => {
                        const updated = prev.filter(p => !assignedIdsStr.includes(String(p.id)));
                        console.log(`🔄 Estado local atualizado: ${prev.length} → ${updated.length} entregas`);
                        return updated;
                    });
                    setShowDriverSelect(false);
                    setSelectedMotorista(null);
                } else {
                    console.error('❌ Bulk update falhou - mantendo modal aberto');
                    alert('❌ Erro ao atualizar entregas no banco de dados. Verifique a conexão e tente novamente.');
                    setDispatchLoading(false);
                    return;
                }
            }
            // Persist ordem_logistica per entrega (cada pedido precisa da sua ordem específica)
            try {
                for (let i = 0; i < rotaOtimizada.length; i++) {
                    const pid = rotaOtimizada[i].id;
                    if (pid === undefined || pid === null) continue;
                    try {
                        const { error: ordErr } = await sb.from('entregas').update({ ordem_logistica: Number(i + 1) }).eq('id', pid);
                        if (ordErr) {
                            console.error('Erro atualizando ordem_logistica:', ordErr && ordErr.message, ordErr && ordErr.hint);
                        } else {
                            console.log(`✅ Ordem ${i + 1} atribuída à entrega ${pid}`);
                        }
                    } catch (e) {
                        console.error('Erro na requisição ordem_logistica:', e && e.message);
                    }
                }
            } catch (e) { /* non-blocking */ }

            // NOTIFICAR MOTORISTA: usar tabela motoristas em vez de broadcast (mais confiável)
            if (!sb || typeof sb.from !== 'function') {
                console.error('❌ Supabase não disponível para notificação');
                alert('⚠️ Aviso: A rota foi salva no banco, mas a notificação falhou. O motorista precisará atualizar o app.');
            } else {
                try {
                    const dadosParaMotorista = {
                        motorista_id: motoristaIdVal,
                        motorista_nome: selectedDriver.nome || 'Motorista',
                        total_entregas: rotaOtimizada.length,
                        entregas: rotaOtimizada.map((e, idx) => ({
                            id: e.id,
                            cliente: e.cliente,
                            endereco: e.endereco,
                            lat: e.lat,
                            lng: e.lng,
                            ordem: idx + 1,
                            tipo: e.tipo,
                            status: 'em_rota'
                        })),
                        timestamp: new Date().toISOString()
                    };

                    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                    console.log('📡 NOTIFICANDO MOTORISTA VIA POSTGRES UPDATE');
                    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                    console.log('🎯 Enviando rota para o ID:', motoristaIdVal);
                    console.log('👤 Nome do motorista:', nomeCompleto);
                    console.log('📦 Total de entregas:', rotaOtimizada.length);
                    console.log('🔍 Dados completos:', dadosParaMotorista);
                    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

                    // Atualizar tabela motoristas EXCLUSIVAMENTE por ID (UUID)
                    // O celular está escutando UPDATE nessa tabela via postgres_changes
                    // IMPORTANTE: ultima_atualizacao é o gatilho que o celular observa
                    const { error: notifError } = await sb
                        .from('motoristas')
                        .update({
                            ultima_atualizacao: new Date().toISOString()  // ✅ Gatilho para o celular
                        })
                        .eq('id', motoristaIdVal);  // FILTRO POR ID (UUID) - NÃO POR NOME!

                    if (notifError) {
                        console.error('❌ Erro ao atualizar motorista:', notifError);
                        throw notifError;
                    } else {
                        console.log('✅ Motorista notificado com sucesso!');
                        console.log('✅ Campo ultima_atualizacao atualizado → Celular vai detectar');
                        console.log('📱 Celular buscará: motorista_id=' + motoristaIdVal + ' + status=em_rota');
                    }

                } catch (notifError) {
                    console.error('❌ Erro ao notificar motorista:', notifError);
                    console.error('❌ Stack:', notifError.stack);
                    alert('⚠️ Aviso: A rota foi salva, mas houve um erro ao notificar o motorista: ' + (notifError.message || notifError));
                }
            }

            setRotaAtiva(rotaOtimizada);
            setMotoristaDaRota(driver);
            setAbaAtiva('Visão Geral');

            // 🧹 LIMPEZA AUTOMÁTICA: Limpar entregas da lista após envio bem-sucedido
            console.log('🧹 Limpando entregas enviadas da lista...');
            setEntregasEmEspera(prev => {
                const idsEnviados = rotaOtimizada.map(e => e.id);
                return prev.filter(e => !idsEnviados.includes(e.id));
            });
            console.log('✅ Dashboard limpo - entregas enviadas removidas da lista');

            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log('✅ ROTA ENVIADA COM SUCESSO!');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log('👤 Motorista:', driver.nome, driver.sobrenome);
            console.log('🆔 ID do Motorista:', motoristaIdVal);
            console.log('📦 Total de entregas:', rotaOtimizada.length);
            console.log('📍 Lista de paradas:', rotaOtimizada.map((e, i) => `${i + 1}. ${e.cliente} - ${e.endereco}`).join('\n'));
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

            await carregarDados();

            // Alerta de sucesso detalhado
            const msgSucesso = `✅ Rota enviada com sucesso!\n\n👤 Motorista: ${driver.nome || 'motorista'}\n📦 Entregas: ${rotaOtimizada.length}\n📡 Status: ${rotaOtimizada.length > 0 ? 'Notificação enviada' : 'Sem entregas'}`;
            alert(msgSucesso);

            // Recalcular e desenhar rota otimizada para o motorista designado
            try { await recalcRotaForMotorista(String(motoristaIdVal)); } catch (e) { console.warn('⚠️ Falha ao recalcular rota após assignDriver:', e); }
        } catch (e) {
            console.error('❌ ERRO CRÍTICO em assignDriver:', e);
            alert('❌ Erro ao enviar rota: ' + (e.message || e) + '\n\nVerifique o console para mais detalhes.');
        } finally {
            // Limpeza de estados residuais
            setShowDriverSelect(false);
            setSelectedMotorista(null);
            setDispatchLoading(false);
        }
    };

    // --- NOVA INTERFACE (AQUI ESTÁ A MUDANÇA VISUAL) ---
    const motoristas = frota || [];

    // Use explicit aprovado boolean to split lists
    const motoristasAtivos = (frota || []).filter(m => m && m.aprovado === true);
    const motoristasPendentes = (frota || []).filter(m => {
        try {
            const acessoPend = String((m && m.acesso) || '').trim().toLowerCase() === 'pendente';
            const aprovadoFalse = (m && (m.aprovado === false || String(m.aprovado || '').trim().toLowerCase() === 'false'));
            return acessoPend || aprovadoFalse;
        } catch (e) { return false; }
    });

    // Handler used by DriverSelectModal: either dispatch or re-optimize depending on mode
    async function handleDriverSelect(m) {
        if (!m || !m.id) return;
        if (driverSelectMode === 'dispatch') {
            return assignDriver(m);
        }
        // reoptimize path for selected driver (no send)
        setDispatchLoading(true);
        try {
            // clear cached route UI and indicators
            try { if (routePolylineRef.current) { routePolylineRef.current.setMap(null); routePolylineRef.current = null; } } catch (e) { }
            try { setDraftPreview([]); setEstimatedDistanceKm(null); setEstimatedTimeSec(null); setEstimatedTimeText(null); } catch (e) { }

            await recalcRotaForMotorista(String(m.id));
            try { pendingRecalcRef.current.delete(String(m.id)); setPendingRecalcCount(pendingRecalcRef.current.size); } catch (e) { }
            // close modal and show success feedback after persistence
            try { setShowDriverSelect(false); } catch (e) { }
            try { alert('✅ Rota re-otimizada e gravada para ' + (m.nome || 'motorista') + '.'); } catch (e) { }
        } catch (e) {
            console.warn('handleDriverSelect (reopt) failed:', e);
            try { alert('Falha na re-otimização: ' + (e && e.message ? e.message : String(e))); } catch (err) { }
        } finally {
            setDispatchLoading(false);
        }
    }

    // Se estivermos na página de aprovação (/aprovar), renderiza a tela exclusiva
    try {
        if (typeof window !== 'undefined' && window.location.pathname === '/aprovar') {
            return <TelaAprovacaoMotorista />;
        }
    } catch (e) { /* ignore */ }

    const appContent = (
        <div style={{ minHeight: '100vh', width: '100vw', overflowX: 'hidden', margin: 0, padding: 0, backgroundColor: '#071228', fontFamily: "'Inter', sans-serif", color: theme.textMain }}>
            {/* Animação CSS para sugestão fuzzy search */}
            <style>{`
                @keyframes slideDown {
                    from {
                        opacity: 0;
                        transform: translateY(-10px);
                    }
                    to {
                        opacity: 1;
                        transform: translateY(0);
                    }
                }
                
                /* CSS do botão ADICIONAR À LISTA */
                button[type="submit"] {
                    width: 100% !important;
                    transition: all 0.2s ease;
                }
                
                button[type="submit"]:active:not(:disabled) {
                    transform: scale(0.95) !important;
                }
            `}</style>

            {missingSupabase && (
                <div style={{ width: '100%', background: '#7c2d12', color: '#fff', padding: '8px 12px', textAlign: 'center' }}>⚠️ Aviso: credenciais do Supabase ausentes — mostrando o modo de desenvolvimento/local. Configure <strong>VITE_SUPABASE_URL</strong> e <strong>VITE_SUPABASE_ANON_KEY</strong> em <code>.env.local</code> para habilitar dados em tempo real.</div>
            )}



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
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <h2 className="dashboard-title" style={{ margin: 0, fontSize: '20px', fontFamily: "Inter, Roboto, sans-serif", background: 'linear-gradient(to right, #3B82F6, #FFFFFF)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>DASHBOARD</h2>
                            <div style={{ fontSize: '13px', color: '#a9b8d3', background: 'rgba(255,255,255,0.02)', padding: '6px 8px', borderRadius: '8px' }} title="Motoristas online">Online: <strong style={{ color: '#60a5fa' }}>{motoristasOnlineCount}</strong></div>
                        </div>
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
                        <div style={{ color: theme.success, fontWeight: 'bold' }}>● SISTEMA ONLINE - {gestorLocation}</div>
                        <div style={{ opacity: 0.6 }}>Contato: {gestorPhone || '5548996525008'}</div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <button onClick={() => setDarkMode(d => !d)} style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)', background: 'transparent', color: theme.headerText, cursor: 'pointer' }}>{darkMode ? 'Modo Claro' : 'Modo Escuro'}</button>
                        <div style={{ color: theme.headerText, fontWeight: 700, marginLeft: '8px' }}>Gestor: {nomeGestor || 'Administrador'}</div>
                    </div>
                </div>
            </header>

            {/* Badge fixo removido — manter apenas o cabeçalho superior direito */}

            {/* 2. ÁREA DE CONTEÚDO */}


            <main style={{ maxWidth: '1450px', width: '95%', margin: '140px auto 0', padding: '0 20px' }}>


                {/* 3. KPIS (ESTATÍSTICAS RÁPIDAS) - Aparecem em todas as telas */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginBottom: '30px' }}>
                    <CardKPI titulo="TOTAL DE ENTREGAS" valor={totalEntregas} cor={theme.accent} />
                    <CardKPI titulo="MOTORISTAS ONLINE" valor={frota.filter(m => m.esta_online === true).length} cor={theme.success} />
                    <CardKPI titulo="ROTA ATIVA" valor={rotaAtiva.length > 0 ? 'EM ANDAMENTO' : 'AGUARDANDO'} cor={theme.primary} />
                </div>

                {/* VISÃO GERAL (DASHBOARD) */}
                {abaAtiva === 'Visão Geral' && (
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '30px' }}>

                        {/* MAPA EM CARD (DIMINUÍDO, REDIMENSIONÁVEL E ELEGANTE) */}
                        <div ref={mapContainerRef} style={{ background: theme.card, borderRadius: '16px', padding: '10px', boxShadow: theme.shadow, height: '500px', resize: 'vertical', overflow: 'hidden', minHeight: '450px', maxHeight: '800px', position: 'relative' }}>
                            <div style={{ height: '100%', borderRadius: '12px', overflow: 'hidden', position: 'relative' }}>
                                <ErrorBoundary>
                                    <MapContainer
                                        center={[mapCenterState.lat || DEFAULT_MAP_CENTER.lat, mapCenterState.lng || DEFAULT_MAP_CENTER.lng]}
                                        zoom={zoomLevel}
                                        style={{ width: '100%', height: '100%', borderRadius: '12px' }}
                                        ref={mapRef}
                                        whenReady={() => {
                                            console.log('🗺️ Mapa Leaflet inicializado e pronto');
                                        }}
                                    >
                                        {/* OpenStreetMap Tile Layer */}
                                        <TileLayer
                                            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                                            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                                        />

                                        {/* Motoristas online */}
                                        {(frota || []).filter(m => m.aprovado === true && m.esta_online === true && isValidSC(Number(m.lat), Number(m.lng))).map(motorista => {
                                            const lat = Number(motorista.lat);
                                            const lng = Number(motorista.lng);
                                            return (
                                                <Marker
                                                    key={`motorista-${motorista.id}`}
                                                    position={[lat, lng]}
                                                    icon={bikeIcon}
                                                >
                                                    <Tooltip permanent direction="top" offset={[0, -20]}>
                                                        <strong>{fullName(motorista)}</strong>
                                                    </Tooltip>
                                                    <Popup>
                                                        <div style={{ minWidth: '160px', fontSize: '13px' }}>
                                                            <strong>👤 Motorista:</strong> {fullName(motorista)}<br />
                                                            <strong>🚛 Veículo:</strong> {motorista.veiculo || 'Não informado'}<br />
                                                            <strong>📍 Local:</strong> {lat.toFixed(6)}, {lng.toFixed(6)}<br />
                                                            <strong>🚦 Status:</strong> <span style={{ color: '#10b981', fontWeight: 'bold' }}>ONLINE</span>
                                                        </div>
                                                    </Popup>
                                                </Marker>
                                            );
                                        })}

                                        {/* Entregas em espera (pendentes) */}
                                        {(() => {
                                            // REMOVIDO: Filtro por filterStatus para garantir que pinos não somam ao mudar visão do Dashboard
                                            const statusInvalidos = ['arquivado', 'cancelada', 'cancelado'];
                                            const todayStr = new Date().toDateString(); // Data de hoje local

                                            return (entregasEmEspera || []).filter(e => {
                                                const status = String(e.status || '').toLowerCase().trim();

                                                // FILTRO DE DATA (APENAS HOJE)
                                                if (e.created_at) {
                                                    const dt = new Date(e.created_at);
                                                    if (!isNaN(dt.getTime()) && dt.toDateString() !== todayStr) {
                                                        return false; // Ocultar entregas antigas
                                                    }
                                                }

                                                // FILTRO RIGOROSO: NUNCA renderizar se coordenadas forem inválidas
                                                if (!e.lat || !e.lng) return false; // null, undefined, 0, ''
                                                if (e.lat === 0 || e.lng === 0) return false; // Coordenadas zero (oceano)

                                                const lat = Number(e.lat);
                                                const lng = Number(e.lng);

                                                if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
                                                if (!isValidSC(lat, lng)) return false;

                                                return !statusInvalidos.includes(status);
                                            });
                                        })().map((entrega, idx) => {
                                            const tipo = String(entrega.tipo || 'Entrega').toLowerCase();
                                            const status = String(entrega.status || '').toLowerCase();
                                            const num = (entrega.ordem_logistica && entrega.ordem_logistica > 0) ? entrega.ordem_logistica : (idx + 1);

                                            return (
                                                <Marker
                                                    key={`${entrega.id}-${entrega.status}`} // Chave composta para forçar render imediato (Realtime)
                                                    position={[Number(entrega.lat), Number(entrega.lng)]}
                                                    icon={createPinIcon(tipo, status, entrega.observacoes)}
                                                    draggable={false}
                                                >
                                                    <Tooltip permanent direction="top" offset={[0, -42]} className="pin-tooltip" opacity={0.98}>
                                                        <span style={{ fontWeight: '600', fontSize: '12px' }}>{entrega.cliente}</span>
                                                    </Tooltip>
                                                    <Popup>
                                                        <div style={{ minWidth: '200px', fontSize: '13px', lineHeight: '1.6' }}>
                                                            <strong>📍 Local:</strong> {entrega.endereco}<br />
                                                            <strong>📋 Tipo:</strong> {tipo.toUpperCase()}<br />
                                                            <strong>🕒 Horário:</strong> {entrega.updated_at ? new Date(entrega.updated_at).toLocaleTimeString() : (entrega.created_at ? new Date(entrega.created_at).toLocaleTimeString() : 'Pendente')}<br />
                                                            <strong>🚦 Status:</strong>
                                                            <span style={{
                                                                color: status === 'falha' ? '#ef4444' : (['entregue', 'concluida', 'concluída'].includes(status) ? '#10b981' : '#3b82f6'),
                                                                fontWeight: 'bold',
                                                                marginLeft: '5px'
                                                            }}>
                                                                {status.toUpperCase() || 'PENDENTE'}
                                                            </span><br />
                                                            {status === 'falha' && (
                                                                <div style={{ marginTop: '5px', padding: '8px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '6px', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                                                                    <strong>⚠️ Motivo:</strong> {entrega.observacoes || 'Não informado'}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </Popup>
                                                </Marker>
                                            );
                                        })}

                                        {/* Entregas ativas (rota em andamento) */}
                                        {(entregasAtivasNoMapa || []).filter(e => {
                                            const todayStr = new Date().toDateString();
                                            // FILTRO DE DATA (APENAS HOJE)
                                            if (e.created_at) {
                                                const dt = new Date(e.created_at);
                                                if (!isNaN(dt.getTime()) && dt.toDateString() !== todayStr) {
                                                    return false; // Ocultar entregas antigas
                                                }
                                            }

                                            // FILTRO RIGOROSO: NUNCA renderizar coordenadas inválidas
                                            if (!e.lat || !e.lng) return false;
                                            if (e.lat === 0 || e.lng === 0) return false;
                                            const lat = Number(e.lat);
                                            const lng = Number(e.lng);
                                            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
                                            return isValidSC(lat, lng);
                                        }).map((entrega, idx) => {
                                            const tipo = String(entrega.tipo || 'Entrega').toLowerCase();
                                            const status = String(entrega.status || '').toLowerCase();
                                            const num = (entrega.ordem_logistica && entrega.ordem_logistica > 0) ? entrega.ordem_logistica : (idx + 1);

                                            return (
                                                <Marker
                                                    key={`${entrega.id}-${entrega.status}`} // Chave composta para forçar render imediato (Realtime)
                                                    position={[Number(entrega.lat), Number(entrega.lng)]}
                                                    icon={createPinIcon(tipo, status, entrega.observacoes)}
                                                    draggable={false}
                                                >
                                                    <Tooltip permanent direction="top" offset={[0, -42]} className="pin-tooltip" opacity={0.98}>
                                                        <span style={{ fontWeight: '600', fontSize: '12px' }}>{entrega.cliente}</span>
                                                    </Tooltip>
                                                    <Popup>
                                                        <div style={{ minWidth: '200px', fontSize: '13px', lineHeight: '1.6' }}>
                                                            <strong>📍 Local:</strong> {entrega.endereco}<br />
                                                            <strong>📋 Tipo:</strong> {tipo.toUpperCase()}<br />
                                                            <strong>🕒 Horário:</strong> {entrega.updated_at ? new Date(entrega.updated_at).toLocaleTimeString() : (entrega.created_at ? new Date(entrega.created_at).toLocaleTimeString() : 'Pendente')}<br />
                                                            <strong>🚦 Status:</strong>
                                                            <span style={{
                                                                color: status === 'falha' ? '#ef4444' : (['entregue', 'concluida', 'concluída'].includes(status) ? '#10b981' : (status === 'em_rota' ? '#2563eb' : '#3b82f6')),
                                                                fontWeight: 'bold',
                                                                marginLeft: '5px'
                                                            }}>
                                                                {(status === 'em_rota' ? 'EM ROTA' : status.toUpperCase()) || 'PENDENTE'}
                                                            </span><br />
                                                            {status === 'falha' && (
                                                                <div style={{ marginTop: '5px', padding: '8px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '6px', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                                                                    <strong>⚠️ Motivo:</strong> {entrega.observacoes || 'Não informado'}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </Popup>
                                                </Marker>
                                            );
                                        })}

                                        {/* Polyline da rota OSRM (seguindo ruas) */}
                                        {routeGeometry && routeGeometry.length > 0 && (
                                            <Polyline
                                                positions={routeGeometry}
                                                color="#60a5fa"
                                                weight={5}
                                                opacity={0.9}
                                            />
                                        )}
                                    </MapContainer>
                                </ErrorBoundary>

                                {/* Resize handle indicator */}
                                <div style={{ position: 'absolute', bottom: 8, right: 12, width: 36, height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 6, cursor: 'ns-resize', display: 'inline-block', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.02)' }} title="Arraste para redimensionar a altura do mapa" />

                            </div>
                        </div>

                        {/* INFO LATERAL */}
                        <div style={{ background: theme.card, borderRadius: '16px', padding: '25px', boxShadow: theme.shadow, height: '500px', display: 'flex', flexDirection: 'column' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginBottom: '15px' }}>
                                <div style={{ position: 'relative', marginBottom: '10px', textAlign: 'center' }}>
                                    <h3 style={{ margin: 0, color: theme.textMain, fontSize: '15px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '1px' }}>STATUS DA OPERAÇÃO</h3>
                                    <button
                                        onClick={gerarEntregaTeste}
                                        style={{ position: 'absolute', right: -10, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', fontSize: '14px', cursor: 'pointer', opacity: 0.5, transition: 'opacity 0.2s' }}
                                        title="Gerar entrega teste (Leandro)"
                                        onMouseEnter={(e) => e.target.style.opacity = 1}
                                        onMouseLeave={(e) => e.target.style.opacity = 0.5}
                                    >
                                        🚲
                                    </button>
                                </div>
                                <div style={{ display: 'flex', gap: '8px', marginBottom: '15px', height: '42px' }}>
                                    <button
                                        onClick={() => setShowHistory(true)}
                                        className="btn-sidebar-glow"
                                        style={{ flex: 1, background: 'rgba(59, 130, 246, 0.1)', color: '#60a5fa', borderRadius: '8px', fontSize: '10px', fontWeight: '800', cursor: 'pointer', textTransform: 'uppercase' }}
                                    >
                                        📜 Históricos
                                    </button>
                                    <button
                                        onClick={() => {
                                            setIsFilteringRoute(!isFilteringRoute);
                                            if (typeof carregarDados === 'function') carregarDados();
                                            console.log('📡 Atualização de cores (Check Rotas) disparada');
                                        }}
                                        className="btn-sidebar-glow"
                                        style={{
                                            flex: 1,
                                            background: isFilteringRoute ? 'rgba(34, 197, 94, 0.2)' : 'rgba(59, 130, 246, 0.1)',
                                            color: isFilteringRoute ? '#4ade80' : '#60a5fa',
                                            borderRadius: '8px',
                                            fontSize: '10px',
                                            fontWeight: '800',
                                            cursor: 'pointer',
                                            textTransform: 'uppercase',
                                            border: isFilteringRoute ? '1px solid #22c55e' : 'none'
                                        }}
                                    >
                                        {isFilteringRoute ? '✔️ Rotas On' : '🚫 Check Rotas'}
                                    </button>
                                    <button
                                        onClick={(e) => {
                                            e.preventDefault();
                                            if (typeof handleLimparConcluidos === 'function') { try { handleLimparConcluidos(e); } catch (err) { } }
                                        }}
                                        className="btn-sidebar-glow"
                                        style={{ flex: 1, background: 'rgba(59, 130, 246, 0.1)', color: '#60a5fa', borderRadius: '8px', fontSize: '10px', fontWeight: '800', cursor: 'pointer', textTransform: 'uppercase' }}
                                    >
                                        🚫 Limpar
                                    </button>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginTop: '10px' }}>
                                    {/* Botão TOTAL */}
                                    <div
                                        onClick={() => setFilterStatus('TOTAL')}
                                        style={{
                                            textAlign: 'center', padding: '10px 5px',
                                            background: filterStatus === 'TOTAL' ? theme.primary : 'rgba(255,255,255,0.03)',
                                            borderRadius: '8px',
                                            border: filterStatus === 'TOTAL' ? 'none' : '1px solid rgba(255,255,255,0.05)',
                                            cursor: 'pointer', transition: 'all 0.2s ease',
                                            transform: filterStatus === 'TOTAL' ? 'scale(1.05)' : 'scale(1)',
                                            boxShadow: filterStatus === 'TOTAL' ? '0 4px 12px rgba(59, 130, 246, 0.3)' : 'none'
                                        }}
                                    >
                                        <div style={{ fontSize: '10px', color: filterStatus === 'TOTAL' ? '#fff' : theme.textLight }}>TOTAL</div>
                                        <div style={{ fontSize: '16px', fontWeight: '800', color: filterStatus === 'TOTAL' ? '#fff' : theme.primary }}>{rotaAtiva.length}</div>
                                    </div>

                                    {/* Botão OK (Verde) */}
                                    <div
                                        onClick={() => setFilterStatus('OK')}
                                        style={{
                                            textAlign: 'center', padding: '10px 5px',
                                            background: filterStatus === 'OK' ? '#10b981' : 'rgba(16, 185, 129, 0.1)',
                                            borderRadius: '8px',
                                            border: filterStatus === 'OK' ? 'none' : '1px solid rgba(16, 185, 129, 0.2)',
                                            cursor: 'pointer', transition: 'all 0.2s ease',
                                            transform: filterStatus === 'OK' ? 'scale(1.05)' : 'scale(1)',
                                            boxShadow: filterStatus === 'OK' ? '0 4px 12px rgba(16, 185, 129, 0.3)' : 'none'
                                        }}
                                    >
                                        <div style={{ fontSize: '10px', color: filterStatus === 'OK' ? '#fff' : '#10b981' }}>OK</div>
                                        <div style={{ fontSize: '16px', fontWeight: '800', color: filterStatus === 'OK' ? '#fff' : '#10b981' }}>{rotaAtiva.filter(p => String(p.status || '').toLowerCase() === 'entregue').length}</div>
                                    </div>

                                    {/* Botão FAIL (Vermelho) */}
                                    <div
                                        onClick={() => setFilterStatus('FAIL')}
                                        style={{
                                            textAlign: 'center', padding: '10px 5px',
                                            background: filterStatus === 'FAIL' ? '#ef4444' : 'rgba(239, 68, 68, 0.1)',
                                            borderRadius: '8px',
                                            border: filterStatus === 'FAIL' ? 'none' : '1px solid rgba(239, 68, 68, 0.2)',
                                            cursor: 'pointer', transition: 'all 0.2s ease',
                                            transform: filterStatus === 'FAIL' ? 'scale(1.05)' : 'scale(1)',
                                            boxShadow: filterStatus === 'FAIL' ? '0 4px 12px rgba(239, 68, 68, 0.3)' : 'none'
                                        }}
                                    >
                                        <div style={{ fontSize: '10px', color: filterStatus === 'FAIL' ? '#fff' : '#ef4444' }}>FAIL</div>
                                        <div style={{ fontSize: '16px', fontWeight: '800', color: filterStatus === 'FAIL' ? '#fff' : '#ef4444' }}>{rotaAtiva.filter(p => String(p.status || '').toLowerCase() === 'falha').length}</div>
                                    </div>

                                    {/* Botão PEND (Azul) */}
                                    <div
                                        onClick={() => setFilterStatus('PEND')}
                                        style={{
                                            textAlign: 'center', padding: '10px 5px',
                                            background: filterStatus === 'PEND' ? '#3b82f6' : 'rgba(59, 130, 246, 0.1)',
                                            borderRadius: '8px',
                                            border: filterStatus === 'PEND' ? 'none' : '1px solid rgba(59, 130, 246, 0.2)',
                                            cursor: 'pointer', transition: 'all 0.2s ease',
                                            transform: filterStatus === 'PEND' ? 'scale(1.05)' : 'scale(1)',
                                            boxShadow: filterStatus === 'PEND' ? '0 4px 12px rgba(59, 130, 246, 0.3)' : 'none'
                                        }}
                                    >
                                        <div style={{ fontSize: '10px', color: filterStatus === 'PEND' ? '#fff' : '#3b82f6' }}>PEND</div>
                                        <div style={{ fontSize: '16px', fontWeight: '800', color: filterStatus === 'PEND' ? '#fff' : '#3b82f6' }}>{rotaAtiva.filter(p => String(p.status || '').toLowerCase() === 'em_rota').length}</div>
                                    </div>
                                </div>
                            </div>

                            {motoristaDaRota ? (
                                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                                    <div style={{ padding: '12px', background: 'rgba(59, 130, 246, 0.05)', borderRadius: '12px', marginBottom: '15px', border: '1px solid rgba(59, 130, 246, 0.1)' }}>
                                        <div style={{ fontSize: '12px', color: theme.textLight }}>MOTORISTA DESIGNADO:</div>
                                        <div style={{ fontSize: '15px', fontWeight: '700', color: theme.primary }}>{motoristaDaRota.nome} {motoristaDaRota.sobrenome}</div>
                                        <div style={{ fontSize: '11px', marginTop: '4px', opacity: 0.8 }}>{motoristaDaRota.esta_online ? '🟢 Conectado' : '⚪ Offline'}</div>
                                    </div>

                                    <div style={{ flex: 1, overflowY: 'auto', paddingRight: '5px' }}>
                                        {filteredRota?.map((p, i) => {
                                            const statusVal = String(p.status || '').toLowerCase();
                                            const tipo = String(p.tipo || 'Entrega').toLowerCase();
                                            const iconColor = tipo === 'recolha' ? '#f39c12' : (tipo === 'entrega' ? '#3498db' : '#9b59b6');

                                            // Lógica de cores baseada no banco de dados literal
                                            const isDone = statusVal === 'arquivado' && !p.observacoes;
                                            const isFail = statusVal === 'arquivado' && !!p.observacoes;

                                            return (
                                                <div key={p.id} style={{
                                                    padding: '12px',
                                                    background: 'rgba(255,255,255,0.02)',
                                                    borderRadius: '10px',
                                                    marginBottom: '8px',
                                                    borderLeft: `4px solid ${isDone ? '#10b981' : (isFail ? '#ef4444' : iconColor)}`,
                                                    transition: 'all 0.2s ease'
                                                }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                                        <div style={{ fontWeight: '700', fontSize: '13px', color: theme.textMain }}>{p.cliente} <span style={{ opacity: 0.4, fontWeight: '400' }}>#{String(p.id).slice(-4)}</span></div>
                                                        <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: iconColor, marginTop: '4px' }} title={tipo.toUpperCase()} />
                                                    </div>
                                                    <div style={{ fontSize: '11px', color: theme.textLight, marginTop: '2px' }}>
                                                        {isDone ? '✅ Finalizado' : (isFail ? `❌ Falha: ${p.observacoes || 'Sem motivo'}` : '⏳ Em progresso')}
                                                        • {p.updated_at ? new Date(p.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : (p.created_at ? new Date(p.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--')}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            ) : (
                                <div style={{ textAlign: 'center', marginTop: '40px', color: theme.textLight }}>
                                    <div style={{ fontSize: '40px', marginBottom: '10px' }}>🚛</div>
                                    <p>Nenhuma rota ativa.</p>
                                </div>
                            )}
                            {/* Avisos removidos da Visão Geral — comunicação centralizada em 'Equipe' */}
                        </div>
                    </div>
                )}

                {/* NOVA CARGA */}
                {abaAtiva === 'Nova Carga' && (
                    <div style={{ display: 'flex', gap: '24px', background: 'transparent' }}>
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
                                <input name="cliente" placeholder="Nome do Cliente" style={inputStyle} required value={nomeCliente} onChange={(e) => setNomeCliente(e.target.value)} />
                                <div style={{ position: 'relative' }}>
                                    <input ref={enderecoRef} name="endereco" placeholder="Endereço de Entrega" autoComplete="new-password" spellCheck="false" autoCorrect="off" style={inputStyle} required value={enderecoEntrega} onChange={(e) => {
                                        try { setEnderecoEntrega(e.target.value); setEnderecoCoords(null); setEnderecoFromHistory(false); } catch (err) { }
                                        try {
                                            clearTimeout(predictionTimerRef.current);
                                            const q = String(e.target.value || '').trim();
                                            if (q.length >= 3) {
                                                predictionTimerRef.current = setTimeout(async () => { try { await fetchPredictions(q); } catch (err) { } }, 500);
                                            } else {
                                                setPredictions([]);
                                            }
                                        } catch (e) { }
                                    }} />

                                    {/* 1. Substituição do Input (Visual) conforme solicitado */}
                                    {predictions && predictions.length > 0 && (
                                        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: 'white', color: 'black', zIndex: 99999, border: '2px solid #007bff', borderRadius: '4px', boxShadow: '0 10px 25px rgba(0,0,0,0.2)', maxHeight: '300px', overflowY: 'auto' }}>
                                            {predictions.map(p => (
                                                <div key={p.id} onClick={() => handleSelect(p)} style={{ padding: '12px', cursor: 'pointer', borderBottom: '1px solid #eee' }}>
                                                    📍 {p.place_name}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Sugestão "Você quis dizer?" - Fuzzy Search */}
                                {addressSuggestion && (
                                    <div style={{
                                        background: 'linear-gradient(135deg, rgba(255,152,0,0.12) 0%, rgba(255,152,0,0.06) 100%)',
                                        border: '2px solid rgba(255,152,0,0.4)',
                                        borderRadius: '12px',
                                        padding: '16px',
                                        marginBottom: '12px',
                                        animation: 'slideDown 0.3s ease-out'
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                                            <span style={{ fontSize: '20px' }}>💡</span>
                                            <div style={{ flex: 1 }}>
                                                <div style={{ fontSize: '14px', fontWeight: 600, color: '#FF9800', marginBottom: '4px' }}>
                                                    Você quis dizer?
                                                </div>
                                                <div style={{ fontSize: '13px', color: theme.textLight, opacity: 0.9 }}>
                                                    Endereço digitado: <span style={{ textDecoration: 'line-through', opacity: 0.7 }}>{addressSuggestion.original}</span>
                                                </div>
                                            </div>
                                            <div style={{
                                                background: 'rgba(76,175,80,0.2)',
                                                color: '#4CAF50',
                                                padding: '4px 10px',
                                                borderRadius: '12px',
                                                fontSize: '12px',
                                                fontWeight: 700
                                            }}>
                                                {Math.round(addressSuggestion.similaridade)}% similar
                                            </div>
                                        </div>

                                        <div style={{
                                            background: 'rgba(255,255,255,0.08)',
                                            padding: '12px',
                                            borderRadius: '8px',
                                            marginBottom: '12px',
                                            border: '1px solid rgba(255,255,255,0.1)'
                                        }}>
                                            <div style={{ fontSize: '15px', fontWeight: 700, color: '#4CAF50', marginBottom: '4px' }}>
                                                {addressSuggestion.sugestao}
                                            </div>
                                            <div style={{ fontSize: '12px', color: theme.textLight, opacity: 0.8 }}>
                                                {addressSuggestion.endereco}
                                            </div>
                                        </div>

                                        <div style={{ display: 'flex', gap: '10px' }}>
                                            <button
                                                type="button"
                                                onClick={async () => {
                                                    try {
                                                        console.log('✅ Usuário aceitou sugestão:', addressSuggestion.sugestao);

                                                        // Usar coordenadas da sugestão
                                                        await salvarEntregaComCoordenadas(
                                                            addressSuggestion.lat,
                                                            addressSuggestion.lng,
                                                            addressSuggestion.cliente,
                                                            addressSuggestion.endereco, // Endereço completo
                                                            addressSuggestion.observacoes,
                                                            addressSuggestion.tipo
                                                        );

                                                        // Atualizar campo de endereço com sugestão
                                                        setEnderecoEntrega(addressSuggestion.sugestao);

                                                        // Limpar sugestão
                                                        setAddressSuggestion(null);
                                                    } catch (err) {
                                                        console.error('❌ Erro ao aceitar sugestão:', err);
                                                        alert('Erro ao salvar entrega com sugestão');
                                                    }
                                                }}
                                                style={{
                                                    flex: 1,
                                                    background: 'linear-gradient(135deg, #4CAF50 0%, #45a049 100%)',
                                                    color: '#FFFFFF',
                                                    border: 'none',
                                                    borderRadius: '8px',
                                                    padding: '12px 20px',
                                                    fontWeight: 700,
                                                    fontSize: '14px',
                                                    cursor: 'pointer',
                                                    transition: 'all 0.2s ease',
                                                    boxShadow: '0 4px 10px rgba(76,175,80,0.3)'
                                                }}
                                                onMouseEnter={(e) => {
                                                    e.target.style.transform = 'translateY(-2px)';
                                                    e.target.style.boxShadow = '0 6px 14px rgba(76,175,80,0.4)';
                                                }}
                                                onMouseLeave={(e) => {
                                                    e.target.style.transform = 'translateY(0)';
                                                    e.target.style.boxShadow = '0 4px 10px rgba(76,175,80,0.3)';
                                                }}
                                            >
                                                ✓ Sim, corrigir
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    console.log('❌ Usuário rejeitou sugestão');
                                                    setAddressSuggestion(null);
                                                }}
                                                style={{
                                                    flex: 1,
                                                    background: 'rgba(255,255,255,0.08)',
                                                    color: theme.textLight,
                                                    border: '1px solid rgba(255,255,255,0.15)',
                                                    borderRadius: '8px',
                                                    padding: '12px 20px',
                                                    fontWeight: 600,
                                                    fontSize: '14px',
                                                    cursor: 'pointer',
                                                    transition: 'all 0.2s ease'
                                                }}
                                                onMouseEnter={(e) => {
                                                    e.target.style.background = 'rgba(255,255,255,0.12)';
                                                    e.target.style.borderColor = 'rgba(255,255,255,0.25)';
                                                }}
                                                onMouseLeave={(e) => {
                                                    e.target.style.background = 'rgba(255,255,255,0.08)';
                                                    e.target.style.borderColor = 'rgba(255,255,255,0.15)';
                                                }}
                                            >
                                                × Não, manter original
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* Mensagem de Erro de Geocodificação */}
                                {geocodingError && (
                                    <div style={{
                                        background: 'linear-gradient(135deg, rgba(244,67,54,0.15) 0%, rgba(244,67,54,0.08) 100%)',
                                        border: '2px solid rgba(244,67,54,0.5)',
                                        borderRadius: '12px',
                                        padding: '16px',
                                        marginBottom: '12px',
                                        animation: 'slideDown 0.3s ease-out'
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                                            <span style={{ fontSize: '20px' }}>⚠️</span>
                                            <div style={{ flex: 1 }}>
                                                <div style={{ fontSize: '14px', fontWeight: 600, color: '#F44336', marginBottom: '4px' }}>
                                                    {geocodingError.message}
                                                </div>
                                                <div style={{ fontSize: '13px', color: theme.textLight, opacity: 0.9 }}>
                                                    {geocodingError.suggestions}
                                                </div>
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setGeocodingError(null)}
                                            style={{
                                                width: '100%',
                                                background: 'rgba(255,255,255,0.1)',
                                                color: theme.textLight,
                                                border: '1px solid rgba(255,255,255,0.2)',
                                                borderRadius: '8px',
                                                padding: '10px',
                                                fontWeight: 600,
                                                fontSize: '13px',
                                                cursor: 'pointer',
                                                transition: 'all 0.2s ease'
                                            }}
                                            onMouseEnter={(e) => {
                                                e.target.style.background = 'rgba(255,255,255,0.15)';
                                            }}
                                            onMouseLeave={(e) => {
                                                e.target.style.background = 'rgba(255,255,255,0.1)';
                                            }}
                                        >
                                            × Fechar
                                        </button>
                                    </div>
                                )}

                                <textarea name="observacoes_gestor" placeholder="Observações do Gestor (ex: Cuidado com o cachorro)" value={observacoesGestor} onChange={(e) => setObservacoesGestor(e.target.value)} style={{ ...inputStyle, minHeight: '92px', resize: 'vertical' }} />

                                {/* BOTÃO REESCRITO DO ZERO - SEM CLASSES CSS */}
                                <button
                                    type="submit"
                                    disabled={isGeocoding}
                                    style={{
                                        width: '100%',
                                        height: '60px',
                                        display: 'block',
                                        margin: '20px 0px',
                                        backgroundColor: isGeocoding ? '#94a3b8' : '#007bff',
                                        color: 'white',
                                        fontSize: '18px',
                                        fontWeight: '700',
                                        border: 'none',
                                        borderRadius: '8px',
                                        cursor: isGeocoding ? 'not-allowed' : 'pointer',
                                        boxSizing: 'border-box',
                                        transition: 'all 0.2s ease',
                                        letterSpacing: '1px',
                                        textTransform: 'uppercase',
                                        boxShadow: '0 4px 12px rgba(0, 123, 255, 0.3)',
                                        zIndex: 9999
                                    }}
                                    onMouseEnter={(e) => {
                                        if (!isGeocoding) {
                                            e.target.style.backgroundColor = '#0056b3';
                                            e.target.style.transform = 'translateY(-2px)';
                                            e.target.style.boxShadow = '0 6px 16px rgba(0, 123, 255, 0.4)';
                                        }
                                    }}
                                    onMouseLeave={(e) => {
                                        if (!isGeocoding) {
                                            e.target.style.backgroundColor = '#007bff';
                                            e.target.style.transform = 'translateY(0)';
                                            e.target.style.boxShadow = '0 4px 12px rgba(0, 123, 255, 0.3)';
                                        }
                                    }}
                                    onMouseDown={(e) => {
                                        if (!isGeocoding) {
                                            e.target.style.transform = 'scale(0.96)';
                                        }
                                    }}
                                    onMouseUp={(e) => {
                                        if (!isGeocoding) {
                                            e.target.style.transform = 'scale(1)';
                                        }
                                    }}
                                >
                                    {isGeocoding ? '🔍 Buscando...' : 'ADICIONAR À LISTA'}
                                </button>
                            </form>
                        </div>

                        {/* Coluna Direita: Histórico (scroll) */}
                        <div style={{ flex: '0 0 52%', background: theme.card, padding: '18px', borderRadius: '12px', boxShadow: theme.shadow, display: 'flex', flexDirection: 'column' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                                <h3 style={{ margin: 0, color: theme.textMain }}>Histórico de Clientes</h3>

                                {/* Botão Limpar Histórico */}
                                <button
                                    onClick={limparHistorico}
                                    title="Limpar todo o histórico"
                                    style={{
                                        background: 'rgba(244, 67, 54, 0.1)',
                                        border: '1px solid rgba(244, 67, 54, 0.3)',
                                        borderRadius: '8px',
                                        padding: '8px 12px',
                                        cursor: 'pointer',
                                        color: '#F44336',
                                        fontSize: '13px',
                                        fontWeight: 500,
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '6px',
                                        transition: 'all 0.2s ease'
                                    }}
                                    onMouseEnter={(e) => {
                                        e.target.style.background = 'rgba(244, 67, 54, 0.2)';
                                        e.target.style.transform = 'scale(1.05)';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.target.style.background = 'rgba(244, 67, 54, 0.1)';
                                        e.target.style.transform = 'scale(1)';
                                    }}
                                >
                                    🗑️ Limpar
                                </button>
                            </div>

                            {/* NOVO: Campo de pesquisa no histórico */}
                            <input
                                type="text"
                                placeholder="🔍 Pesquisar no histórico..."
                                value={historicoFilter}
                                onChange={(e) => setHistoricoFilter(e.target.value)}
                                style={{
                                    ...inputStyle,
                                    marginBottom: '12px',
                                    fontSize: '14px',
                                    padding: '10px 12px'
                                }}
                            />

                            <div style={{ marginBottom: '8px', color: theme.textLight, fontSize: '13px' }}>Clique para preencher o formulário à esquerda</div>
                            <div style={{ overflowY: 'auto', maxHeight: '420px', paddingRight: '6px' }}>
                                {(() => {
                                    // ✅ USAR recentList (localStorage) - MOSTRA DADOS IMEDIATAMENTE
                                    const dadosHistorico = recentList && recentList.length > 0 ? recentList : [];

                                    if (dadosHistorico.length === 0) {
                                        return (
                                            <p style={{ color: theme.textLight, padding: '12px', fontStyle: 'italic' }}>
                                                Nenhum histórico disponível. Adicione entregas para popular esta lista.
                                            </p>
                                        );
                                    }

                                    // Filtrar baseado no texto digitado
                                    const filterLower = historicoFilter.toLowerCase().trim();
                                    const filtered = filterLower === ''
                                        ? dadosHistorico.slice(0, 15)
                                        : dadosHistorico.filter(it => {
                                            const cliente = (it.cliente || '').toLowerCase();
                                            const endereco = (it.endereco || '').toLowerCase();
                                            return cliente.includes(filterLower) || endereco.includes(filterLower);
                                        }).slice(0, 15);

                                    if (filtered.length === 0) {
                                        return (
                                            <p style={{ color: theme.textLight, padding: '12px', fontStyle: 'italic' }}>
                                                Nenhum resultado encontrado para "{historicoFilter}"
                                            </p>
                                        );
                                    }

                                    return filtered.map((it, idx) => (
                                        <div key={it && it.id != null ? it.id : idx} onClick={async () => {
                                            try { setNomeCliente(it.cliente || ''); setEnderecoEntrega(it.endereco || ''); setEnderecoFromHistory(true); } catch (e) { }
                                            try {
                                                if (it && (it.lat != null && it.lng != null)) {
                                                    setEnderecoCoords({ lat: Number(it.lat), lng: Number(it.lng) });
                                                } else {
                                                    setEnderecoCoords(null);
                                                }
                                            } catch (e) { console.warn('historico onClick failed', e); setEnderecoCoords(null); }
                                        }} style={{ padding: '12px', borderRadius: '10px', marginBottom: '8px', cursor: 'pointer', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.03)' }}>
                                            <div style={{ fontWeight: 700, color: theme.textMain }}>{it.cliente || it.endereco || '—'}</div>
                                            <div style={{ fontSize: '13px', color: theme.textLight }}>{it.endereco || ''}</div>
                                        </div>
                                    ));
                                })()}
                            </div>
                        </div>
                    </div>
                )}

                {/* CENTRAL DE DESPACHO */}
                {abaAtiva === 'Central de Despacho' && (
                    <div style={{ background: theme.card, padding: '30px', borderRadius: '16px', boxShadow: theme.shadow }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
                            <h2>Fila de Preparação</h2>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <div style={{ color: theme.textLight, fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <div>Distância Estimada: <span style={{ color: theme.primary }}>{(estimatedDistanceKm != null && estimatedTimeText != null) ? `${estimatedDistanceKm} KM | ${estimatedTimeText}` : (distanceCalculating ? 'Calculando...' : 'Calculando...')}</span></div>
                                    <button title="Histórico de otimizações" onClick={() => setShowLogsPopover(s => !s)} style={{ background: 'transparent', border: 'none', color: theme.textLight, cursor: 'pointer', fontSize: '16px' }}>📜</button>
                                    {showLogsPopover && (
                                        <div style={{ position: 'absolute', right: '32px', top: '120px', background: theme.card, color: theme.textMain, padding: '10px', borderRadius: '8px', boxShadow: theme.shadow, width: '320px', zIndex: 2200 }}>
                                            <div style={{ fontWeight: 700, marginBottom: '8px' }}>Últimas otimizações</div>
                                            {logsHistory.length === 0 ? <div style={{ color: theme.textLight }}>Nenhum registro recente.</div> : (
                                                logsHistory.map((l, i) => (
                                                    <div key={i} style={{ padding: '6px 0', borderBottom: i < logsHistory.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
                                                        <div style={{ fontSize: '12px', color: theme.textLight }}>{new Date(l.created_at).toLocaleString()}</div>
                                                        <div style={{ fontSize: '13px', fontWeight: 700 }}>{(l.distancia_nova != null) ? `${l.distancia_nova} KM` : '—'} • {l.nova_ordem ? l.nova_ordem.join(', ') : '—'}</div>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    )}
                                </div>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <button onClick={() => { setDriverSelectMode('reopt'); setShowDriverSelect(true); }} style={{ ...btnStyle('#fbbf24'), width: 'auto' }}>
                                        🔄 REORGANIZAR ROTA
                                        {pendingRecalcCount > 0 && (
                                            <span style={{ marginLeft: '8px', background: '#ef4444', color: '#fff', borderRadius: '10px', padding: '2px 6px', fontSize: '12px', fontWeight: 700 }}>{pendingRecalcCount}</span>
                                        )}
                                    </button>
                                    <button onClick={() => { setDriverSelectMode('dispatch'); setShowDriverSelect(true); }} style={{ ...btnStyle(theme.success), width: 'auto' }}>ENVIAR ROTA</button>
                                </div>
                            </div>
                        </div>
                        {(!entregasEmEspera || entregasEmEspera.length === 0) ? <p style={{ textAlign: 'center', color: theme.textLight }}>Tudo limpo! Sem pendências.</p> : (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px', maxHeight: '500px', overflowY: 'auto', padding: '10px' }}>
                                {entregasEmEspera?.map(p => (
                                    <div key={p.id} style={{ border: `1px solid #e2e8f0`, padding: '20px', borderRadius: '12px', borderLeft: `4px solid ${theme.accent}` }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <h4 style={{ margin: '0 0 5px 0' }}>{p.cliente}</h4>
                                            <span style={{ fontSize: '12px', padding: '6px 10px', borderRadius: '12px', background: '#f1f5f9', color: '#374151' }}>{p.tipo || 'Entrega'}</span>
                                        </div>
                                        <p style={{ fontSize: '13px', color: theme.textLight, margin: '4px 0' }}>{p.endereco}</p>
                                        <p style={{ fontSize: '13px', color: theme.textLight, margin: '4px 0' }}><strong>Obs:</strong> Sem observações</p>
                                        <button onClick={() => excluirPedido(p.id)} style={{ marginTop: '10px', background: 'none', border: 'none', color: theme.danger, cursor: 'pointer', fontSize: '12px' }}>Remover</button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* EQUIPE (FROTA) */}
                {abaAtiva === 'Equipe' && (
                    <div style={{ background: theme.card, padding: '30px', borderRadius: '16px', boxShadow: theme.shadow }}>
                        <h2 style={{ marginTop: 0 }}>Motoristas Cadastrados</h2>

                        {/* Central de Comunicados (seletivo) */}
                        <div style={{ marginBottom: '18px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <label style={{ fontWeight: 700, color: theme.textMain }}>Central de Comunicados</label>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                                <select value={destinatario} onChange={(e) => setDestinatario(e.target.value)} style={{ padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1', minWidth: '220px' }}>
                                    <option value="all">📢 Enviar para Todos</option>
                                    {motoristasAtivos.map(m => (
                                        <option key={m.id} value={String(m.id)}>{fullName(m)}</option>
                                    ))}
                                </select>
                                <div style={{ flex: 1 }}>
                                    <textarea value={mensagemGeral} onChange={(e) => setMensagemGeral(e.target.value)} placeholder="Escreva a mensagem..." style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #cbd5e1', minHeight: '96px', resize: 'vertical', fontSize: '14px' }} />
                                </div>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
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
                                            const sb = supabaseRef.current || supabase;
                                            if (!sb || typeof sb.from !== 'function') throw new Error('Supabase não inicializado');
                                            const payload = { titulo: 'Comunicado', mensagem: texto, lida: false, motorista_id };
                                            const { data, error } = await sb.from('avisos_gestor').insert([payload]);
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
                                {motoristasAtivos.map(m => {
                                    const isOnline = m.esta_online === true;
                                    const dotColor = isOnline ? '#10b981' : '#ef4444';
                                    const dotShadow = isOnline ? '0 0 10px rgba(16,185,129,0.45)' : '0 0 6px rgba(239,68,68,0.18)';
                                    const nameStyle = isOnline ? { color: '#10b981', fontWeight: 700, textShadow: '0 1px 6px rgba(16,185,129,0.25)' } : { color: '#9ca3af', fontWeight: 400, opacity: 0.9 };
                                    const statusText = isOnline ? 'Disponível' : 'Offline';
                                    const statusColor = isOnline ? '#10b981' : 'rgba(239,68,68,0.6)';

                                    // Progresso de carga: contar entregas vinculadas ao motorista a partir de entregasAtivos
                                    const entregasMot = DEBUG_FORCE_SHOW_ALL ? (entregasAtivos || []) : (entregasAtivos || []).filter(e => String(e.motorista_id) === String(m.id));
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
                                        <tr key={m.id} onClick={() => setSelectedMotorista(m)} style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }}>
                                            <td style={{ padding: '15px 10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <span style={{ width: '12px', height: '12px', borderRadius: '50%', background: dotColor, display: 'inline-block', boxShadow: dotShadow }} />
                                                <span style={{ color: '#ffffff', fontWeight: 600 }}>{fullName(m)}</span>
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
                                    {motoristasPendentes.map(m => (
                                        <MotoristaRow key={m.id} m={m} onClick={(mm) => setSelectedMotorista(mm)} entregasAtivos={entregasAtivos} theme={theme} onApprove={(mm) => aprovarMotorista(mm.id)} onReject={(mm) => rejectDriver(mm)} />
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

            </main>

            {/* City choice modal (bairros gêmeos) */}
            <CityChoiceModal
                visible={showCityChoiceModal}
                onClose={() => {
                    setShowCityChoiceModal(false);
                    setCityChoiceOptions([]);
                    setPendingAddressData(null);
                    setIsGeocoding(false);
                }}
                bairro={cityChoiceOptions[0] || ''}
                cities={cityChoiceOptions.slice(1) || []}
                onSelect={(selectedCity) => {
                    // Usuário escolheu a cidade - continuar com geocodificação
                    if (pendingAddressData) {
                        const { enderecoNormalizado, clienteVal, obsValue, tipoEncomenda } = pendingAddressData;
                        const enderecoComCidade = `${enderecoNormalizado}, ${selectedCity}, SC, Brasil`;

                        setShowCityChoiceModal(false);
                        setCityChoiceOptions([]);

                        // Continuar com geocodificação
                        continuarGeocod(enderecoComCidade, selectedCity, clienteVal, obsValue, tipoEncomenda);
                    }
                }}
                theme={theme}
            />

            {/* Driver selection modal (componente minimalista) */}


            <DriverSelectModal
                visible={showDriverSelect}
                onClose={() => { setShowDriverSelect(false); setSelectedMotorista(null); }}
                frota={frota}
                onSelect={handleDriverSelect}
                driverSelectMode={driverSelectMode}
                setSelectedMotorista={setSelectedMotorista}
                theme={theme}
                loading={dispatchLoading}
            />

            {/* Renderizar o Componente de Histórico Profissional */}
            <HistoricoEntregas
                isOpen={showHistory}
                onClose={() => setShowHistory(false)}
                entregas={historicoCompleto}
                theme={theme}
            />
        </div>
    );

    // App content is rendered directly; APIProvider is provided at the top-level (src/main.jsx)
    return appContent;
}


// Componentes Pequenos
function CardKPI({ titulo, valor, cor }) {
    return (
        <div style={{ background: '#fff', padding: '20px', borderRadius: '16px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', borderLeft: `5px solid ${cor}` }}>
            <h4 style={{ margin: 0, color: '#94a3b8', fontSize: '12px', textTransform: 'uppercase' }}>{titulo}</h4>
            <div style={{ fontSize: '28px', fontWeight: '800', color: '#1e293b' }}>{valor}</div>
        </div>
    );
}

const inputStyle = { width: '100%', padding: '15px', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', fontSize: '14px' };
const btnStyle = (bg, disabled = false) => ({
    width: '100% !important',
    padding: '15px',
    borderRadius: '8px',
    border: 'none',
    background: disabled ? '#94a3b8' : bg,
    color: '#fff',
    fontWeight: 'bold',
    cursor: disabled ? 'not-allowed' : 'pointer',
    boxShadow: '0 4px 10px rgba(0,0,0,0.1)',
    transition: 'all 0.2s ease',
    opacity: disabled ? 0.6 : 1
});

// Modal para escolha de cidade quando bairro existe em múltiplas cidades
function CityChoiceModal({ visible, onClose, bairro, cities, onSelect, theme }) {
    if (!visible) return null;

    return (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
            <div style={{ background: theme.card, padding: '32px', borderRadius: '16px', maxWidth: '500px', width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}>
                <h3 style={{ marginTop: 0, color: theme.primary, fontSize: '20px', marginBottom: '16px' }}>
                    🏘️ Bairro em Múltiplas Cidades
                </h3>
                <p style={{ color: theme.textMain, fontSize: '15px', lineHeight: '1.6', marginBottom: '24px' }}>
                    O bairro <strong>"{bairro}"</strong> existe em mais de uma cidade.<br />
                    Por favor, selecione a cidade correta:
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>
                    {cities.map((city) => (
                        <button
                            key={city}
                            onClick={() => onSelect(city)}
                            style={{
                                padding: '16px 24px',
                                borderRadius: '10px',
                                border: '2px solid transparent',
                                background: theme.primary,
                                color: '#fff',
                                fontSize: '16px',
                                fontWeight: 'bold',
                                cursor: 'pointer',
                                transition: 'all 0.2s ease',
                                boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                            }}
                            onMouseEnter={(e) => {
                                e.target.style.background = '#1e40af';
                                e.target.style.transform = 'translateY(-2px)';
                                e.target.style.boxShadow = '0 6px 16px rgba(0,0,0,0.15)';
                            }}
                            onMouseLeave={(e) => {
                                e.target.style.background = theme.primary;
                                e.target.style.transform = 'translateY(0)';
                                e.target.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
                            }}
                            onMouseDown={(e) => {
                                e.target.style.transform = 'scale(0.98)';
                            }}
                            onMouseUp={(e) => {
                                e.target.style.transform = 'translateY(-2px)';
                            }}
                        >
                            📍 {city}
                        </button>
                    ))}
                </div>
                <button
                    onClick={onClose}
                    style={{
                        width: '100%',
                        padding: '12px',
                        borderRadius: '8px',
                        border: '1px solid #cbd5e1',
                        background: 'transparent',
                        color: theme.textLight,
                        fontSize: '14px',
                        cursor: 'pointer'
                    }}
                >
                    Cancelar
                </button>
            </div>
        </div>
    );
}

// Modal minimalista para seleção de motorista online
function DriverSelectModal({ visible, onClose, frota = [], onSelect, theme, loading = false, setSelectedMotorista = null, driverSelectMode = 'dispatch' }) {
    const [localSelected, setLocalSelected] = useState(null);
    useEffect(() => { if (!visible) setLocalSelected(null); }, [visible]);
    if (!visible) return null;
    const online = (frota || []).filter(m => m.esta_online === true);

    const handleSelect = async (m) => {
        if (loading) return; // bloqueia se já estiver enviando
        setLocalSelected(m.id);
        try { if (setSelectedMotorista) setSelectedMotorista(m); } catch (e) { }
        try {
            await onSelect(m);
        } catch (err) {
            try { alert('Falha ao executar ação: ' + (err && err.message ? err.message : String(err))); } catch (e) { /* ignore */ }
        } finally {
            // garante limpeza do estado local e fecha modal sem travar a UI
            try { setLocalSelected(null); } catch (e) { }
            try { onClose(); } catch (e) { }
        }
    };

    const actionLabel = driverSelectMode === 'reopt' ? 'REORGANIZAR ROTA' : 'ENVIAR ROTA';

    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
            <div style={{ width: '480px', maxWidth: '94%', background: theme.card, color: theme.textMain, borderRadius: '10px', padding: '16px', boxShadow: theme.shadow }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <h3 style={{ margin: 0 }}>Escolha um motorista</h3>
                    <button onClick={onClose} style={{ background: 'transparent', border: 'none', fontSize: '18px', cursor: 'pointer', color: '#ffffff', opacity: 1 }}>✕</button>
                </div>
                <div style={{ maxHeight: '58vh', overflow: 'auto' }}>
                    {online.length === 0 ? (
                        <div style={{ padding: '12px', color: theme.textLight }}>Nenhum motorista online no momento.</div>
                    ) : (
                        online.map(m => (
                            <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 8px', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                                <div style={{ flex: 1 }}>
                                    <button disabled={loading} onClick={() => handleSelect(m)} style={{ background: 'transparent', border: 'none', textAlign: 'left', cursor: loading ? 'wait' : 'pointer', padding: 0 }}>
                                        <div style={{ fontWeight: 700, color: '#ffffff' }}>{fullName(m)}</div>
                                        <div style={{ fontSize: '12px', color: theme.textLight }}>{m.veiculo || ''}</div>
                                    </button>
                                </div>
                                <div>
                                    <button disabled={loading} onClick={() => handleSelect(m)} style={{ ...btnStyle(theme.primary), width: '140px' }}>{loading ? (driverSelectMode === 'reopt' ? 'Processando...' : 'Enviando...') : actionLabel}</button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}

export default App;
