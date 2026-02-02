import React from 'react';
import { useRef, useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
const HAS_SUPABASE_CREDENTIALS = Boolean(supabase && typeof supabase.from === 'function');

// Ícone em Data URL SVG (moto verde) definido logo no topo com fallback seguro
const _motoSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="#27ae60" d="M416 352c-44.1 0-80 35.9-80 80s35.9 80 80 80 80-35.9 80-80-35.9-80-80-35.9zm-256 0c-44.1 0-80 35.9-80 80s35.9 80 80 80 80-35.9 80-80-35.9-80-80-80zM496 256h-16.1l-64.7-129.4c-7-14.1-21.5-22.6-37.1-22.6H288v-48c0-17.7-14.3-32-32-32H160c-17.7 0-32 14.3-32 32v48H32c-17.7 0-32 14.3-32 32v160c0 17.7 14.3 32 32 32h32c0-53 43-96 96-96s96 43 96 96h64c0-53 43-96 96-96s96 43 96 96h32c17.7 0 32-14.3 32-32V288c0-17.7-14.3-32-32-32z"/></svg>';
// Símbolo SVG como Path (configuração do Google Maps Symbol) para evitar qualquer fundo

// --- CONFIGURAÇÃO VISUAL ---
// Google Maps helpers
const GOOGLE_MAPS_API_KEY = (typeof import.meta !== 'undefined' && import.meta.env) ? (import.meta.env.VITE_GOOGLE_MAPS_KEY || 'AIzaSyBeec8r4DWBdNIEFSEZg1CgRxIHjYMV9dM') : 'AIzaSyBeec8r4DWBdNIEFSEZg1CgRxIHjYMV9dM';

function numberedIconUrl(number) {
    const n = number || '';
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='36' height='36'><circle cx='18' cy='18' r='18' fill='%232563eb' stroke='%23fff' stroke-width='3'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-size='16' fill='%23fff' font-family='Arial' font-weight='800'>${n}</text></svg>`;
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

const motoristaIconUrl = 'http://maps.google.com/mapfiles/ms/icons/blue-dot.png';

function motoristaIconUrlFor(heading = 0, color = '#2563eb') {
    // simple truck / arrow SVG rotated by `heading` degrees around center
    // color param controls the main fill color (ex: azul, laranja, roxo, verde)
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 40 40'>
        <g transform='translate(20 20) rotate(${heading})'>
            <rect x='-10' y='-8' width='20' height='12' rx='3' fill='${color}' stroke='%23fff' stroke-width='1'/>
            <polygon points='10,-5 16,0 10,5' fill='${color}' />
            <circle cx='-6' cy='6' r='3' fill='%23000' />
            <circle cx='6' cy='6' r='3' fill='%23000' />
        </g>
    </svg>`;
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function motorcycleIconWithName(name = '') {
    const label = String(name || '').trim();
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='40' viewBox='0 0 160 40'>
        <style>text{font:700 12px/1.2 sans-serif; fill:#fff}</style>
        <rect x='0' y='0' width='160' height='40' rx='8' fill='#111827' opacity='0.95'/>
        <g transform='translate(8,6)'>
            <svg x='0' y='0' width='28' height='28' viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'>
                <path fill='%23ff6b6b' d='M5 16a1 1 0 100 2 1 1 0 000-2zm11 0a1 1 0 100 2 1 1 0 000-2zM3 6h2l1.5 4h9l1-2h-6l-1-2H6' />
            </svg>
        </g>
        <text x='48' y='22'>${label}</text>
    </svg>`;
    const url = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
    if (typeof window !== 'undefined' && window.google && window.google.maps) {
        return {
            url,
            scaledSize: new window.google.maps.Size(50, 50),
            anchor: new window.google.maps.Point(25, 25)
        };
    }
    return { url };
}

// AdvancedMarker removed: using legacy Marker for stability

// Smart loader: only uses LoadScript if Google API not already present
// SmartLoadScript removed. We'll inject the Google Maps script once via useEffect in the App component.

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

// theme state will be set inside the App component
// Status padrão para novas cargas — sempre em minúsculas
const NEW_LOAD_STATUS = 'aguardando';

// --- LÓGICA (NÃO MEXEMOS EM NADA AQUI) ---

const otimizarRota = (pontoPartida, listaEntregas) => {
    let rotaOrdenada = [];
    let atual = pontoPartida;
    let pendentes = [...listaEntregas];
    while (pendentes.length > 0) {
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
        }
    }
    return rotaOrdenada;
};

// Otimiza rota usando Google Directions API com optimizeWaypoints
// Retorna a lista de entregas reordenada conforme waypoint_order
async function otimizarRotaComGoogle(pontoPartida, listaEntregas, motoristaId = null) {
    // Filtrar apenas entregas ativas com status 'pendente' (sanitizado)
    const remaining = (listaEntregas || []).filter(p => String(p.status || '').trim().toLowerCase() === 'pendente');
    if (!remaining || remaining.length === 0) return [];
    // Determinar origem dinâmica: se houver motoristaId, buscar última entrega concluída
    let originLatLng;
    try {
        if (motoristaId != null) {
            const { data: lastDone } = await supabase.from('entregas').select('lat,lng').eq('motorista_id', motoristaId).eq('status', 'concluido').order('id', { ascending: false }).limit(1);
            if (lastDone && lastDone.length > 0 && lastDone[0].lat != null && lastDone[0].lng != null) {
                originLatLng = { lat: Number(lastDone[0].lat), lng: Number(lastDone[0].lng) };
            }
        }
    } catch (e) {
        console.warn('otimizarRotaComGoogle: falha ao buscar última entrega concluída', e);
    }
    // Se não determinamos origin a partir do motorista, derive de pontoPartida (empresa)
    if (!originLatLng) {
        if (pontoPartida && typeof pontoPartida === 'object' && 'lat' in pontoPartida && 'lng' in pontoPartida) {
            originLatLng = { lat: Number(pontoPartida.lat), lng: Number(pontoPartida.lng) };
        } else if (Array.isArray(pontoPartida) && pontoPartida.length >= 2) {
            originLatLng = { lat: Number(pontoPartida[0]), lng: Number(pontoPartida[1]) };
        } else {
            originLatLng = { lat: 0, lng: 0 };
        }
    }

    if (typeof window === 'undefined' || !window.google || !window.google.maps || !window.google.maps.DirectionsService) {
        // fallback para algoritmo local quando Google não disponível
        const local = otimizarRota(pontoPartida, remaining);
        // Persistir ordem_entrega localmente também
        try {
            for (let i = 0; i < local.length; i++) {
                const pid = local[i].id;
                if (!pid) continue;
                await supabase.from('entregas').update({ ordem_entrega: Number(i + 1) }).eq('id', pid);
            }
        } catch (e) { /* non-blocking */ }
        return local;
    }

    return new Promise((resolve, reject) => {
        try {
            const directionsService = new window.google.maps.DirectionsService();

            const waypoints = remaining.map(p => ({ location: { lat: Number(p.lat), lng: Number(p.lng) }, stopover: true }));

            // Não chamar Google se não houver waypoints válidos
            if (!waypoints || waypoints.length === 0) {
                console.warn('otimizarRotaComGoogle: nenhum waypoint válido para otimizar');
                resolve(remaining);
                return;
            }

            const request = {
                origin: originLatLng,
                destination: originLatLng,
                travelMode: window.google.maps.TravelMode.DRIVING,
                waypoints,
                optimizeWaypoints: true
            };

            directionsService.route(request, async (result, status) => {
                try {
                    const hasRoutes = Array.isArray(result?.routes) && result.routes.length > 0;
                    if (status === 'OK' && hasRoutes) {
                        const wpOrder = result?.routes?.[0]?.waypoint_order;
                        let ordered = remaining;
                        if (Array.isArray(wpOrder) && wpOrder.length === waypoints.length) {
                            ordered = wpOrder.map(i => remaining[i]);
                        }

                        // Atualizar ordem_entrega no Supabase para as entregas restantes
                        try {
                            for (let i = 0; i < ordered.length; i++) {
                                const pedido = ordered[i];
                                const pid = pedido.id;
                                if (!pid) continue;
                                const { error: ordErr } = await supabase.from('entregas').update({ ordem_entrega: Number(i + 1) }).eq('id', pid);
                                if (ordErr) console.error('otimizarRotaComGoogle: erro atualizando ordem_entrega', ordErr.message || ordErr);
                            }
                        } catch (e) {
                            console.error('otimizarRotaComGoogle: falha ao persistir ordem_entrega', e && e.message ? e.message : e);
                        }

                        resolve(ordered);
                        return;
                    }

                    if (status === 'ZERO_RESULTS') {
                        // Sem rota possível, retorna lista original
                        resolve(remaining);
                        return;
                    }

                    // Outros status: fallback conservador para lista original
                    console.warn('DirectionsService retornou status:', status, 'result:', result);
                    try { alert('Aviso: otimização de rota indisponível no momento. Usando ordem conservadora.'); } catch (e) { }
                    resolve(remaining);
                } catch (e) {
                    console.error('otimizarRotaComGoogle: erro no callback do DirectionsService', e);
                    try { alert('Erro ao otimizar rota com Google Maps. Mantendo ordem atual.'); } catch (e2) { }
                    resolve(remaining);
                }
            });
        } catch (e) {
            reject(e);
        }
    });
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

// Marker list memoizado: re-renderiza somente quando referência da frota mudar ou zoom/mapsLib mudar
const MarkerList = React.memo(function MarkerList({ frota = [], mapsLib, zoomLevel, onSelect }) {
    if (!mapsLib || !mapsLib.Map) return null;
    const MarkerComp = mapsLib.AdvancedMarker || (({ children }) => <div>{children}</div>);
    return (frota || []).filter(motorista => motorista.esta_online === true && motorista.lat != null && motorista.lng != null && !isNaN(parseFloat(motorista.lat)) && !isNaN(parseFloat(motorista.lng))).map(motorista => {
        const iconSize = zoomLevel > 15 ? 48 : 32;
        return (
            <MarkerComp
                key={motorista.id}
                position={{ lat: parseFloat(motorista.lat), lng: parseFloat(motorista.lng) }}
            >
                <div onClick={() => onSelect && onSelect(motorista)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', transform: 'translateY(-20px)', cursor: 'pointer' }}>
                    <div style={{ backgroundColor: 'white', color: 'black', padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 'bold', boxShadow: '0 2px 5px rgba(0,0,0,0.2)', marginBottom: '4px' }}>
                        {motorista.nome || 'Entregador'}
                    </div>
                    <img src="/bicicleta-de-entrega.png" alt="Entregador" style={{ width: `${iconSize}px`, height: `${iconSize}px`, objectFit: 'contain', transition: 'width 0.3s ease-in-out, height 0.3s ease-in-out' }} />
                </div>
            </MarkerComp>
        );
    });
}, (prev, next) => prev.frota === next.frota && prev.mapsLib === next.mapsLib && prev.zoomLevel === next.zoomLevel);

// Linha da tabela de motorista memoizada: só re-renderiza quando a referência do objeto mudar
const MotoristaRow = React.memo(function MotoristaRow({ m, onClick, entregasAtivos, theme, onApprove, onReject }) {
    const isOnline = Boolean(m.esta_online);
    const dotColor = isOnline ? '#10b981' : '#ef4444';
    const dotShadow = isOnline ? '0 0 10px rgba(16,185,129,0.45)' : '0 0 6px rgba(239,68,68,0.18)';
    const entregasMot = (entregasAtivos || []).filter(e => String(e.motorista_id) === String(m.id));
    const total = entregasMot.length;
    const feitas = entregasMot.filter(e => String(e.status || '').trim().toLowerCase() === 'concluido').length;
    const tipoPrincipal = (entregasMot.find(e => e.tipo && String(e.tipo).trim().length > 0) || {}).tipo || null;
    const tipoColor = tipoPrincipal ? (tipoPrincipal === 'recolha' ? '#fb923c' : (tipoPrincipal === 'outros' ? '#c084fc' : '#60a5fa')) : null;
    const verbByTipo = (t) => { const tt = String(t || '').trim().toLowerCase(); if (tt === 'entrega') return 'Entregando'; if (tt === 'recolha') return 'Recolhendo'; if (tt === 'outros' || tt === 'outro') return 'Ativo'; return 'Em serviço'; };

    return (
        <tr key={m.id} onClick={() => onClick && onClick(m)} style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }}>
            <td style={{ padding: '15px 10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ width: '12px', height: '12px', borderRadius: '50%', background: dotColor, display: 'inline-block', boxShadow: dotShadow }} />
                <span style={{ color: '#ffffff', fontWeight: 600 }}>{m.nome}</span>
            </td>
            <td>
                <span style={{ padding: '6px 10px', borderRadius: '12px', background: 'transparent', color: (total > 0 ? (tipoColor || (isOnline ? '#10b981' : 'rgba(239,68,68,0.6)')) : (isOnline ? '#10b981' : 'rgba(239,68,68,0.6)')), fontSize: '12px', fontWeight: 700, textShadow: isOnline ? '0 1px 6px rgba(16,185,129,0.35)' : 'none', opacity: isOnline ? 1 : 0.6 }}>
                    {total > 0 ? `${verbByTipo(tipoPrincipal)} ${feitas}/${total}` : (isOnline ? 'Disponível' : 'Offline')}
                </span>
            </td>
            <td style={{ color: isOnline ? undefined : '#9ca3af' }}>{m.veiculo}</td>
            <td style={{ fontFamily: 'monospace', color: isOnline ? undefined : '#9ca3af' }}>{m.placa}</td>
            <td style={{ padding: '10px' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#0f172a', color: '#fff', padding: '6px 10px', borderRadius: '999px', fontSize: '13px', fontWeight: 700 }}>
                    <span style={{ color: '#10b981' }}>{feitas}</span>
                    <span style={{ color: '#9ca3af', fontWeight: 600 }}>/</span>
                    <span style={{ color: '#ef4444', opacity: 0.9 }}>{total}</span>
                </span>
            </td>
            { (onApprove || onReject) && (
                <td style={{ padding: '10px', display: 'flex', gap: '8px' }}>
                    {onApprove && (
                        <button onClick={(e) => { e.stopPropagation && e.stopPropagation(); try { onApprove && onApprove(m); } catch (err) {} }} style={{ background: '#10b981', color: '#fff', fontWeight: 700, border: 'none', padding: '8px 10px', borderRadius: '8px', cursor: 'pointer' }} className="action-btn green">APROVAR</button>
                    )}
                    {onReject && (
                        <button onClick={(e) => { e.stopPropagation && e.stopPropagation(); try { onReject && onReject(m); } catch (err) {} }} style={{ background: '#ef4444', color: '#fff', fontWeight: 700, border: 'none', padding: '8px 10px', borderRadius: '8px', cursor: 'pointer' }} className="action-btn red">REPROVAR</button>
                    )}
                </td>
            )}
        </tr>
    );
}, (p, n) => p.m === n.m && p.entregasAtivos === n.entregasAtivos && p.theme === n.theme);

function App() {
    // mapa dinamicamente importado para prevenir que falhas no build do pacote quebrem o app
    const [mapsLib, setMapsLib] = useState(null);
    const [mapsLoadError, setMapsLoadError] = useState(false);
    const [loadingFrota, setLoadingFrota] = useState(false);
    const [darkMode, setDarkMode] = useState(true);
    const theme = darkMode ? darkTheme : lightTheme;
    const [abaAtiva, setAbaAtiva] = useState('Visão Geral'); // Mudei o nome pra ficar chique
    // Localização do gestor removida do dashboard: não solicitamos GPS aqui

    // Estados do Supabase
    const [entregasEmEspera, setEntregasEmEspera] = useState([]); // agora vem de `entregas`
    const [frota, setFrota] = useState([]); // agora vem de `motoristas`
    const [totalEntregas, setTotalEntregas] = useState(0);
    const [avisos, setAvisos] = useState([]);
    const [gestorPhone, setGestorPhone] = useState(null);
    const [nomeGestor, setNomeGestor] = useState(null);
    const [rotaAtiva, setRotaAtiva] = useState([]);
    const [motoristaDaRota, setMotoristaDaRota] = useState(null);
    const [selectedMotorista, setSelectedMotorista] = useState(null);
    const [showDriverSelect, setShowDriverSelect] = useState(false);
    const [observacoesGestor, setObservacoesGestor] = useState('');
    const [dispatchLoading, setDispatchLoading] = useState(false);
    const [mensagemGeral, setMensagemGeral] = useState('');
    const [enviandoGeral, setEnviandoGeral] = useState(false);
    const [btnPressed, setBtnPressed] = useState(false);
    const [destinatario, setDestinatario] = useState('all');
    const [nomeCliente, setNomeCliente] = useState('');
    const [enderecoEntrega, setEnderecoEntrega] = useState('');
    const [recentList, setRecentList] = useState([]);
    const [user, setUser] = useState(null);
    const [session, setSession] = useState(null);
    const [tipoEncomenda, setTipoEncomenda] = useState('Entrega');
    const audioRef = useRef(new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3'));

    const mapRef = useRef(null);
    const mapRefUnused = mapRef; // preserve ref usage pattern; no history counters needed
    // Google API loading is handled by APIProvider from the maps library (mapsLib.APIProvider)
    const googleLoaded = typeof window !== 'undefined' && window.google && window.google.maps ? true : false;
    const [zoomLevel, setZoomLevel] = useState(13);
    const DEFAULT_MAP_CENTER = { lat: -27.645, lng: -48.648 };
    const [mapCenterState, setMapCenterState] = useState(DEFAULT_MAP_CENTER);
    const [gestorLocation, setGestorLocation] = useState('São Paulo, BR');

    // Função de carregamento de dados (declarada cedo para evitar ReferenceError)
    const carregarDados = React.useCallback(async () => {
        if (!HAS_SUPABASE_CREDENTIALS) {
            console.error('carregarDados: Supabase keys missing — aborting data load');
            return;
        }
        if (!supabase) {
            console.error('carregarDados: supabase client not initialized — aborting');
            return;
        }
        setLoadingFrota(true);
        // motoristas reais
        try {
            let q = supabase.from('motoristas').select('*');
            if (q && typeof q.order === 'function') q = q.order('id');
            const { data: motoristas, error: motorErr } = await q;
            if (motorErr) {
                console.warn('carregarDados: erro ao buscar motoristas', motorErr);
                setFrota([]);
            } else {
                const normalized = (motoristas || []).map(m => ({
                    ...m,
                    lat: m.lat != null ? Number(String(m.lat).trim()) : m.lat,
                    lng: m.lng != null ? Number(String(m.lng).trim()) : m.lng
                }));

                setFrota(prev => {
                    try {
                        const byId = new Map((prev || []).map(p => [p.id, p]));
                        const merged = normalized.map(n => {
                            const existing = byId.get(n.id);
                            if (existing && Number(existing.lat) === Number(n.lat) && Number(existing.lng) === Number(n.lng) && existing.nome === n.nome) {
                                return existing;
                            }
                            return n;
                        });
                        return merged;
                    } catch (e) {
                        return normalized;
                    }
                });
            }
        } catch (e) { console.warn('Erro carregando motoristas:', e); setFrota([]); }

        // entregas: filtro por NEW_LOAD_STATUS
        try {
            let q = supabase.from('entregas').select('*');
            if (q && typeof q.eq === 'function') q = q.eq('status', String(NEW_LOAD_STATUS).trim().toLowerCase());
            const { data: entregasPend, error: entregasErr } = await q;
            if (entregasErr) { console.warn('carregarDados: erro ao buscar entregas (filtro de status)', entregasErr); setEntregasEmEspera([]); } else setEntregasEmEspera(entregasPend || []);
        } catch (e) { console.warn('Erro carregando entregas (filtro de status):', e); setEntregasEmEspera([]); }

        // total de entregas
        try {
            let q2 = supabase.from('entregas').select('*');
            const { data: todas } = await q2;
            setTotalEntregas((todas || []).length);
        } catch (e) { console.warn('Erro contando entregas:', e); setTotalEntregas(0); }

        // avisos do gestor
        try {
            let q3 = supabase.from('avisos_gestor').select('titulo, mensagem, created_at');
            if (q3 && typeof q3.order === 'function') q3 = q3.order('created_at', { ascending: false });
            if (q3 && typeof q3.limit === 'function') q3 = q3.limit(10);
            const { data: avisosData, error: avisosErr } = await q3;
            if (avisosErr) { console.warn('carregarDados: erro ao buscar avisos', avisosErr); setAvisos([]); } else setAvisos(avisosData || []);
        } catch (e) { console.warn('Erro carregando avisos:', e); setAvisos([]); }

        // configuracoes (gestor_phone)
        try {
            let q4 = supabase.from('configuracoes').select('valor').eq('chave', 'gestor_phone');
            if (q4 && typeof q4.limit === 'function') q4 = q4.limit(1);
            const { data: cfg } = await q4;
            if (cfg && cfg.length > 0) setGestorPhone(cfg[0].valor); else setGestorPhone(null);
        } catch (e) { console.warn('Erro carregando configuracoes:', e); setGestorPhone(null); }

        // Histórico recente
        try {
            let q5 = supabase.from('entregas').select('cliente,endereco,created_at');
            if (q5 && typeof q5.order === 'function') q5 = q5.order('id', { ascending: false });
            if (q5 && typeof q5.limit === 'function') q5 = q5.limit(200);
            const { data: recent, error: recentErr } = await q5;
            if (recentErr) { console.warn('carregarDados: erro ao buscar histórico', recentErr); setRecentList([]); }
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
            const sid = String(id);
            const { data, error } = await supabase.from('motoristas').update({ aprovado: true, acesso: 'aprovado' }).eq('id', sid).select();
            if (error) {
                console.error('aprovarMotorista db error:', error);
                return { error };
            }
            try { await carregarDados(); } catch (e) { /* non-blocking */ }
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
                        console.log('Removed legacy motorista id from localStorage key', k);
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
    }, []);

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
                            if (status === 'OK') resolve(res); else reject(status);
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

                // Fallback: usar Nominatim (OpenStreetMap)
                try {
                    const resp = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}`);
                    if (resp.ok) {
                        const j = await resp.json();
                        const addr = j.address || {};
                        const city = addr.city || addr.town || addr.village || addr.county || '';
                        const state = addr.state || addr.region || '';
                        if (city || state) setGestorLocation(`${city || 'São Paulo'}, ${state || 'BR'}`);
                        else setGestorLocation('São Paulo, BR');
                        return;
                    }
                } catch (e) {
                    // swallow and fallback
                }
            } catch (e) {
                // swallow
            }
            if (mounted) setGestorLocation('São Paulo, BR');
        };

        const fail = () => { if (mounted) setGestorLocation('São Paulo, BR'); };

        navigator.geolocation.getCurrentPosition(success, fail, { timeout: 10000, maximumAge: 600000 });
        return () => { mounted = false; };
    }, []);

    // Import dinâmico do pacote de mapas (evita crash no build/SSR quando o pacote falha)
    useEffect(() => {
        let mounted = true;
        (async () => {
            setLoadingFrota(true);
            try {
                const lib = await import('@vis.gl/react-google-maps');
                if (!mounted) return;
                setMapsLib(lib || null);
            } catch (e) {
                console.warn('Falha ao carregar @vis.gl/react-google-maps (fallback ativado):', e && e.message ? e.message : e);
                if (!mounted) return;
                setFrota([]);
                setMapsLoadError(true);
            }
        })();
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

    // Center for map: force Santa Catarina as requested
    const motoristaLeandro = frota && frota.find ? frota.find(m => m.id === 1) : null;
    // Forçar centro em Santa Catarina (coordenadas antigas removidas) — usar `mapCenterState`.

    // SmoothMarker: mantém posição exibida localmente para permitir transições CSS suaves
    const SmoothMarker = ({ m }) => {
        const [displayPos, setDisplayPos] = useState({ lat: Number(m.lat) || 0, lng: Number(m.lng) || 0 });
        useEffect(() => {
            // Ao receber novas coordenadas do Supabase, atualiza gradualmente o estado exibido
            setDisplayPos({ lat: Number(m.lat) || 0, lng: Number(m.lng) || 0 });
        }, [m.lat, m.lng]);

        const iconSize = zoomLevel > 15 ? 48 : 32;
        const MarkerComp = mapsLib && mapsLib.AdvancedMarker ? mapsLib.AdvancedMarker : ({ children }) => <div>{children}</div>;
        return (
            <MarkerComp key={m.id} position={{ lat: Number(displayPos.lat), lng: Number(displayPos.lng) }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', transform: 'translateY(-20px)' }}>
                    <div style={{ backgroundColor: 'white', color: 'black', padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 'bold', boxShadow: '0 2px 5px rgba(0,0,0,0.2)', marginBottom: '4px' }}>
                        {m.nome || 'Entregador'}
                    </div>
                    <img src="/bicicleta-de-entrega.png" alt="Entregador" style={{ width: `${iconSize}px`, height: `${iconSize}px`, objectFit: 'contain', transition: 'width 0.3s ease-in-out, height 0.3s ease-in-out' }} />
                </div>
            </MarkerComp>
        );
    };

    // (MapControls removed — using single `BotoesMapa` inside <Map>)

    // Componente interno obrigatório para controle do mapa (deve ficar DENTRO de <Map>..</Map>)
    function BotoesMapa() {
        const map = mapsLib && typeof mapsLib.useMap === 'function' ? mapsLib.useMap() : null;
        const [spinning, setSpinning] = useState(false);
        const handleRefresh = () => {
            try { setSpinning(true); } catch (e) { }
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition((position) => {
                    const { latitude, longitude } = position.coords;
                    if (map) {
                        map.panTo({ lat: latitude, lng: longitude });
                        map.setZoom(15);
                    }
                    try { carregarDados(); } catch (e) { /* non-blocking */ }
                    // stop spinning after a short interval to show feedback
                    try { setTimeout(() => setSpinning(false), 900); } catch (e) { }
                }, () => { try { setSpinning(false); } catch (e) { } });
            } else {
                try { setSpinning(false); } catch (e) { }
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

        const canal = supabase
            .channel('rastreio-v10')
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'motoristas' }, (payload) => {
                try {
                    console.log('📡 GPS CHEGOU DO BANCO:', payload.new);
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
                } catch (e) {
                    console.warn('Erro no handler realtime motoristas:', e);
                }
            })
            .subscribe();

        return () => {
            try { supabase.removeChannel(canal); } catch (e) { canal.unsubscribe && canal.unsubscribe(); }
        };
    }, []);

    // Auto-zoom / fitBounds behavior for Google Map when pontos mudam
    useEffect(() => {
        if (!mapRef.current) return;
        const map = mapRef.current;
        const pontos = [
            ...orderedRota.map(p => [p.lat, p.lng]),
            ...((frota || []).map(m => [m.lat, m.lng]))
        ].filter(pt => pt && pt.length >= 2 && !isNaN(Number(pt[0])) && !isNaN(Number(pt[1])));
        if (!pontos || pontos.length === 0) return;
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
        const baseLat = Number((mapCenterState && mapCenterState.lat) || 0);
        const baseLng = Number((mapCenterState && mapCenterState.lng) || 0);
        const lat = baseLat + (Math.random() - 0.5) * 0.04;
        const lng = baseLng + (Math.random() - 0.5) * 0.04;
        // Preparar observações: sempre enviar string ('' quando vazio) e aplicar trim
        const obsValue = (observacoesGestor && String(observacoesGestor).trim().length > 0) ? String(observacoesGestor).trim() : '';
        const clienteVal = (nomeCliente && String(nomeCliente).trim().length > 0) ? String(nomeCliente).trim() : null;
        const enderecoVal = (enderecoEntrega && String(enderecoEntrega).trim().length > 0) ? String(enderecoEntrega).trim() : null;
        if (!clienteVal || !enderecoVal) { alert('Preencha nome do cliente e endereço.'); return; }
        const { error } = await supabase.from('entregas').insert([{
            cliente: clienteVal,
            endereco: enderecoVal,
            tipo: String(tipoEncomenda || '').trim(),
            lat: lat,
            lng: lng,
            status: String(NEW_LOAD_STATUS).trim().toLowerCase(),
            observacoes: obsValue
        }]);
        if (!error) { alert("✅ Salvo com sucesso!"); setNomeCliente(''); setEnderecoEntrega(''); setObservacoesGestor(''); carregarDados(); }
    };

    const excluirPedido = async (id) => {
        const parsedId = typeof id === 'string' ? parseInt(id, 10) : id;
        if (!parsedId || isNaN(parsedId)) {
            console.warn('excluirPedido: id inválido', id);
            return () => {
                try { supabase.removeChannel && supabase.removeChannel(channel); } catch (e) { /* ignore */ }
            };
        }
        const { error } = await supabase.from('entregas').delete().eq('id', parsedId);
        if (!error) carregarDados();
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
        setDispatchLoading(true);
        try {
            try { audioRef.current.play().catch(() => { }); } catch (e) { }
            let rotaOtimizada = [];
            try {
                rotaOtimizada = await otimizarRotaComGoogle(mapCenterState, entregasEmEspera, motoristaIdVal);
                if (!rotaOtimizada || rotaOtimizada.length === 0) rotaOtimizada = otimizarRota(mapCenterState, entregasEmEspera);
            } catch (e) {
                // fallback para algoritmo local em caso de erro com Google API
                rotaOtimizada = otimizarRota(mapCenterState, entregasEmEspera);
            }
            // Validate motorista exists in local `frota` to avoid sending wrong id
            const motoristaExists = frota && frota.find ? frota.find(m => String(m.id) === String(motoristaIdVal)) : null;
            if (!motoristaExists) console.warn('assignDriver: motorista_id não encontrado na frota local', motoristaIdVal);
            // status para despacho: seguir regra solicitada ('pendente')
            const statusValue = String('pendente').trim().toLowerCase();

            // Determine entregas to dispatch and collect their IDs (preserve original type)
            const entregasParaDespachar = rotaOtimizada || []; // use rota otimizada as the set to dispatch
            const assignedIds = entregasParaDespachar.map(p => p.id).filter(id => id !== undefined && id !== null);
            const assignedIdsStr = assignedIds.map(id => String(id));

            if (assignedIds.length === 0) {
                console.warn('assignDriver: nenhum pedido válido para atualizar');
            } else {
                let updErr = null;
                try {
                    // Try bulk update; if .in is not available (mock), fallback to per-item updates
                    let q = supabase.from('entregas').update({ motorista_id: motoristaIdVal, status: statusValue });
                    if (q && typeof q.in === 'function') {
                        const { data: updData, error } = await q.in('id', assignedIds);
                        updErr = error;
                        if (!updErr) {
                            setEntregasEmEspera(prev => prev.filter(p => !assignedIdsStr.includes(String(p.id))));
                        }
                    } else {
                        // Fallback: update one by one
                        for (const id of assignedIds) {
                            try {
                                const { error } = await supabase.from('entregas').update({ motorista_id: motoristaIdVal, status: statusValue }).eq('id', id);
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
                    rotaOtimizada[i] = { ...pedido, ordem: i + 1, ordem_entrega: i + 1, motorista_id: motoristaIdVal, id: pid };
                }

                // Only close modal and clear selection if update succeeded
                if (!updErr) {
                    setShowDriverSelect(false);
                    setSelectedMotorista(null);
                }
            }
            // Persist ordem_entrega per entrega (cada pedido precisa da sua ordem específica)
            try {
                for (let i = 0; i < rotaOtimizada.length; i++) {
                    const pid = rotaOtimizada[i].id;
                    if (pid === undefined || pid === null) continue;
                    try {
                        const { error: ordErr } = await supabase.from('entregas').update({ ordem_entrega: Number(i + 1) }).eq('id', pid);
                        if (ordErr) console.error('Erro atualizando ordem_entrega:', ordErr && ordErr.message, ordErr && ordErr.hint);
                    } catch (e) {
                        console.error('Erro na requisição ordem_entrega:', e && e.message);
                    }
                }
            } catch (e) { /* non-blocking */ }
            setRotaAtiva(rotaOtimizada);
            setMotoristaDaRota(driver);
            setAbaAtiva('Visão Geral');
            await carregarDados();
            alert('Rota enviada para ' + (driver.nome || 'motorista') + ' com sucesso.');
        } catch (e) {
            console.warn('Erro em assignDriver:', e);
        } finally {
            // Limpeza de estados residuais
            setShowDriverSelect(false);
            setSelectedMotorista(null);
            setDispatchLoading(false);
        }
    };

    // --- NOVA INTERFACE (AQUI ESTÁ A MUDANÇA VISUAL) ---
    const motoristas = frota || [];
    const APIProviderComp = mapsLib && mapsLib.APIProvider ? mapsLib.APIProvider : null;
    // Use explicit aprovado boolean to split lists
    const motoristasAtivos = (frota || []).filter(m => m && m.aprovado === true);
    const motoristasPendentes = (frota || []).filter(m => m && m.aprovado === false);
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
                    <CardKPI titulo="MOTORISTAS ONLINE" valor={frota.filter(m => m.esta_online).length} cor={theme.success} />
                    <CardKPI titulo="ROTA ATIVA" valor={rotaAtiva.length > 0 ? 'EM ANDAMENTO' : 'AGUARDANDO'} cor={theme.primary} />
                </div>

                {/* VISÃO GERAL (DASHBOARD) */}
                {abaAtiva === 'Visão Geral' && (
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '30px' }}>

                        {/* MAPA EM CARD (DIMINUÍDO E ELEGANTE) */}
                        <div style={{ background: theme.card, borderRadius: '16px', padding: '10px', boxShadow: theme.shadow, height: '500px' }}>
                            <div style={{ height: '100%', borderRadius: '12px', overflow: 'hidden', position: 'relative' }}>
                                {
                                    // Se a lib do maps foi carregada com sucesso, renderiza o mapa dentro de ErrorBoundary
                                    (mapsLib && mapsLib.APIProvider && mapsLib.Map) ? (
                                        (() => {
                                            const MapComp = mapsLib.Map;
                                            return (
                                                <ErrorBoundary>
                                                    <MapComp
                                                        defaultCenter={mapCenterState}
                                                        defaultZoom={zoomLevel}
                                                        mapId="546bd17ef4a30773714756d8"
                                                        style={{ width: '100%', height: '100%' }}
                                                        onZoomChanged={(ev) => setZoomLevel(ev?.detail?.zoom)}
                                                        onLoad={(m) => {
                                                            try {
                                                                const inst = (m && (m.map || m.__map || m)) || m;
                                                                mapRef.current = inst;
                                                            } catch (e) { /* ignore */ }
                                                        }}
                                                    >
                                                        <BotoesMapa />
                                                        <MarkerList frota={frota} mapsLib={mapsLib} zoomLevel={zoomLevel} onSelect={setSelectedMotorista} />
                                                    </MapComp>
                                                </ErrorBoundary>
                                            );
                                        })()
                                    ) : (
                                        // fallback seguro: evita piscar enquanto frota não carregou
                                        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0b1220' }}>
                                            {loadingFrota ? <div style={{ color: '#9ca3af' }}>Carregando posições...</div> : <div style={{ color: '#9ca3af' }}>{mapsLoadError ? 'Mapa indisponível — visualização desativada' : ''}</div>}
                                        </div>
                                    )
                                }

                                {/* Map controls consolidated: single `BotoesMapa` is rendered INSIDE the <Map> */}

                                {/* Floating refresh button removed; use single `BotoesMapa` inside the <Map> */}

                            </div>
                        </div>

                        {/* INFO LATERAL */}
                        <div style={{ background: theme.card, borderRadius: '16px', padding: '25px', boxShadow: theme.shadow, height: '500px', display: 'flex', flexDirection: 'column' }}>
                            <h3 style={{ marginTop: 0, color: theme.textMain }}>Status da Operação</h3>
                            {motoristaDaRota ? (
                                <div>
                                    <div style={{ padding: '15px', background: '#e0e7ff', borderRadius: '12px', marginBottom: '20px', color: theme.primary }}>
                                        <strong>🚛 Motorista:</strong> {motoristaDaRota.nome}<br />
                                        <strong>🔌 Status:</strong> {motoristaDaRota.esta_online ? 'Online' : 'Offline'}
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
                                                        <strong style={{ marginRight: '6px', color: theme.textLight }}>{i + 1}.</strong>
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
                            <form onSubmit={adicionarAosPendentes} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                                <label style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                    <span style={{ fontSize: '13px', color: theme.textLight }}>Tipo:</span>
                                    <select name="tipo" value={tipoEncomenda} onChange={(e) => setTipoEncomenda(e.target.value)} style={{ padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1' }}>
                                        <option>Entrega</option>
                                        <option>Recolha</option>
                                        <option>Outros</option>
                                    </select>
                                </label>
                                <input name="cliente" placeholder="Nome do Cliente" style={inputStyle} required value={nomeCliente} onChange={(e) => setNomeCliente(e.target.value)} />
                                <input name="endereco" placeholder="Endereço de Entrega" style={inputStyle} required value={enderecoEntrega} onChange={(e) => setEnderecoEntrega(e.target.value)} />
                                <textarea name="observacoes_gestor" placeholder="Observações do Gestor (ex: Cuidado com o cachorro)" value={observacoesGestor} onChange={(e) => setObservacoesGestor(e.target.value)} style={{ ...inputStyle, minHeight: '92px', resize: 'vertical' }} />
                                <button type="submit" style={btnStyle(theme.primary)}>ADICIONAR À LISTA</button>
                            </form>
                        </div>

                        {/* Coluna Direita: Histórico (scroll) */}
                        <div style={{ flex: '0 0 52%', background: theme.card, padding: '18px', borderRadius: '12px', boxShadow: theme.shadow, display: 'flex', flexDirection: 'column' }}>
                            <h3 style={{ marginTop: 0, color: theme.textMain }}>Histórico de Clientes</h3>
                            <div style={{ marginBottom: '8px', color: theme.textLight, fontSize: '13px' }}>Clique para preencher o formulário à esquerda</div>
                            <div style={{ overflowY: 'auto', maxHeight: '420px', paddingRight: '6px' }}>
                                {(!recentList || recentList.length === 0) ? (
                                    <div style={{ color: theme.textLight, padding: '12px' }}>Nenhum histórico disponível.</div>
                                ) : (
                                    recentList?.map((it, idx) => (
                                        <div key={idx} onClick={() => { setNomeCliente(it.cliente || ''); setEnderecoEntrega(it.endereco || ''); }} style={{ padding: '12px', borderRadius: '10px', marginBottom: '8px', cursor: 'pointer', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.03)' }}>
                                            <div style={{ fontWeight: 700, color: theme.textMain }}>{it.cliente}</div>
                                            <div style={{ fontSize: '13px', color: theme.textLight }}>{it.endereco}</div>
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
                            <button onClick={dispararRota} style={{ ...btnStyle(theme.success), width: 'auto' }}>🚀 DISPARAR ROTA (WHATSAPP)</button>
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
                                                        <option key={m.id} value={String(m.id)}>{m.nome}</option>
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
                                    const isOnline = Boolean(m.esta_online);
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
                                        <tr key={m.id} onClick={() => setSelectedMotorista(m)} style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }}>
                                            <td style={{ padding: '15px 10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <span style={{ width: '12px', height: '12px', borderRadius: '50%', background: dotColor, display: 'inline-block', boxShadow: dotShadow }} />
                                                <span style={{ color: '#ffffff', fontWeight: 600 }}>{m.nome}</span>
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
                    <div style={{ background: theme.card, padding: '30px', borderRadius: '16px', boxShadow: theme.shadow }}>
                        <h2 style={{ marginTop: 0 }}>Gestão de Motoristas</h2>
                        <p style={{ color: theme.textLight, marginTop: 0 }}>Lista de motoristas cadastrados. Aprove ou revogue acessos.</p>

                                <table style={{ width: '100%', borderCollapse: 'collapse', background: 'transparent' }}>
                            <thead>
                                <tr style={{ textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.06)', color: theme.textLight }}>
                                    <th style={{ padding: '10px' }}>NOME</th>
                                    <th style={{ padding: '10px' }}>EMAIL</th>
                                    <th style={{ padding: '10px' }}>AÇÕES</th>
                                </tr>
                            </thead>
                            <tbody>
                                {motoristasPendentes.map(m => (
                                    <MotoristaRow key={m.id} m={m} onClick={(mm) => setSelectedMotorista(mm)} entregasAtivos={entregasAtivos} theme={theme} onApprove={(mm) => aprovarMotorista(mm.id)} onReject={(mm) => rejectDriver(mm)} />
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

            </main>

            {/* Driver selection modal (componente minimalista) */}
            <DriverSelectModal
                visible={showDriverSelect}
                onClose={() => { setShowDriverSelect(false); setSelectedMotorista(null); }}
                frota={frota}
                onSelect={assignDriver}
                setSelectedMotorista={setSelectedMotorista}
                theme={theme}
                loading={dispatchLoading}
            />
        </div>
    );

    return APIProviderComp ? (
        <APIProviderComp apiKey={GOOGLE_MAPS_API_KEY}>{appContent}</APIProviderComp>
    ) : appContent;
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
function DriverSelectModal({ visible, onClose, frota = [], onSelect, theme, loading = false, setSelectedMotorista = null }) {
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
            try { alert('Falha ao enviar rota: ' + (err && err.message ? err.message : String(err))); } catch (e) { /* ignore */ }
        } finally {
            // garante limpeza do estado local e fecha modal sem travar a UI
            try { setLocalSelected(null); } catch (e) { }
            try { onClose(); } catch (e) { }
        }
    };

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
                                        <div style={{ fontWeight: 700, color: '#ffffff' }}>{m.nome}</div>
                                        <div style={{ fontSize: '12px', color: theme.textLight }}>{m.veiculo || ''}</div>
                                    </button>
                                </div>
                                <div>
                                    <button disabled={loading} onClick={() => handleSelect(m)} style={{ ...btnStyle(theme.primary), width: '140px' }}>{loading ? 'Enviando...' : 'Enviar Rota'}</button>
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