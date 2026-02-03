import React from 'react';
import { useRef, useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import supabase, { subscribeToTable, onSupabaseReady, SUPABASE_CONNECTED, onSupabaseConnected, checkSupabaseConnection, getLastSupabaseError, buscarTodasEntregas } from './supabaseClient';
import { haversineDistance, nearestNeighborRoute, calculateTotalDistance, geocodeNominatim, searchNominatim, getOSRMRoute } from './geoUtils';

const HAS_SUPABASE_CREDENTIALS = Boolean(supabase && typeof supabase.from === 'function');

// ===== CONFIGURAÇÕES E UTILIDADES =====

// Santa Catarina bounds (validação de coordenadas)
const isValidSC = (lat, lng) => {
    if (lat == null || lng == null) return false;
    const latN = Number(lat); const lngN = Number(lng);
    if (!Number.isFinite(latN) || !Number.isFinite(lngN)) return false;
    // Santa Catarina: lat entre -25 e -30, lng entre -48 e -54
    return (latN < -25.0 && latN > -30.0 && lngN > -54.0 && lngN < -48.0);
};

// Coordenadas padrão (Florianópolis - sede)
const DEFAULT_MAP_CENTER = { lat: -27.5969, lng: -48.5495 };

// Ícones Leaflet customizados
function createNumberedIcon(number, color = '#2563eb') {
    const n = number || '';
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='36' height='36'><circle cx='18' cy='18' r='18' fill='${color}' stroke='%23fff' stroke-width='3'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-size='16' fill='%23fff' font-family='Arial' font-weight='800'>${n}</text></svg>`;
    const url = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
    return L.icon({
        iconUrl: url,
        iconSize: [36, 36],
        iconAnchor: [18, 36],
        popupAnchor: [0, -36]
    });
}

function createMotoristaIcon(name = '', heading = 0, color = '#10b981') {
    const label = String(name || '').trim();
    // Ícone de moto/carrinha estilizado
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='48' height='48' viewBox='0 0 48 48'>
        <g transform='translate(24 24)'>
            <circle cx='0' cy='0' r='22' fill='${color}' stroke='%23fff' stroke-width='3'/>
            <!-- Moto icon -->
            <g transform='translate(-12, -8) scale(0.6)'>
                <circle cx='8' cy='20' r='4' fill='%23fff'/>
                <circle cx='32' cy='20' r='4' fill='%23fff'/>
                <path d='M 10,12 L 18,8 L 22,10 L 24,8 L 28,10 L 30,12 L 26,18 L 14,18 Z' fill='%23fff'/>
                <rect x='18' y='10' width='8' height='8' fill='%23fff'/>
            </g>
        </g>
    </svg>`;
    const url = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
    return L.icon({
        iconUrl: url,
        iconSize: [48, 48],
        iconAnchor: [24, 48],
        popupAnchor: [0, -48]
    });
}

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
const NEW_LOAD_STATUS = 'aguardando';

// --- LÓGICA (NÃO MEXEMOS EM NADA AQUI) ---

const otimizarRota = (pontoPartida, listaEntregas) => {
    let rotaOrdenada = [];
    let atual = pontoPartida;
    let pendentes = [...listaEntregas];
    let maxIterations = 1000; // PROTEÇÃO CONTRA LOOP INFINITO
    while (pendentes.length > 0 && maxIterations-- > 0) {
        let maisProximo = null;
        let menorDistancia = Infinity;
        let indexMaisProximo = -1;
        pendentes.forEach((pedido, index) => {
            // Guard: não calcular se dados inválidos
            if (!atual || !Array.isArray(atual) || atual.length < 2) {
                // fornecer defaults seguros para cálculo
                atual = [0, 0];
            }
            if (!pedido || pedido.lat == null || pedido.lng == null) return;
            const atualLat = atual[0] != null ? Number(atual[0]) : 0;
            const atualLng = atual[1] != null ? Number(atual[1]) : 0;
            const dist = Math.sqrt(Math.pow(Number(pedido.lat) - atualLat, 2) + Math.pow(Number(pedido.lng) - atualLng, 2));
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
        } else {
            // PROTEÇÃO: se não encontrou próximo, sair do loop para evitar infinito
            break;
        }
    }
    return rotaOrdenada;
};

// Otimiza rota usando Google Distance Matrix API + heuristic (nearest neighbor + 2-opt) quando disponível
// Retorna a lista de entregas reordenada conforme otimização de menor distância
// ===== OTIMIZAÇÃO DE ROTA (LOCAL - SEM APIS EXTERNAS) =====
// Usa algoritmo do Vizinho Mais Próximo com cálculo Haversine
async function otimizarRotaLocal(pontoPartida, listaEntregas, motoristaId = null) {
    // Filtrar apenas entregas ativas com status 'pendente' ou 'em_rota'
    const remaining = (listaEntregas || []).filter(p => {
        const status = String(p.status || '').trim().toLowerCase();
        return status === 'pendente' || status === 'em_rota';
    });
    
    if (!remaining || remaining.length === 0) return [];
    
    // CRÍTICO: Filtrar entregas SEM coordenadas válidas
    const semCoordenadas = remaining.filter(p => !p.lat || !p.lng || isNaN(Number(p.lat)) || isNaN(Number(p.lng)));
    const comCoordenadas = remaining.filter(p => p.lat && p.lng && !isNaN(Number(p.lat)) && !isNaN(Number(p.lng)) && isValidSC(Number(p.lat), Number(p.lng)));
    
    if (semCoordenadas.length > 0) {
        console.warn(`⚠️ ${semCoordenadas.length} entrega(s) sem coordenadas válidas (serão ignoradas)`);
        semCoordenadas.forEach(e => {
            console.warn(`   📍 ID: ${e.id} | Cliente: ${e.cliente} | Endereço: ${e.endereco}`);
        });
    }
    
    if (comCoordenadas.length === 0) {
        console.error('❌ NENHUMA entrega com coordenadas válidas para otimizar!');
        return [];
    }
    
    console.log(`🧮 Otimizando rota localmente com ${comCoordenadas.length} entregas`);

    // Determinar origem: motorista atual -> última entrega concluída -> pontoPartida (sede)
    let originLatLng = null;
    
    try {
        if (motoristaId != null) {
            const { data: mdata } = await supabase.from('motoristas').select('lat,lng,esta_online').eq('id', motoristaId).single();
            if (mdata) {
                if (mdata.esta_online !== true) {
                    console.warn('Motorista offline - abortando otimização');
                    return [];
                }
                if (mdata.lat != null && mdata.lng != null) {
                    originLatLng = { lat: Number(mdata.lat), lng: Number(mdata.lng) };
                }
            }
        }
    } catch (e) {
        console.warn('Falha ao buscar motorista:', e);
    }

    // Fallback para pontoPartida (sede)
    if (!originLatLng) {
        if (pontoPartida && typeof pontoPartida === 'object' && 'lat' in pontoPartida && 'lng' in pontoPartida) {
            originLatLng = { lat: Number(pontoPartida.lat), lng: Number(pontoPartida.lng) };
        } else {
            originLatLng = DEFAULT_MAP_CENTER;
        }
    }
    
    // Determinar destino (volta para base)
    const baseCoord = (pontoPartida && pontoPartida.lat != null && pontoPartida.lng != null) 
        ? { lat: Number(pontoPartida.lat), lng: Number(pontoPartida.lng) } 
        : DEFAULT_MAP_CENTER;
    
    // ALGORITMO DO VIZINHO MAIS PRÓXIMO (importado de geoUtils.js)
    const ordered = nearestNeighborRoute(originLatLng, comCoordenadas, baseCoord);
    
    // Calcular distância total estimada
    const totalKm = calculateTotalDistance(originLatLng, ordered, baseCoord);
    
    console.log(`✅ Rota otimizada: ${ordered.length} entregas, distância estimada: ${totalKm.toFixed(1)} km`);
    
    // Persistir ordem_logistica no banco (somente se motoristaId fornecido - não persiste em preview)
    if (motoristaId != null) {
        try {
            for (let i = 0; i < ordered.length; i++) {
                const pedido = ordered[i];
                if (!pedido.id) continue;
                await supabase.from('entregas').update({ ordem_logistica: i + 1 }).eq('id', pedido.id);
            }
            console.log(`✅ ordem_logistica persistida para ${ordered.length} entregas`);
        } catch (e) {
            console.warn('Falha ao persistir ordem_logistica:', e);
        }
    }
    
    return ordered;
}

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

    // Local supabase ref to ensure we use the right client instance when it becomes available
    const supabaseRef = React.useRef(supabase);
    
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
    const DEBUG_FORCE_SHOW_ALL = true; // força mostrar tudo temporariamente (debug)
    const [avisos, setAvisos] = useState([]);
    const [gestorPhone, setGestorPhone] = useState(null);
    const [nomeGestor, setNomeGestor] = useState(null);
    const [rotaAtiva, setRotaAtiva] = useState([]);
    const [motoristaDaRota, setMotoristaDaRota] = useState(null);

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
                    setEntregasEmEspera(normalized);
                    setAllEntregas(normalized);
                    setTotalEntregas(normalized.length);
                    console.log('✅ Entregas carregadas com sucesso:', normalized.length);
                    console.log('✅ ESTADO entregasEmEspera agora:', normalized);
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
    const [recentList, setRecentList] = useState([]);
    const [allEntregas, setAllEntregas] = useState([]); // raw entregas from DB (no filters)
    const [user, setUser] = useState(null);
    const [session, setSession] = useState(null);
    const [tipoEncomenda, setTipoEncomenda] = useState('Entrega');
    const audioRef = useRef(new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3'));

    const mapRef = useRef(null);
    const mapRefUnused = mapRef; // preserve ref usage pattern; no history counters needed
    const mapContainerRef = useRef(null);



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
    // Coordenadas do motorista Leandro como fallback (Palhoça/região)
    const DEFAULT_MAP_CENTER = { lat: -27.6609227, lng: -48.7087265 }; 
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

    // Ensure Google Maps resizes after the container height changes
    useEffect(() => {
        // DESABILITADO TEMPORARIAMENTE: ResizeObserver pode disparar muito e travar
        return;
        
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

        return () => { try { if (ro && typeof ro.disconnect === 'function') ro.disconnect(); } catch (e) { }; clearTimeout(t); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mapCenterState]);

    // Draft polyline drawing: dashed preview connecting origin + draftPreview points
    useEffect(() => {
        // DESABILITADO TEMPORARIAMENTE: pode causar re-renders ao desenhar polylines
        return;
        
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
    
    // Nominatim: não precisa de inicialização (fetch direto HTTP)
    
    // Draft point: set when gestor seleciona um endereço
    useEffect(() => {
        // DESABILITADO TEMPORARIAMENTE: pode causar re-renders excessivos
        return;
        
        if (!enderecoCoords || !enderecoEntrega) { setDraftPoint(null); return; }
        try {
            setDraftPoint({ cliente: (nomeCliente || '').trim(), endereco: enderecoEntrega, lat: Number(enderecoCoords.lat), lng: Number(enderecoCoords.lng), tipo: String(tipoEncomenda || 'Entrega').trim(), id: `draft-${Date.now()}` });
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
            if (!supabase || typeof supabase.from !== 'function') {
                // Supabase not ready; clear suggestions and exit
                setHistorySuggestions([]);
                return;
            }
            const { data, error } = await supabase.from('entregas').select('cliente,endereco,lat,lng').ilike('endereco', `%${q}%`).limit(6);
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
                    const results = await searchNominatim(q);
                    setPredictions(results);
                } catch (e) {
                    console.warn('Nominatim search error:', e);
                    setPredictions([]);
                }
            }, 500); // 500ms debounce
        } catch (e) {
            console.warn('fetchPredictions error:', e);
            setPredictions([]);
        }
    }

    // NOMINATIM: ao clicar numa sugestão, usar coordenadas já retornadas
    async function handlePredictionClick(pred) {
        try {
            setEnderecoFromHistory(false);
            setEnderecoEntrega(pred.display_name || '');
            
            // Nominatim já retorna lat/lng na busca, não precisa de segunda chamada!
            if (pred.lat != null && pred.lng != null) {
                const lat = Number(pred.lat);
                const lng = Number(pred.lng);
                console.log('✅ Coordenadas capturadas do Nominatim:', { lat, lng });
                setEnderecoCoords({ lat, lng });
            } else {
                console.warn('Predição sem coordenadas válidas');
                setEnderecoCoords(null);
            }
        } catch (e) {
            console.warn('handlePredictionClick error:', e);
            setEnderecoCoords(null);
        }
        try { setPredictions([]); setHistorySuggestions([]); } catch (e) { }
    }

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


        // entregas: sempre carregar todas as entregas do DB (sem filtros complexos)
        try {
            // Be explicit about returned columns to ensure cliente/endereco are present
            let q = sb.from('entregas').select('id,cliente,endereco,lat,lng,status,ordem_logistica,motorista_id,created_at');
            // Prefer server-side ordering by ordem_logistica when supported
            if (q && typeof q.order === 'function') q = q.order('ordem_logistica', { ascending: true });
            const { data: entregasPend, error: entregasErr } = await q;
            if (entregasErr) {
                console.error('Erro na Tabela Entregas:', entregasErr);
                setEntregasEmEspera([]);
            } else {
                const rawList = Array.isArray(entregasPend) ? entregasPend.slice() : [];
                // normalize motorista_id to string and ensure cliente/endereco keys exist
                const list = rawList.map(it => ({ ...it, motorista_id: it.motorista_id != null ? String(it.motorista_id) : null, cliente: it.cliente || it.cli || it.customer || '', endereco: it.endereco || it.address || '' }));

                // FORCED: do not filter — show everything while debugging
                try { setAllEntregas(Array.isArray(list) ? list.slice() : []); } catch (e) { setAllEntregas([]); }
                try { 
                    console.log('🟢 carregarDados: setando entregasEmEspera com', list.length, 'itens');
                    setEntregasEmEspera(Array.isArray(list) ? list.slice() : []); 
                } catch (e) { setEntregasEmEspera([]); }
                // Mirror into debug entregas state so debug UI shows the data (and set hasLoadedOnce)
                try { setEntregas(Array.isArray(list) ? list.slice() : []); hasLoadedOnce.current = true; } catch (e) { setEntregas([]); hasLoadedOnce.current = true; }
                // reset retry counter on success
                try { retryCountRef.current = 0; } catch (e) { }
            }
        } catch (e) {
            console.warn('Erro carregando entregas:', e);
            // preserve previous entregasEmEspera if available
            setEntregasEmEspera(prev => (prev && prev.length) ? prev : []);
        }

        // total de entregas
        try {
            let q2 = sb.from('entregas').select('*');
            const { data: todas } = await q2;
            setTotalEntregas((todas || []).length);
        } catch (e) {
            console.error('Erro contando entregas:', e);
            // don't reset total to 0 on transient errors
            // leave current value
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

        // Histórico recente
        try {
            let q5 = sb.from('entregas').select('cliente,endereco,created_at');
            if (q5 && typeof q5.order === 'function') q5 = q5.order('id', { ascending: false });
            if (q5 && typeof q5.limit === 'function') q5 = q5.limit(200);
            const { data: recent, error: recentErr } = await q5;
            if (recentErr) { console.error('Erro na Tabela Entregas (histórico):', recentErr); setRecentList([]); }
            else if (recent) {
                const seen = new Set();
                const unique = [];
                for (const r of recent) {
                    const key = (r.cliente || '').trim().toLowerCase();
                    if (!key) continue;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    unique.push({ cliente: r.cliente, endereco: r.endereco });
                }
                setRecentList(unique);
            } else {
                setRecentList([]);
            }
        } catch (e) { console.warn('Erro carregando histórico de entregas:', e); setRecentList([]); }
        setLoadingFrota(false);
    }, []);

    // Approve / Reject handlers for Gestão de Motoristas
    // New admin-facing approve by id
    const aprovarMotorista = async (id) => {
        try {
            if (!id) return;
            if (!supabase || typeof supabase.from !== 'function') { console.warn('aprovarMotorista: supabase client not initialized'); return { error: new Error('Supabase não inicializado') }; }
            const sid = String(id);
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
            const sid = String(id);
            const { data, error } = await supabase.from('motoristas').delete().eq('id', sid).select();
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
                if (!HAS_SUPABASE_CREDENTIALS || !supabase || typeof supabase.from !== 'function') return;
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
    const orderedRota = rotaAtiva && rotaAtiva.slice ? rotaAtiva.slice().sort((a, b) => (a.ordem || 0) - (b.ordem || 0)) : [];

    // Filtrar apenas entregas ATIVAS para exibir no mapa (excluir concluídas/finalizadas)
    // IMPORTANTE: Se rotaAtiva estiver vazia, não deve mostrar NENHUM pino de entrega
    const entregasAtivasNoMapa = React.useMemo(() => {
        // Se não há rota ativa, retornar array vazio (sem pinos)
        if (!rotaAtiva || rotaAtiva.length === 0) {
            return [];
        }
        
        const statusInvalidos = ['concluida', 'concluída', 'finalizada', 'entregue', 'cancelada', 'cancelado'];
        return orderedRota.filter(e => {
            const status = String(e.status || '').toLowerCase().trim();
            // Apenas mostrar entregas com coordenadas VÁLIDAS
            const hasValidCoords = e.lat != null && e.lng != null && 
                                   Number.isFinite(Number(e.lat)) && 
                                   Number.isFinite(Number(e.lng));
            return !statusInvalidos.includes(status) && hasValidCoords;
        });
    }, [orderedRota, rotaAtiva]);

    // Verificar se a rota foi finalizada (todas as entregas concluídas)
    const rotaFinalizada = React.useMemo(() => {
        if (!orderedRota || orderedRota.length === 0) return false;
        const statusFinais = ['concluida', 'concluída', 'finalizada', 'entregue'];
        const todasConcluidas = orderedRota.every(e => {
            const status = String(e.status || '').toLowerCase().trim();
            return statusFinais.includes(status);
        });
        return todasConcluidas;
    }, [orderedRota]);

    // Reset do mapa quando rota é finalizada
    React.useEffect(() => {
        if (rotaFinalizada && mapRef.current) {
            console.log('🏁 Rota finalizada! Limpando mapa...');
            
            // Limpar estado de rota ativa após 2 segundos
            const timer = setTimeout(() => {
                console.log('🧹 LIMPEZA FINAL: Removendo TODAS as entregas do mapa');
                
                // Limpar TODOS os estados de entregas
                setRotaAtiva([]);
                setMotoristaDaRota(null);
                
                // CRÍTICO: Garantir que entregasEmEspera não mantenha itens finalizados
                setEntregasEmEspera(prev => {
                    // Remover todas as entregas que já foram concluídas
                    const statusFinais = ['concluida', 'concluída', 'finalizada', 'entregue'];
                    return prev.filter(e => {
                        const status = String(e.status || '').toLowerCase().trim();
                        return !statusFinais.includes(status);
                    });
                });
                
                // Resetar zoom para visão geral
                try {
                    if (mapRef.current && mapRef.current.setZoom) {
                        mapRef.current.setZoom(13);
                        console.log('🗺️ Zoom resetado para visão geral');
                    }
                    
                    // Centralizar no motorista se disponível, senão na cidade
                    const motoristaOnline = frota.find(m => m.esta_online && m.lat && m.lng);
                    if (motoristaOnline && mapRef.current.setCenter) {
                        mapRef.current.setCenter({ 
                            lat: Number(motoristaOnline.lat), 
                            lng: Number(motoristaOnline.lng) 
                        });
                        console.log('📍 Mapa centralizado no motorista');
                    } else if (mapRef.current.setCenter) {
                        mapRef.current.setCenter(mapCenterState);
                        console.log('📍 Mapa centralizado na cidade');
                    }
                } catch (e) {
                    console.warn('Erro ao resetar mapa:', e);
                }
                
                console.log('✅ Mapa limpo e pronto para próxima rota!');
            }, 2000); // 2 segundos de delay para feedback visual
            
            return () => clearTimeout(timer);
        }
    }, [rotaFinalizada, frota, mapCenterState]);

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
            
            // BUSCAR ROTA OSRM para desenhar linha seguindo ruas
            try {
                const baseDest = (pontoPartida && pontoPartida.lat != null && pontoPartida.lng != null) ? pontoPartida : mapCenterState || DEFAULT_MAP_CENTER;
                const allPoints = [
                    [origin.lng, origin.lat],
                    ...waypts.map(w => [w.lng, w.lat]),
                    [baseDest.lng, baseDest.lat]
                ];
                const osrmResult = await getOSRMRoute(allPoints);
                if (osrmResult && osrmResult.geometry) {
                    setRouteGeometry(osrmResult.geometry);
                    console.log(`✅ Rota OSRM obtida: ${osrmResult.distance} km`);
                } else {
                    setRouteGeometry(null); // Fallback: linha reta
                }
            } catch (e) {
                console.warn('Erro ao buscar rota OSRM:', e);
                setRouteGeometry(null);
            }

            // Prevent duplicate Directions calls: if origin+orderedList+includeHQ same as last query, reuse result
            try {
                const qhash = JSON.stringify({ origin: origin, list: (orderedList || []).map(p => p && (p.id || `${p.lat},${p.lng}`)), includeHQ: !!includeHQ, base: pontoPartida });
                if (lastDirectionsQueryRef.current === qhash && lastDrawResultRef.current) {
                    const lr = lastDrawResultRef.current;
                    try { if (lr.meters) setEstimatedDistanceKm(Number((lr.meters / 1000).toFixed(1))); } catch (e) { }
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
                            try { setRotaAtiva(newOrdered.map((p, idx) => ({ ...p, ordem: Number(idx + 1), motorista_id: String(motoristaId) }))); } catch (e) { }
                            // preview mode: update local draft preview as well
                            try { setDraftPreview(newOrdered.map((p, idx) => ({ ...p, ordem: Number(idx + 1) }))); } catch (e) { }

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
                        const poly = new window.google.maps.Polyline({ path, strokeColor: '#60a5fa', strokeOpacity: 0.9, strokeWeight: 5, map: mapRef.current });
                        routePolylineRef.current = poly;
                        // If legs are available, compute precise distance and time and return them (traffic-aware)
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

            // Fallback: straight line through ordered points
            const path = [origin].concat(waypts).concat([origin]);
            if (path && path.length > 1 && window.google && window.google.maps) {
                const poly = new window.google.maps.Polyline({ path, strokeColor: '#60a5fa', strokeOpacity: 0.9, strokeWeight: 5, map: mapRef.current });
                routePolylineRef.current = poly;
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
        try {
            if (!motoristaId) return;
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
            let qR = supabase.from('entregas').select('*').in('status', ['pendente', 'em_rota']).order('ordem_logistica', { ascending: true });
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
                                const { data: updData, error } = await supabase.from('entregas').update({ ordem_logistica: u.ordem }).eq('id', u.id);
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
                            const { data: logData, error: logErr } = await supabase.from('logs_roteirizacao').insert(payload);
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

    // Realtime: escuta inserções/atualizações em `entregas` e mantém lista sincronizada com o DB
    useEffect(() => {
        if (!HAS_SUPABASE_CREDENTIALS) return;

        const handleEntregasEvent = async (payload) => {
            try {
                const ev = payload && payload.event ? payload.event : null;
                const rec = payload && (payload.new || payload.record || payload.old) ? (payload.new || payload.record || payload.old) : null;
                // If deletion, remove immediately from local state for snappy UX then refresh from DB
                if (ev === 'DELETE' || (payload && payload.type === 'DELETE')) {
                    try {
                        const id = rec && rec.id ? String(rec.id) : null;
                        if (id) {
                            try { setEntregasEmEspera(prev => prev ? prev.filter(p => String(p.id) !== id) : prev); } catch (e) { }
                            try { setRotaAtiva(prev => prev ? prev.filter(p => String(p.id) !== id) : prev); } catch (e) { }
                            try { setDraftPreview(prev => prev ? prev.filter(p => String(p.id) !== id) : prev); } catch (e) { }
                        }
                    } catch (e) { /* ignore */ }
                    try { await carregarDados(); } catch (e) { /* ignore */ }
                    return;
                }

                // For insert/update, refresh from DB (DB is single source of truth)
                try { await carregarDados(); } catch (e) { /* ignore reload errors */ }
            } catch (e) { /* ignore */ }
        };

        if (supabase && typeof supabase.channel === 'function') {
            const chan = supabase.channel('entregas-recalc')
                .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'entregas' }, handleEntregasEvent)
                .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'entregas' }, handleEntregasEvent)
                .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'entregas' }, handleEntregasEvent)
                .subscribe();

            return () => { try { supabase.removeChannel(chan); } catch (e) { chan.unsubscribe && chan.unsubscribe(); } };
        }

        // Fallback: polling
        let stopPolling = null;
        try {
            if (typeof subscribeToTable === 'function') {
                stopPolling = subscribeToTable('entregas', (res) => {
                    try { carregarDados(); } catch (e) { /* ignore */ }
                }, { pollMs: 1000 });
            }
        } catch (e) { /* ignore */ }

        return () => { try { if (stopPolling) stopPolling(); } catch (e) { /* ignore */ } };
    }, [carregarDados]);

    // Auto-zoom / fitBounds behavior for Google Map when pontos mudam (only SC-valid points)
    useEffect(() => {
        if (!mapRef.current) return;
        const map = mapRef.current;
        const pontos = [
            ...orderedRota.filter(p => isValidSC(Number(p.lat), Number(p.lng))).map(p => [Number(p.lat), Number(p.lng)]),
            ...((frota || []).filter(m => m.esta_online === true && isValidSC(Number(m.lat), Number(m.lng))).map(m => [Number(m.lat), Number(m.lng)]))
        ].filter(pt => pt && pt.length >= 2 && !isNaN(Number(pt[0])) && !isNaN(Number(pt[1])));
        if (!pontos || pontos.length === 0) {
            // No valid points in SC — center on Florianópolis and set conservative zoom
            try { map.setCenter({ lat: -27.5969, lng: -48.5495 }); map.setZoom && map.setZoom(12); } catch (e) { /* ignore */ }
            return;
        }
        const bounds = new window.google.maps.LatLngBounds();
        pontos.forEach(pt => { bounds.extend({ lat: Number(pt[0]), lng: Number(pt[1]) }); });
        try {
            map.fitBounds(bounds, 80);
            // ensure zoom isn't too close/far; clamp between 13 and 15
            const currentZoom = map.getZoom && map.getZoom();
            if (currentZoom && currentZoom < 13) map.setZoom(13);
            if (currentZoom && currentZoom > 15) map.setZoom(15);
        } catch (e) { /* ignore */ }
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

    const adicionarAosPendentes = async (e) => {
        e.preventDefault();

        // Coordenadas: usar se disponíveis via Nominatim
        let lat = null;
        let lng = null;
        if (enderecoCoords && Number.isFinite(Number(enderecoCoords.lat)) && Number.isFinite(Number(enderecoCoords.lng))) {
            lat = Number(enderecoCoords.lat);
            lng = Number(enderecoCoords.lng);
        }
        
        // Preparar observações
        const obsValue = (observacoesGestor && String(observacoesGestor).trim().length > 0) ? String(observacoesGestor).trim() : '';
        const clienteVal = (nomeCliente && String(nomeCliente).trim().length > 0) ? String(nomeCliente).trim() : null;
        const enderecoVal = (enderecoEntrega && String(enderecoEntrega).trim().length > 0) ? String(enderecoEntrega).trim() : null;
        
        if (!clienteVal || !enderecoVal) { 
            alert('Preencha nome do cliente e endereço.'); 
            return; 
        }
        
        // IMPORTANTE: Se não tiver coordenadas, tentar geocodificar com Nominatim
        // MAS se falhar, SALVAR MESMO ASSIM (fallback gracioso - user requirement)
        if (lat === null || lng === null) {
            console.log('🔍 Tentando geocodificar com Nominatim:', enderecoVal);
            
            try {
                const result = await geocodeNominatim(enderecoVal);
                
                if (result && result.lat != null && result.lng != null) {
                    lat = result.lat;
                    lng = result.lng;
                    console.log('✅ Endereço geocodificado com sucesso:', enderecoVal, '->', { lat, lng });
                } else {
                    console.warn('⚠️ Nominatim não encontrou coordenadas - salvando com lat/lng da sede');
                    // FALLBACK GRACIOSO: usar coordenadas da sede
                    lat = DEFAULT_MAP_CENTER.lat;
                    lng = DEFAULT_MAP_CENTER.lng;
                }
            } catch (geocodeError) {
                console.warn('⚠️ Geocoding falhou, usando coordenadas da sede:', geocodeError);
                // FALLBACK GRACIOSO: usar coordenadas da sede
                lat = DEFAULT_MAP_CENTER.lat;
                lng = DEFAULT_MAP_CENTER.lng;
            }
        }
        
        // Debug: verificar estado do supabase
        console.log('🔵 adicionarAosPendentes - supabase:', supabase, 'supabaseRef.current:', supabaseRef.current);
        
        const sb = supabaseRef.current || supabase;
        if (!sb || typeof sb.from !== 'function') { 
            console.error('❌ Supabase não disponível:', { sb, supabase, ref: supabaseRef.current }); 
            alert('Banco de dados indisponível no momento. Aguarde alguns segundos e tente novamente.'); 
            return; 
        }
        // Validação final: NUNCA salvar sem coordenadas válidas
        if (lat === null || lng === null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
            console.error('❌ BLOQUEIO: Tentativa de salvar entrega sem coordenadas válidas');
            alert('❌ Erro: Não é possível salvar entrega sem coordenadas exatas.');
            return;
        }
        
        console.log('✅ Salvando entrega com coordenadas validadas:', { cliente: clienteVal, endereco: enderecoVal, lat, lng });
        
        const { error } = await sb.from('entregas').insert([{
            cliente: clienteVal,
            endereco: enderecoVal,
            tipo: String(tipoEncomenda || '').trim(),
            lat: lat,
            lng: lng,
            status: String(NEW_LOAD_STATUS).trim().toLowerCase(),
            observacoes: obsValue
        }]);
        if (!error) {
            alert("✅ Salvo com sucesso!");
            setNomeCliente(''); setEnderecoEntrega(''); setObservacoesGestor(''); setEnderecoCoords(null); setEnderecoFromHistory(false);
            // clear draft preview point after persisting
            setDraftPoint(null);
            try { carregarDados(); } catch (e) { }
        } else {
            alert('❌ Erro ao salvar: ' + (error.message || 'Erro desconhecido'));
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
        
        console.log('🗑️ Excluindo entrega ID:', parsedId);
        const { error } = await sb.from('entregas').delete().eq('id', parsedId);
        
        if (error) {
            console.error('❌ Erro ao excluir entrega:', error);
        } else {
            console.log('✅ Entrega excluída com sucesso!');
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
            prev.map(e => e.id === entregaId ? { ...e, status: 'concluida' } : e)
        );
        setEntregasEmEspera(prev => 
            prev.map(e => e.id === entregaId ? { ...e, status: 'concluida' } : e)
        );
        setRotaAtiva(prev => 
            prev.map(e => e.id === entregaId ? { ...e, status: 'concluida' } : e)
        );

        // Atualizar no banco
        const { error } = await sb.from('entregas')
            .update({ status: 'concluida' })
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
                    setShowDriverSelect(false);
                    setSelectedMotorista(null);
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
            console.log('📍 Lista de paradas:', rotaOtimizada.map((e, i) => `${i+1}. ${e.cliente} - ${e.endereco}`).join('\n'));
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
                                        whenCreated={(map) => {
                                            mapRef.current = map;
                                        }}
                                    >
                                        {/* OpenStreetMap Tile Layer */}
                                        <TileLayer
                                            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                                            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                                        />
                                        
                                        {/* Motoristas online */}
                                        {(frota || []).filter(m => m.aprovado === true && m.esta_online === true && isValidSC(Number(m.lat), Number(m.lng))).map(motorista => (
                                            <Marker
                                                key={`motorista-${motorista.id}`}
                                                position={[Number(motorista.lat), Number(motorista.lng)]}
                                                icon={createMotoristaIcon(fullName(motorista))}
                                            >
                                                <Tooltip permanent direction="top" offset={[0, -20]}>
                                                    <strong>{fullName(motorista)}</strong>
                                                </Tooltip>
                                                <Popup>
                                                    <div>
                                                        <strong>{fullName(motorista)}</strong><br />
                                                        {motorista.veiculo && `Veículo: ${motorista.veiculo}`}
                                                    </div>
                                                </Popup>
                                            </Marker>
                                        ))}
                                        
                                        {/* Entregas em espera (pendentes) */}
                                        {(() => {
                                            const statusInvalidos = ['concluida', 'concluída', 'finalizada', 'entregue', 'cancelada', 'cancelado'];
                                            return (entregasEmEspera || []).filter(e => {
                                                const status = String(e.status || '').toLowerCase().trim();
                                                const hasValidCoords = e.lat != null && e.lng != null && 
                                                                       Number.isFinite(Number(e.lat)) && 
                                                                       Number.isFinite(Number(e.lng)) &&
                                                                       isValidSC(Number(e.lat), Number(e.lng));
                                                return !statusInvalidos.includes(status) && hasValidCoords;
                                            });
                                        })().map((entrega, idx) => {
                                            const tipo = String(entrega.tipo || 'Entrega').toLowerCase();
                                            let pinColor = tipo === 'recolha' ? '#fb923c' : (tipo === 'outros' ? '#c084fc' : '#2563eb');
                                            const num = (entrega.ordem_logistica && entrega.ordem_logistica > 0) ? entrega.ordem_logistica : (idx + 1);
                                            
                                            return (
                                                <Marker
                                                    key={`entrega-${entrega.id}`}
                                                    position={[Number(entrega.lat), Number(entrega.lng)]}
                                                    icon={createNumberedIcon(num, pinColor)}
                                                >
                                                    <Tooltip permanent direction="top" offset={[0, -40]} className="entrega-tooltip" opacity={0.9}>
                                                        <span style={{ color: pinColor, fontWeight: 'bold' }}>{num}</span>
                                                    </Tooltip>
                                                    <Popup>
                                                        <div>
                                                            <strong>{entrega.cliente}</strong><br />
                                                            {entrega.endereco}<br />
                                                            <em style={{ color: pinColor }}>{tipo.toUpperCase()}</em>
                                                        </div>
                                                    </Popup>
                                                </Marker>
                                            );
                                        })}
                                        
                                        {/* Entregas ativas (rota em andamento) */}
                                        {(entregasAtivasNoMapa || []).map((entrega, idx) => {
                                            if (!isValidSC(Number(entrega.lat), Number(entrega.lng))) return null;
                                            const tipo = String(entrega.tipo || 'Entrega').toLowerCase();
                                            let pinColor = tipo === 'recolha' ? '#fb923c' : (tipo === 'outros' ? '#c084fc' : '#10b981'); // Verde para ativas
                                            const num = (entrega.ordem_logistica && entrega.ordem_logistica > 0) ? entrega.ordem_logistica : (idx + 1);
                                            
                                            return (
                                                <Marker
                                                    key={`ativa-${entrega.id}`}
                                                    position={[Number(entrega.lat), Number(entrega.lng)]}
                                                    icon={createNumberedIcon(num, pinColor)}
                                                >
                                                    <Tooltip permanent direction="top" offset={[0, -40]} className="entrega-tooltip" opacity={0.9}>
                                                        <span style={{ color: pinColor, fontWeight: 'bold' }}>{num}</span>
                                                    </Tooltip>
                                                    <Popup>
                                                        <div>
                                                            <strong>{entrega.cliente}</strong><br />
                                                            {entrega.endereco}<br />
                                                            <em style={{ color: pinColor }}>EM ROTA</em>
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
                            <h3 style={{ marginTop: 0, color: theme.textMain }}>Status da Operação</h3>
                            {motoristaDaRota ? (
                                <div>
                                    <div style={{ padding: '15px', background: '#e0e7ff', borderRadius: '12px', marginBottom: '20px', color: theme.primary }}>
                                        <strong>🚛 Motorista:</strong> {motoristaDaRota.nome}<br />
                                        <strong>🔌 Status:</strong> {motoristaDaRota.esta_online === true ? 'Online' : 'Offline'}
                                        {motoristaDaRota.lat && motoristaDaRota.lng && (<div><strong>📍</strong> {motoristaDaRota.lat.toFixed ? `${motoristaDaRota.lat.toFixed(4)}, ${motoristaDaRota.lng.toFixed(4)}` : `${motoristaDaRota.lat}, ${motoristaDaRota.lng}`}</div>)}
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
                                        try { clearTimeout(predictionTimerRef.current); const q = String(e.target.value || '').trim(); if (q.length >= 3) { predictionTimerRef.current = setTimeout(async () => { try { await fetchHistoryMatches(q); await fetchPredictions(q); } catch (err) { /* ignore */ } }, 500); } else { setPredictions([]); setHistorySuggestions([]); } } catch (e) { }
                                    }} />

                                    {/* Suggestions dropdown: history first, then Google predictions */}
                                    {((historySuggestions && historySuggestions.length > 0) || (predictions && predictions.length > 0)) && (
                                        <div style={{ position: 'absolute', left: 0, right: 0, top: '46px', background: '#041028', zIndex: 1200, borderRadius: '8px', boxShadow: '0 8px 24px rgba(2,6,23,0.6)', maxHeight: '260px', overflowY: 'auto', border: '1px solid rgba(255,255,255,0.04)' }}>
                                            {historySuggestions && historySuggestions.map((h, idx) => (
                                                <div key={'h-' + idx} onClick={async () => { try { setNomeCliente(h.cliente || ''); setEnderecoEntrega(h.endereco || ''); setEnderecoFromHistory(true); if (h.lat != null && h.lng != null) setEnderecoCoords({ lat: Number(h.lat), lng: Number(h.lng) }); else setEnderecoCoords(null); setPredictions([]); setHistorySuggestions([]); } catch (e) { } }} style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.02)', cursor: 'pointer', color: theme.textMain }}>
                                                    <div style={{ fontWeight: 700 }}>{h.cliente || 'Histórico'}</div>
                                                    <div style={{ fontSize: '13px', opacity: 0.85 }}>{h.endereco}</div>
                                                </div>
                                            ))}
                                            {predictions && predictions.map((p, idx) => (
                                                <div key={'p-' + idx} onClick={async () => { try { await handlePredictionClick(p); } catch (e) { /* ignore */ } }} style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.02)', cursor: 'pointer', color: theme.textMain }}>
                                                    <div style={{ fontWeight: 700 }}>{p.structured_formatting && p.structured_formatting.main_text ? p.structured_formatting.main_text : p.description}</div>
                                                    <div style={{ fontSize: '13px', opacity: 0.85 }}>{p.description}</div>
                                                </div>
                                            ))}

                                            {googleUnavailable && (!predictions || predictions.length === 0) && (enderecoEntrega && String(enderecoEntrega).trim().length >= 3) && (
                                                <div style={{ padding: '12px', color: theme.textLight, borderTop: '1px solid rgba(255,255,255,0.02)' }}>
                                                    {`Sugestões de endereço temporariamente indisponíveis — cole o endereço manualmente ou escolha do Histórico.`}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                                <textarea name="observacoes_gestor" placeholder="Observações do Gestor (ex: Cuidado com o cachorro)" value={observacoesGestor} onChange={(e) => setObservacoesGestor(e.target.value)} style={{ ...inputStyle, minHeight: '92px', resize: 'vertical' }} />
                                <button type="submit" style={btnStyle(theme.primary)}>ADICIONAR À LISTA</button>
                            </form>
                        </div>

                        {/* Coluna Direita: Histórico (scroll) */}
                        <div style={{ flex: '0 0 52%', background: theme.card, padding: '18px', borderRadius: '12px', boxShadow: theme.shadow, display: 'flex', flexDirection: 'column' }}>
                            <h3 style={{ marginTop: 0, color: theme.textMain }}>Histórico de Clientes</h3>
                            <div style={{ marginBottom: '8px', color: theme.textLight, fontSize: '13px' }}>Clique para preencher o formulário à esquerda</div>
                            <div style={{ overflowY: 'auto', maxHeight: '420px', paddingRight: '6px' }}>
                                {(!allEntregas || allEntregas.length === 0) ? (
                                    <p style={{ color: theme.textLight, padding: '12px' }}>Buscando no Banco...</p>
                                ) : (
                                    allEntregas.slice(0, 10).map((it, idx) => (
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
                                    ))
                                )}
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
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px' }}>
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
const btnStyle = (bg) => ({ width: '100%', padding: '15px', borderRadius: '8px', border: 'none', background: bg, color: '#fff', fontWeight: 'bold', cursor: 'pointer', boxShadow: '0 4px 10px rgba(0,0,0,0.1)' });

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