import React from 'react';
import { useRef, useState, useEffect } from 'react';
import supabase, { subscribeToTable } from './supabaseClient';
import MapaLogistica from './MapaLogistica';
import { geocodeMapbox, nearestNeighborRoute, getRouteGeometry } from './geoUtils';
import ErrorBoundary from './ErrorBoundary.jsx';
const HAS_SUPABASE_CREDENTIALS = Boolean(supabase && typeof supabase.from === 'function');

// Ícone em Data URL SVG (moto verde) definido logo no topo com fallback seguro
const _motoSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="#27ae60" d="M416 352c-44.1 0-80 35.9-80 80s35.9 80 80 80 80-35.9 80-80-35.9-80-80-35.9zm-256 0c-44.1 0-80 35.9-80 80s35.9 80 80 80 80-35.9 80-80-35.9-80-80-80zM496 256h-16.1l-64.7-129.4c-7-14.1-21.5-22.6-37.1-22.6H288v-48c0-17.7-14.3-32-32-32H160c-17.7 0-32 14.3-32 32v48H32c-17.7 0-32 14.3-32 32v160c0 17.7 14.3 32 32 32h32c0-53 43-96 96-96s96 43 96 96h64c0-53 43-96 96-96s96 43 96 96h32c17.7 0 32-14.3 32-32V288c0-17.7-14.3-32-32-32z"/></svg>';
// Símbolo SVG como Path (configuração do Google Maps Symbol) para evitar qualquer fundo

// --- CONFIGURAÇÃO VISUAL ---
// Usamos Leaflet/Mapbox neste projeto; não há Google Maps API key aqui.

function numberedIconUrl(number) {
    const n = number || '';
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='36' height='36'><circle cx='18' cy='18' r='18' fill='%232563eb' stroke='%23fff' stroke-width='3'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-size='16' fill='%23fff' font-family='Arial' font-weight='800'>${n}</text></svg>`;
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

// Use local moto image instead of Google marker (resolve from app root)
const motoristaIconUrl = (typeof window !== 'undefined' && window.location && window.location.origin) ? (window.location.origin + '/moto.png') : '/moto.png';

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
    return url;
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
const NEW_LOAD_STATUS = 'pendente';

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

// Otimiza rota usando Google Distance Matrix API + heuristic (nearest neighbor + 2-opt) quando disponível
// Retorna a lista de entregas reordenada conforme otimização de menor distância
async function otimizarRotaComGoogle(pontoPartida, listaEntregas, motoristaId = null) {
    // Renamed: agora usa apenas heurística local (nearest neighbor) — sem dependência do Google
    const remaining = (listaEntregas || []).filter(p => String(p.status || '').trim().toLowerCase() === 'pendente' || String(p.status || '').trim().toLowerCase() === 'em_rota');
    if (!remaining || remaining.length === 0) return [];

    // Determinar origem dinâmica: prefere lat/lng do motorista atual (se fornecido) -> última entrega concluída -> pontoPartida (empresa)
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
                const { data: lastDone } = await supabase.from('entregas').select('lat,lng').eq('motorista_id', motoristaId).eq('status', 'concluido').order('id', { ascending: false });
                if (lastDone && lastDone.length > 0 && lastDone[0].lat != null && lastDone[0].lng != null) originLatLng = { lat: Number(lastDone[0].lat), lng: Number(lastDone[0].lng) };
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
        } else {
            originLatLng = { lat: 0, lng: 0 };
        }
    }

    // Heurística local (nearest neighbor)
    const ordered = otimizarRota(originLatLng, remaining);

    // Persist ordem_logistica se solicitado (motoristaId fornecido)
    try {
        if (motoristaId != null) {
            for (let i = 0; i < ordered.length; i++) {
                const pedido = ordered[i];
                const pid = pedido.id;
                if (!pid) continue;
                await supabase.from('entregas').update({ ordem_logistica: Number(i + 1) }).eq('id', pid);
            }
        }
    } catch (e) { console.warn('otimizarRotaComGoogle (persist): falha ao persistir ordem_logistica', e); }

    return ordered;
}

// Using shared ErrorBoundary component from src/ErrorBoundary.jsx

// Nota: badge fixo do gestor removido para evitar duplicidade visual

// Marker list memoizado: re-renderiza somente quando referência da frota mudar ou zoom/mapsLib mudar
const MarkerList = React.memo(function MarkerList({ frota = [], mapsLib, zoomLevel, onSelect }) {
    if (!mapsLib || !mapsLib.Map) return null;
    const MarkerComp = mapsLib.AdvancedMarker || (({ children }) => <div>{children}</div>);
    return (frota || []).filter(motorista => motorista.aprovado === true && motorista.esta_online === true && motorista.lat != null && motorista.lng != null && !isNaN(parseFloat(motorista.lat)) && !isNaN(parseFloat(motorista.lng))).map(motorista => {
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
                    <img src="/bicicleta-de-entrega.png" alt="Entregador" onError={(e) => { try { e.target.onerror = null; e.target.src = motoristaIconUrl; } catch (_) { } }} style={{ width: `${iconSize}px`, height: `${iconSize}px`, objectFit: 'contain', transition: 'width 0.3s ease-in-out, height 0.3s ease-in-out' }} />
                </div>
            </MarkerComp>
        );
    });
}, (prev, next) => prev.frota === next.frota && prev.mapsLib === next.mapsLib && prev.zoomLevel === next.zoomLevel);

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
                <span style={{ color: '#ffffff', fontWeight: 600 }}>{m.nome}</span>
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
    // mapa dinamicamente importado para prevenir que falhas no build do pacote quebrem o app
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
        try { googleQuotaExceededRef.current = true; } catch (e) { }
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
                        <button onClick={() => { try { window.location.href = '/motorista'; } catch (e) { } }} style={{ padding: '14px 20px', borderRadius: '10px', border: 'none', background: '#10b981', color: '#000', cursor: 'pointer', fontWeight: 800 }}>ABRIR APLICATIVO V10</button>
                        <button onClick={() => { try { window.location.href = '/'; } catch (e) { } }} style={{ padding: '14px 20px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.06)', background: 'transparent', color: '#fff', cursor: 'pointer', fontWeight: 700 }}>VOLTAR AO SITE</button>
                    </div>
                </div>
            </div>
        );
    }

    // Estados do Supabase
    const [entregas, setEntregas] = useState([]);
    const [pedidosPendentes, setPedidosPendentes] = useState([]);
    const [frota, setFrota] = useState([]); // agora vem de `motoristas`
    const [totalEntregas, setTotalEntregas] = useState(0);
    const [avisos, setAvisos] = useState([]);
    const [rotaAtiva, setRotaAtiva] = useState([]);
    const [motoristaDaRota, setMotoristaDaRota] = useState(null);
    const [mapCleared, setMapCleared] = useState(false);

    const carregarDados = React.useCallback(async (opts = {}) => {
        const forceAll = opts && opts.forceAll === true;
        // Ensure any previous frontend clear is undone so pins show
        try { setMapCleared(false); } catch (e) { }
        // MapaLogistica controls showPins via clearMap prop
        try { console.log('🔄 Recarregando pins do banco...' + (forceAll ? ' (forceAll)' : '')); } catch (e) { }

        // Fetch control refs to avoid concurrent fetches
        if (fetchInProgressRef.current) return;
        fetchInProgressRef.current = true;
        setLoadingFrota(true);

        try {
            let q = supabase.from('motoristas').select('*');
            if (q && typeof q.order === 'function') q = q.order('id');
            const { data: motoristas, error: motorErr } = await q;
            if (motorErr) {
                console.warn('carregarDados: erro ao buscar motoristas', motorErr);
                scheduleRetry(5000);
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
                if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
                try { retryCountRef.current = 0; } catch (err) { }
            }
        } catch (e) {
            console.warn('Erro carregando motoristas:', e);
            scheduleRetry(5000);
            setFrota(prev => prev && prev.length ? prev : (lastFrotaRef.current || []));
        } finally {
            fetchInProgressRef.current = false;
            setLoadingFrota(false);
        }

        try {
            // Build active-route filter: pending/em_rota OR completed/failure within threshold OR tracked IDs from session
            const now = new Date();
            // when forceAll requested, limit to last 12 hours to avoid old history; otherwise use start of day
            const threshold = forceAll ? new Date(now.getTime() - (12 * 60 * 60 * 1000)) : new Date(now.setHours(0, 0, 0, 0));
            const isoThreshold = threshold.toISOString();
            let trackedIds = [];
            try {
                const raw = typeof window !== 'undefined' ? window.sessionStorage.getItem('v10_tracked_entregas') : null;
                if (raw) {
                    const parsed = JSON.parse(raw);
                    if (Array.isArray(parsed)) trackedIds = parsed.map(x => String(x)).filter(Boolean);
                }
            } catch (e) { trackedIds = []; }

            const orParts = [];
            // Always include recent completed/failed (threshold)
            orParts.push(`created_at.gte.${isoThreshold}`);
            // Always include current active statuses
            orParts.push('status.in.(pendente,em_rota)');
            // Include tracked IDs if present (session memory)
            if (trackedIds && trackedIds.length > 0) {
                // join ids as comma-separated (no quotes)
                orParts.push(`id.in.(${trackedIds.join(',')})`);
            }

            const orString = orParts.join(',');

            // Only clear pending UI list when not forcing a full reload
            if (!forceAll) { try { setPedidosPendentes([]); } catch (e) { } }

            let q = supabase.from('entregas').select('*');
            // Exclude archived entries from any load
            if (q && typeof q.not === 'function') q = q.not('status', 'eq', 'arquivado');
            if (orString && typeof q.or === 'function') q = q.or(orString);
            if (q && typeof q.order === 'function') q = q.order('ordem_logistica', { ascending: true });
            const { data: entregasPend, error: entregasErr } = await q;
            if (entregasErr) {
                console.warn('carregarDados: erro ao buscar entregas', entregasErr);
                setPedidosPendentes([]);
            } else {
                const list = entregasPend || [];
                const sorted = Array.isArray(list) ? list.slice().sort((a, b) => (Number(a.ordem_logistica) || 0) - (Number(b.ordem_logistica) || 0)) : list;
                setPedidosPendentes(sorted);
                try { retryCountRef.current = 0; } catch (e) { }
                if (!sorted || (Array.isArray(sorted) && sorted.length === 0)) {
                    console.warn('carregarDados: busca retornou zero entregas (pedidosPendentes vazio)');
                }
                // Persist tracked IDs for session memory
                try {
                    if (typeof window !== 'undefined' && window.sessionStorage) {
                        const idsToStore = (sorted || []).map(s => s && s.id).filter(Boolean);
                        window.sessionStorage.setItem('v10_tracked_entregas', JSON.stringify(idsToStore));
                    }
                } catch (e) { }
            }
        } catch (e) {
            console.warn('Erro carregando entregas:', e);
            setPedidosPendentes(prev => (prev && prev.length) ? prev : []);
            scheduleRetry(5000);
        }

        try {
            // Limit runtime polyline assembly to today's/active/tracked entregas to avoid loading old history
            const todayStart_forPoly = new Date();
            todayStart_forPoly.setHours(0, 0, 0, 0);
            const isoToday_forPoly = todayStart_forPoly.toISOString();
            let trackedIds_forPoly = [];
            try {
                const raw = typeof window !== 'undefined' ? window.sessionStorage.getItem('v10_tracked_entregas') : null;
                if (raw) {
                    const parsed = JSON.parse(raw);
                    if (Array.isArray(parsed)) trackedIds_forPoly = parsed.map(x => String(x)).filter(Boolean);
                }
            } catch (e) { trackedIds_forPoly = []; }

            const orPartsPoly = [];
            orPartsPoly.push(`created_at.gte.${isoToday_forPoly}`);
            orPartsPoly.push('status.in.(pendente,em_rota)');
            if (trackedIds_forPoly && trackedIds_forPoly.length > 0) orPartsPoly.push(`id.in.(${trackedIds_forPoly.join(',')})`);
            const orStringPoly = orPartsPoly.join(',');

            let q2 = supabase.from('entregas').select('*');
            // Exclude archived entries
            if (q2 && typeof q2.not === 'function') q2 = q2.not('status', 'eq', 'arquivado');
            if (orStringPoly && typeof q2.or === 'function') q2 = q2.or(orStringPoly);
            const { data: todas } = await q2;
            setTotalEntregas((todas || []).length);
            setEntregas(Array.isArray(todas) ? todas : (todas || []));
            try {
                const polyMap = {};
                if (Array.isArray(todas)) {
                    for (const e of todas) {
                        try {
                            if (!e) continue;
                            const mid = e.motorista_id != null ? String(e.motorista_id) : null;
                            if (!mid) continue;
                            const rp = e.rota_polyline || e.rota_polyline_raw || null;
                            if (!rp) continue;
                            let geom = null;
                            if (typeof rp === 'string') {
                                try { geom = JSON.parse(rp); } catch (err) { geom = null; }
                            } else if (typeof rp === 'object') geom = rp;
                            if (geom && Array.isArray(geom.coordinates) && geom.coordinates.length > 0) {
                                const coordsLatLng = geom.coordinates.map(c => [Number(c[1]), Number(c[0])]);
                                polyMap[mid] = coordsLatLng;
                            }
                        } catch (err) { }
                    }
                }
                // Replace runtime polylines with freshly assembled map (do not merge stale entries)
                if (Object.keys(polyMap).length > 0) setRuntimePolylines(polyMap); else setRuntimePolylines({});
            } catch (err) { }
        } catch (e) {
            console.warn('Erro contando entregas:', e);
            scheduleRetry(5000);
        }

        try {
            let q3 = supabase.from('avisos_gestor').select('titulo, mensagem, created_at');
            if (q3 && typeof q3.order === 'function') q3 = q3.order('created_at', { ascending: false });
            if (q3 && typeof q3.limit === 'function') q3 = q3.limit(10);
            const { data: avisosData, error: avisosErr } = await q3;
            if (avisosErr) { console.warn('carregarDados: erro ao buscar avisos', avisosErr); setAvisos([]); } else setAvisos(avisosData || []);
        } catch (e) { console.warn('Erro carregando avisos:', e); setAvisos([]); }

        // carregamento de configuracoes do gestor removido (v149 rollback)

        try {
            function normalizeAddr(s) {
                if (!s) return '';
                try {
                    return String(s)
                        .normalize('NFD')
                        .replace(/\p{Diacritic}/gu, '')
                        .replace(/[.(),;:\/\\#\-]/g, ' ')
                        .replace(/\s+/g, ' ')
                        .trim()
                        .toLowerCase();
                } catch (e) {
                    return String(s).toLowerCase();
                }
            }

            let q5 = supabase.from('entregas').select('cliente,endereco,created_at');
            // Include entries of all statuses (do not filter by 'arquivado')
            // Order by most recent first
            if (q5 && typeof q5.order === 'function') q5 = q5.order('created_at', { ascending: false });
            if (q5 && typeof q5.limit === 'function') q5 = q5.limit(500);
            const { data: recent, error: recentErr } = await q5;
            if (recentErr) {
                console.warn('carregarDados: erro ao buscar histórico', recentErr);
                setRecentList([]);
            } else if (recent && Array.isArray(recent)) {
                const seen = new Set();
                const unique = [];
                for (const r of recent) {
                    try {
                        const addrKey = normalizeAddr(r.endereco || '');
                        if (!addrKey) continue;
                        if (seen.has(addrKey)) continue; // keep first (most recent)
                        seen.add(addrKey);
                        unique.push({ cliente: r.cliente || '', endereco: r.endereco || '' });
                    } catch (err) { /* ignore row error */ }
                }
                setRecentList(unique);
            } else {
                setRecentList([]);
            }
        } catch (e) { console.warn('Erro carregando histórico de entregas:', e); setRecentList([]); scheduleRetry(5000); }
        setLoadingFrota(false);
    }, []);

    async function limparMarcadores() {
        try {
            const ok = window.confirm('Deseja arquivar esta rota? Os pontos concluídos não aparecerão mais no mapa.');
            if (!ok) return;

            // Determine which entregas on screen should be archived (only concluído/entregue/falha)
            try {
                const toArchive = (pedidosPendentes || []).filter(p => {
                    const s = String(p && p.status || '').trim().toLowerCase();
                    return s === 'entregue' || s === 'concluido' || s === 'falha';
                }).map(p => p.id).filter(Boolean);

                if (toArchive.length > 0 && HAS_SUPABASE_CREDENTIALS) {
                    try {
                        // Persist archive status in DB
                        const { data, error } = await supabase.from('entregas').update({ status: 'arquivado' }).in('id', toArchive);
                        if (error) console.warn('limparMarcadores: erro ao arquivar entregas', error);
                        else {
                            // reflect locally: remove archived from pedidosPendentes and entregas
                            try { setPedidosPendentes(prev => (prev || []).filter(p => !toArchive.includes(p.id))); } catch (e) { }
                            try { setEntregas(prev => (prev || []).filter(p => !toArchive.includes(p.id))); } catch (e) { }
                        }
                    } catch (e) { console.warn('limparMarcadores: exeption ao arquivar', e); }
                }
            } catch (e) { /* ignore per-entry */ }

            // Clear frontend-only visual state: entregas list and pending list (remaining)
            try { setEntregas([]); } catch (e) { }
            try { setPedidosPendentes([]); } catch (e) { }
            // Clear runtime polylines so the route line disappears
            try { setRuntimePolylines({}); } catch (e) { }
            // Ensure map receives the clear flag so it recenters and hides pins
            setMapCleared(true);
        } catch (e) { }
    }
    async function recarregarMapa() {
        try {
            // Reset any visual clear flag and force data reload
            setMapCleared(false);
            await carregarDados();
        } catch (e) { console.warn('recarregarMapa failed', e); }
    }
    const [mapFocusCoords, setMapFocusCoords] = useState(null);

    // Draft preview state: optimized preview order (no draft point)
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
    const [canSendRoute, setCanSendRoute] = useState(false);
    const [canSendMotoristaId, setCanSendMotoristaId] = useState(null);
    const [runtimePolylines, setRuntimePolylines] = useState({});


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
        return () => { try { if (queueCalcTimerRef.current) clearTimeout(queueCalcTimerRef.current); } catch (e) { } };
    }, []);

    // Google Maps integration removed for this project — we rely on Leaflet/Mapbox.
    const [recentList, setRecentList] = useState([]);
    const [user, setUser] = useState(null);
    const [session, setSession] = useState(null);
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

    // Cleanup on unmount for any pending retry
    useEffect(() => {
        return () => { try { if (retryTimerRef.current) clearTimeout(retryTimerRef.current); } catch (e) { } };
    }, []);

    // define map center EARLY to avoid ReferenceError in effects
    const [zoomLevel, setZoomLevel] = useState(13);
    const DEFAULT_MAP_CENTER = { lat: -27.645, lng: -48.648 };
    const [mapCenterState, setMapCenterState] = useState(DEFAULT_MAP_CENTER);
    const [pontoPartida, setPontoPartida] = useState(DEFAULT_MAP_CENTER); // sede/company fallback or dynamic driver origin
    const [gestorLocation, setGestorLocation] = useState('São Paulo, BR');

    // Refs para estabilizar valores usados em callbacks assíncronos
    const pontoPartidaRef = useRef(pontoPartida);
    useEffect(() => { pontoPartidaRef.current = pontoPartida; }, [pontoPartida]);
    const mapCenterRef = useRef(mapCenterState);
    useEffect(() => { mapCenterRef.current = mapCenterState; }, [mapCenterState]);

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

        return () => { try { if (ro && typeof ro.disconnect === 'function') ro.disconnect(); } catch (e) { }; clearTimeout(t); };
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
            carregarDados();
        } catch (e) { /* ignore */ }
    }, [carregarDados]);
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

    function capitalize(s) { return String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1); }

    // Delivery markers: numbered pins with color and small label showing type
    const DeliveryMarkers = React.memo(function DeliveryMarkers({ list = [], mapsLib }) {
        if (!mapsLib || !mapsLib.AdvancedMarker) return null;
        return (list || []).map((p, idx) => {
            const lat = Number(p.lat);
            const lng = Number(p.lng);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
            // Use ordem_logistica exclusively for numbering on the map. If not set (>0) show empty.
            // Use ordem_logistica when available, otherwise fallback to index+1 so pins are always visible
            const num = (p.ordem_logistica != null && Number.isFinite(Number(p.ordem_logistica)) && Number(p.ordem_logistica) > 0) ? String(Number(p.ordem_logistica)) : String(idx + 1);
            const tipo = String(p.tipo || 'Entrega');
            // If ordem_logistica is zero or not set, show fallback index to keep pins visible (temporary)
            const color = colorForType(tipo);
            const MarkerComp = mapsLib.AdvancedMarker;
            return (
                <MarkerComp key={`entrega-${p.id || idx}`} position={{ lat, lng }}>
                    <div style={{ transform: 'translate(-50%,-110%)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <div style={{ backgroundColor: 'rgba(0,0,0,0.75)', color: '#fff', padding: '4px 8px', borderRadius: 12, fontSize: 11, fontWeight: 700, marginBottom: 6, boxShadow: '0 2px 6px rgba(0,0,0,0.25)' }}>{capitalize(tipo)}</div>
                        <div style={{ width: 36, height: 36, borderRadius: '50%', background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 14, boxShadow: '0 4px 10px rgba(0,0,0,0.25)' }}>{String(num)}</div>
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
                            try { setRotaAtiva(newOrdered.map((p, idx) => ({ ...p, ordem: Number(idx + 1), ordem_logistica: Number(idx + 1), motorista_id: motoristaId }))); } catch (e) { }
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
        try {
            if (!motoristaId) return;
            // Prevent concurrent routing operations to avoid resource exhaustion (ERR_INSUFFICIENT_RESOURCES)
            if (routingInProgressRef.current) {
                console.warn('recalcRotaForMotorista: route calculation already in progress; skipping');
                try { setMensagemGeral('Roteamento em andamento — aguarde o término antes de reexecutar.'); } catch (e) { }
                return;
            }
            routingInProgressRef.current = true;

            // v42 EMERGENCY: FORÇAR botão verde imediatamente, antes de qualquer chamada ao Supabase ou Mapbox
            try {
                setCanSendRoute(true);
                setCanSendMotoristaId(motoristaId);
                console.log('BOTÃO HABILITADO MANUALMENTE');
            } catch (e) { console.error('Erro forçando estado do botão (v42):', e); }
            // capture previous distance for audit
            const previousDistanceKm = (typeof estimatedDistanceKm !== 'undefined' && estimatedDistanceKm != null) ? Number(estimatedDistanceKm) : null;
            // Fetch motorista to ensure online and get current lat/lng
            const { data: mdata, error: merr } = await supabase.from('motoristas').select('id,lat,lng,esta_online').eq('id', motoristaId);
            if (merr) { console.warn('recalcRotaForMotorista: erro ao buscar motorista:', merr); return; }
            const motor = mdata && mdata[0] ? mdata[0] : null;
            if (!motor) return;
            if (motor.esta_online !== true) return; // RULE: only online drivers receive routing

            // Determine origin: prefer current driver lat/lng, fallback to sede/mapCenterRef
            let origin = null;
            if (motor.lat != null && motor.lng != null) {
                origin = { lat: Number(motor.lat), lng: Number(motor.lng) };
                // Update pontoPartida to the driver's current location (dynamic)
                try { setPontoPartida(origin); } catch (e) { /* ignore */ }
            } else {
                // fallback to company HQ / mapCenterRef
                const fallback = mapCenterRef.current || DEFAULT_MAP_CENTER;
                origin = (pontoPartidaRef.current && pontoPartidaRef.current.lat != null && pontoPartidaRef.current.lng != null) ? pontoPartidaRef.current : fallback;
                try { setPontoPartida(origin); } catch (e) { /* ignore */ }
            }

            // Fetch remaining deliveries for this motorista
            const { data: remData } = await supabase.from('entregas').select('*').eq('motorista_id', motoristaId).in('status', ['pendente', 'em_rota']).order('ordem_logistica', { ascending: true });
            const remainingForDriver = remData || [];
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
                            const optimizedWithOrder = (cached.optimized || []).map((p, i) => ({ ...p, ordem: Number(i + 1), ordem_logistica: Number(i + 1), motorista_id: motoristaId }));
                            setRotaAtiva(optimizedWithOrder);
                        }
                        try { return; } catch (e) { }
                    } catch (e) { /* ignore cache read issues */ }
                }
            } catch (e) { /* ignore hashing issues */ }

            // Compute optimized order using Nearest Neighbor (Haversine) starting from driver's current GPS position
            try { setDistanceCalculating(true); } catch (e) { }
            // Build clean points array for NN algorithm
            const ptsForNN = (remainingForDriver || []).filter(r => r && r.lat != null && r.lng != null).map(r => ({ ...r, lat: Number(r.lat), lng: Number(r.lng) }));
            let optimized = [];
            try {
                optimized = nearestNeighborRoute({ lat: Number(origin.lat), lng: Number(origin.lng) }, ptsForNN) || [];
                // Safety: cap extremely long optimized arrays
                if (Array.isArray(optimized) && optimized.length > 200) {
                    try { setMensagemGeral('Rota muito longa — processando primeiros 200 pontos para estabilidade.'); } catch (e) { }
                    optimized = optimized.slice(0, 200);
                }

                // v42 EMERGENCY: liberar o botão IMEDIATAMENTE após o cálculo do vizinho mais próximo
                try {
                    setCanSendRoute(true);
                    setCanSendMotoristaId(motoristaId);
                    console.log('BOTÃO HABILITADO MANUALMENTE');
                } catch (e) { /* ignore */ }

            } catch (e) {
                console.warn('recalcRotaForMotorista: nearestNeighborRoute failed, falling back to original heuristic', e);
                // fallback to previous local heuristic
                try { optimized = otimizarRota(mapCenterState || pontoPartida || DEFAULT_MAP_CENTER, remainingForDriver); } catch (e2) { optimized = remainingForDriver.slice(); }
            }
            try { setDistanceCalculating(false); } catch (e) { }

            // Draw on map (include HQ if necessary). Always pass company HQ as the destination to keep base as final point
            const includeHQ = (remainingForDriver.length > Number((typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_ROUTE_CYCLE_LIMIT) || 10));
            // ensure UI shows calculating while we call drawRouteOnMap
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

            // Persist ordem_logistica garantindo sobrescrita por ID (upsert único)
            let newOrderIds = [];
            let allOk = true;
            try {
                if (Array.isArray(optimized) && motoristaId != null) {
                    // Obter geometria de rota via Mapbox Directions (seguindo ruas)
                    let routeGeo = null;
                    try {
                        routeGeo = await getRouteGeometry(origin, optimized, { includeReturnTo: (includeHQ ? (mapCenterState || DEFAULT_MAP_CENTER) : null) });
                        if (routeGeo && routeGeo.distanceMeters) {
                            try { setEstimatedDistanceKm(Number((routeGeo.distanceMeters / 1000).toFixed(1))); } catch (e) { }
                            try { setEstimatedTimeSec(Math.round(routeGeo.durationSec || 0)); } catch (e) { }
                        }
                        // Store runtime polyline for immediate map rendering (v44) without forcing DB write
                        try {
                            if (routeGeo && Array.isArray(routeGeo.coordsLatLng) && routeGeo.coordsLatLng.length > 0) {
                                setRuntimePolylines(prev => ({ ...(prev || {}), [String(motoristaId)]: routeGeo.coordsLatLng }));
                            }
                        } catch (e) { /* ignore runtime polyline set errors */ }
                        // Persist rota_polyline in DB for this motorista's deliveries so column is not null
                        try {
                            if (routeGeo && routeGeo.geometry) {
                                const geomStr = JSON.stringify(routeGeo.geometry);
                                // Update all entregas for this motorista to have the same rota_polyline
                                const { data: updData, error: updErr } = await supabase.from('entregas').update({ rota_polyline: geomStr }).eq('motorista_id', motoristaId);
                                if (updErr) {
                                    console.error('recalcRotaForMotorista: falha ao gravar rota_polyline no Supabase', updErr);
                                } else {
                                    console.log('recalcRotaForMotorista: rota_polyline atualizada para entregas do motorista', motoristaId, (updData || []).length);
                                    try { await carregarDados(); } catch (e) { /* non-blocking refresh */ }
                                }
                            }
                        } catch (e) { console.error('recalcRotaForMotorista: exceção ao persistir rota_polyline', e); }
                    } catch (e) { console.error('Erro obtendo geometria de rota (Mapbox):', e); routeGeo = null; }
                    // Construir array de updates conforme v34
                    const updates = (optimized || []).map((item, i) => {
                        const rawId = item && item.id;
                        const coercedId = (typeof rawId === 'string' && /^\d+$/.test(rawId)) ? Number(rawId) : rawId;
                        const lat = (item && item.lat != null) ? Number(item.lat) : null;
                        const lng = (item && item.lng != null) ? Number(item.lng) : null;
                        // v44: enviar apenas campos seguros ao upsert para evitar 400
                        const base = { id: coercedId, ordem_logistica: parseInt(Number(i + 1), 10) };
                        if (lat != null && !Number.isNaN(lat)) base.lat = lat;
                        if (lng != null && !Number.isNaN(lng)) base.lng = lng;
                        return base;
                    }).filter(u => u.id !== undefined && u.id !== null);
                    if (updates.length > 0) {
                        try {
                            // v44: usar upsert com payload restrito (id, ordem_logistica, lat, lng)
                            try {
                                // v50: use individual .update() calls to avoid GENERATED ALWAYS id conflicts
                                const toUpdate = updates.map(u => ({ id: u.id, ordem_logistica: u.ordem_logistica }));
                                const promises = toUpdate.map(item => {
                                    const id = item.id;
                                    const ord = Number(item.ordem_logistica);
                                    if (id === undefined || id === null) return Promise.resolve({ data: null, error: null, skipped: true });
                                    return supabase.from('entregas').update({ ordem_logistica: ord }).eq('id', id);
                                });
                                const results = await Promise.all(promises);
                                // analyze results
                                let anyError = false;
                                for (const r of results) {
                                    if (!r) continue;
                                    if (r.error) {
                                        anyError = true;
                                        console.error('recalcRotaForMotorista: update error', r.error);
                                    }
                                }
                                if (anyError) {
                                    allOk = false;
                                    try { setMensagemGeral('Falha ao atualizar ordem_logistica (v50). Verifique logs.'); } catch (e) { }
                                } else {
                                    allOk = true;
                                    newOrderIds = toUpdate.map(d => d && d.id).filter(Boolean);
                                    try { await carregarDados(); } catch (err) { /* non-blocking */ }
                                }
                            } catch (err) {
                                allOk = false;
                                console.error('recalcRotaForMotorista: exceção on updates (v50)', err);
                            }
                        } catch (err) {
                            allOk = false;
                            console.error('recalcRotaForMotorista: exceção no bloco de persistência (v44)', err);
                        }
                    }
                }
            } catch (e) { console.warn('recalcRotaForMotorista: erro persistindo ordem_logistica (v34)', e); allOk = false; }

            // LIBERAÇÃO IMEDIATA: permita envio apenas se a persistência ocorreu com sucesso
            // Nota: não alteramos `canSendRoute` aqui para evitar sobrescrita indesejada — o botão
            // já foi liberado após a otimização (v41). Persistência falha não deve bloquear a ação manual.

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
                const optimizedWithOrder = (optimized || []).map((p, i) => ({ ...p, ordem: Number(i + 1), ordem_logistica: Number(i + 1), motorista_id: motoristaId }));
                setRotaAtiva(optimizedWithOrder);
                const foundDriver = (frota || []).find(m => String(m.id) === String(motoristaId));
                if (foundDriver) setMotoristaDaRota(foundDriver);
                // ensure visual feedback: set distance/time from draw result if available
                try {
                    if (drawResult && drawResult.meters) setEstimatedDistanceKm(Number((drawResult.meters / 1000).toFixed(1)));
                    if (drawResult && drawResult.secs) setEstimatedTimeSec(drawResult.secs);
                } catch (e) { /* ignore */ }
            } catch (err) { console.warn('recalcRotaForMotorista: falha ao atualizar UI com rota otimizada', err); }

            // v42: Forçar liberação do botão ao final do processamento (não limpar automaticamente em outros efeitos)
            try {
                setCanSendRoute(true);
                setCanSendMotoristaId(motoristaId);
                console.log('!!! BOTÃO DESTRANCADO COM SUCESSO !!!');
            } catch (e) { /* ignore */ }

            // Update UI state immediately so dashboard shows new order and motorista app can pick it via realtime DB changes
            try {
                const optimizedWithOrder = (optimized || []).map((p, i) => ({ ...p, ordem: Number(i + 1), ordem_logistica: Number(i + 1), motorista_id: motoristaId }));
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
            // release routing lock with a slightly longer grace period to avoid repeated retriggers (v51)
            try { setTimeout(() => { routingInProgressRef.current = false; }, 2000); } catch (e) { routingInProgressRef.current = false; }
            // ensure we always remove this motorista from pending set (defensive cleanup)
            try { if (motoristaId) { pendingRecalcRef.current.delete(String(motoristaId)); setPendingRecalcCount(pendingRecalcRef.current.size); } } catch (e) { }
        }
    }, []);

    // Fetch last 3 logs for a given motorista
    async function fetchLogsForMotorista(motoristaId) {
        try {
            if (!motoristaId) { setLogsHistory([]); return; }
            const { data, error } = await supabase.from('logs_roteirizacao').select('*').eq('motorista_id', motoristaId).order('created_at', { ascending: false }).limit(3);
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
                    const st = String(rec.status || '').trim().toLowerCase();
                    if (payload.event === 'INSERT' || (st === 'pendente' || st === 'em_rota' || st === 'recolha')) {
                        // Auto-trigger recalculation for driver's route using Nearest Neighbor.
                        try {
                            const mid = String(rec.motorista_id);
                            if (!pendingRecalcRef.current.has(mid)) {
                                pendingRecalcRef.current.add(mid);
                                try { setPendingRecalcCount(pendingRecalcRef.current.size); } catch (e) { }
                                // run async recalculation but keep track in pending set to avoid duplicates
                                (async () => {
                                    try {
                                        await recalcRotaForMotorista(mid);
                                    } catch (e) {
                                        console.warn('Auto recalcRotaForMotorista failed for', mid, e);
                                    } finally {
                                        try { pendingRecalcRef.current.delete(mid); setPendingRecalcCount(pendingRecalcRef.current.size); } catch (e) { }
                                    }
                                })();
                            }
                        } catch (e) { /* ignore */ }
                    }
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
    }, [recalcRotaForMotorista]);

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

    const adicionarAosPendentes = async (e) => {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        if (adicionando) return; // already saving, ignore duplicate clicks
        setAdicionando(true);

        try {
            // Require numeric street number before attempting save
            const hasNumber = /\d/.test(String(enderecoEntrega || ''));
            if (!hasNumber) {
                alert('O endereço precisa conter um número (ex: Rua, 123).');
                return;
            }

            const clienteTrim = String(nomeCliente || '').trim();
            const enderecoTrim = String(enderecoEntrega || '').trim();

            // DUPLICITY RULE (v101): check existing pending delivery for same endereco
            try {
                const { data: existing, error: dupErr } = await supabase
                    .from('entregas')
                    .select('id, tipo, endereco')
                    .ilike('endereco', enderecoTrim)
                    .eq('status', 'pendente')
                    .limit(1);
                if (dupErr) {
                    console.warn('Erro ao checar duplicidade por endereco:', dupErr);
                } else if (Array.isArray(existing) && existing.length > 0) {
                    const existingTipo = String(existing[0].tipo || 'Entrega').trim();
                    const selectedTipo = String(tipoEncomenda || 'Entrega').trim();
                    if (existingTipo.toLowerCase() === selectedTipo.toLowerCase()) {
                        alert(`⚠️ Já existe uma ${selectedTipo} pendente para este endereço. Caso seja um novo serviço, altere o Tipo (ex: Recolha).`);
                        return;
                    }
                    // different tipo => allow save
                }
            } catch (dupCheckErr) {
                console.warn('Erro na verificação de duplicidade por endereco:', dupCheckErr);
            }

            // Try geocoding with timeout (non-blocking guard). If geocode fails, we still save.
            let coords = null;
            try {
                const geocodePromise = geocodeMapbox && typeof geocodeMapbox === 'function' ? geocodeMapbox(enderecoTrim) : null;
                const res = await Promise.race([
                    geocodePromise || Promise.resolve(null),
                    new Promise(r => setTimeout(() => r(null), 1200))
                ]);
                if (res && res.lat != null && res.lng != null) coords = { lat: Number(res.lat), lng: Number(res.lng) };
            } catch (err) {
                coords = null;
            }

            const payload = {
                cliente: clienteTrim,
                endereco: enderecoTrim,
                status: 'pendente',
                tipo: tipoEncomenda || 'Entrega',
                obs: observacoesGestor || ''
            };
            payload.lat = (coords && Number.isFinite(Number(coords.lat))) ? Number(coords.lat) : 0;
            payload.lng = (coords && Number.isFinite(Number(coords.lng))) ? Number(coords.lng) : 0;

            const { error } = await supabase.from('entregas').insert([payload]);
            if (error) {
                console.error('Erro ao salvar no banco:', error);
                alert('Erro ao salvar no banco: ' + (error.message || String(error)));
                return;
            }

            // Clear fields immediately after success and focus Nome do Cliente
            setNomeCliente('');
            setEnderecoEntrega('');
            setObservacoesGestor('');
            setEnderecoGeocodeNotFound(!coords);
            try { clienteInputRef && clienteInputRef.current && typeof clienteInputRef.current.focus === 'function' && clienteInputRef.current.focus(); } catch (e) { /* ignore */ }

            // center map on newly added carga when coords available
            try { if (coords && Number.isFinite(Number(coords.lat)) && Number.isFinite(Number(coords.lng))) setMapFocusCoords({ lat: Number(coords.lat), lng: Number(coords.lng) }); } catch (e) { }

            try { await carregarDados(); } catch (e) { /* ignore */ }

            if (!coords) {
                try { alert('Carga adicionada — coordenadas não encontradas (marcada como pendente para correção).'); } catch (e) { }
            } else {
                try { alert('Carga adicionada com sucesso!'); } catch (e) { }
            }
        } catch (err) {
            console.error(err);
        } finally {
            setAdicionando(false);
        }
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
                            // usuário cancelou: abrir modal para seleção manual
                            setShowDriverSelect(true);
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
                try { setDistanceCalculating(true); } catch (e) { }
                rotaOtimizada = await otimizarRotaComGoogle(mapCenterState, pedidosPendentes, motoristaIdVal);
                try { setDistanceCalculating(false); } catch (e) { }
                if (!rotaOtimizada || rotaOtimizada.length === 0) rotaOtimizada = otimizarRota(mapCenterState, pedidosPendentes);
            } catch (e) {
                // fallback para algoritmo local em caso de erro com Google API
                rotaOtimizada = otimizarRota(mapCenterState, pedidosPendentes);
            }
            // Validate motorista exists in local `frota` to avoid sending wrong id
            const motoristaExists = frota && frota.find ? frota.find(m => String(m.id) === String(motoristaIdVal)) : null;
            if (!motoristaExists) console.warn('assignDriver: motorista_id não encontrado na frota local', motoristaIdVal);
            // status para despacho: enviar como 'em_rota' para remover da Central
            const statusValue = String('em_rota').trim().toLowerCase();

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
                        const payload = { motorista_id: motoristaIdVal, status: statusValue, ordem_logistica: Number(idx + 1) };
                        return supabase.from('entregas').update(payload).eq('id', pid);
                    });
                    const results = await Promise.all(promises);
                    // detect any errors
                    for (const r of results) {
                        if (!r) continue;
                        if (r.error) { updErr = r.error; console.error('assignDriver: update error', r.error); break; }
                    }

                    if (!updErr) {
                        // Force refresh: ensure DB is reloaded and pending list cleared so Central fica limpa
                        try { await carregarDados(); } catch (e) { /* ignore */ }
                        try { setPedidosPendentes([]); } catch (e) { /* ignore */ }
                        try { routingInProgressRef.current = false; } catch (e) { /* ignore */ }
                        setShowDriverSelect(false);
                        setSelectedMotorista(null);
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
            try { await recalcRotaForMotorista(String(motoristaIdVal)); } catch (e) { console.warn('Falha ao recalcular rota após assignDriver:', e); }
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
    // Use explicit aprovado boolean to split lists
    const motoristasAtivos = (frota || []).filter(m => m && m.aprovado === true);
    const motoristasPendentes = (frota || []).filter(m => m && m.aprovado === false);

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
            // mark that the route for this motorista is ready to be sent
            try { setCanSendMotoristaId(String(m.id)); } catch (e) { }
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

    // Debug visual removido para evitar logs repetitivos

    // Fallback de render: se supabase não estiver inicializado, não tente renderizar o dashboard completo
    try {
        if (!supabase) {
            return <div style={{ padding: 18 }}>Carregando...</div>;
        }
    } catch (e) { /* ignore */ }

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
                        <div style={{ opacity: 0.6 }}>Contato: 5548996525008</div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <button onClick={() => setDarkMode(d => !d)} style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)', background: 'transparent', color: theme.headerText, cursor: 'pointer' }}>{darkMode ? 'Modo Claro' : 'Modo Escuro'}</button>
                        <div style={{ color: theme.headerText, fontWeight: 700, marginLeft: '8px' }}>Gestor: Administrador</div>
                    </div>
                </div>
            </header>

            {/* Google quota banner removed (project uses Mapbox/Leaflet) */}

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
                                {
                                    // Render Leaflet-based map via MapaLogistica (no Google API dependencies)
                                    (
                                        <ErrorBoundary>
                                            <MapaLogistica clearMap={mapCleared} entregas={mapCleared ? [] : pedidosPendentes} frota={frota} height={500} mobile={false} focusCoords={mapFocusCoords} motoristaDaRota={motoristaDaRota} runtimePolylines={runtimePolylines} />
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
                                <button onClick={() => carregarDados({ forceAll: true })} style={{ padding: '10px', background: '#0b6b4a', color: '#fff', borderRadius: 10, border: '1px solid rgba(0,0,0,0.12)', cursor: 'pointer', fontWeight: 800 }} title="Recarregar Mapa">🔄 Recarregar Mapa</button>
                            </div>
                            <h3 style={{ marginTop: 20, color: theme.textMain }}>Status da Operação</h3>
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
                                <input ref={clienteInputRef} name="cliente" placeholder="Nome do Cliente" style={{ ...inputStyle, width: '95% !important', boxSizing: 'border-box' }} required value={nomeCliente} onChange={(e) => setNomeCliente(e.target.value)} />
                                <div style={{ position: 'relative' }}>
                                    <div style={{ width: '93% !important', boxSizing: 'border-box' }}>
                                        <input
                                            type="text"
                                            name="endereco"
                                            placeholder="Ex: Rua Lauro Bechtold, 147, Centro - Palhoça"
                                            value={enderecoEntrega}
                                            onChange={(e) => { setEnderecoEntrega(e.target.value); setEnderecoGeocodeNotFound(false); }}
                                            className="v10-mapbox-search-input"
                                            style={{ padding: '10px', borderRadius: '8px', border: inputEnderecoInvalid ? '1px solid #ef4444' : '1px solid #cbd5e1', width: '100%', boxSizing: 'border-box' }}
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
                        <div style={{ flex: '0 0 52%', background: theme.card, padding: '18px', borderRadius: '12px', boxShadow: theme.shadow, display: 'flex', flexDirection: 'column' }}>
                            <h3 style={{ marginTop: 0, color: theme.textMain }}>Histórico de Clientes</h3>
                            <div style={{ marginBottom: '8px', color: theme.textLight, fontSize: '13px' }}>Clique para preencher o formulário à esquerda</div>
                            <div style={{ overflowY: 'auto', maxHeight: '420px', paddingRight: '6px' }}>
                                {(!recentList || recentList.length === 0) ? (
                                    <div style={{ color: theme.textLight, padding: '12px' }}>Nenhum histórico disponível.</div>
                                ) : (
                                    recentList?.map((it, idx) => (
                                        <div key={idx} onClick={async () => {
                                            try {
                                                setNomeCliente(it.cliente || '');
                                                setEnderecoEntrega(it.endereco || '');
                                            } catch (e) { }
                                            // historico click: apenas preencher cliente e endereço (sem coordenadas)
                                        }} style={{ padding: '12px', borderRadius: '10px', marginBottom: '8px', cursor: 'pointer', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.03)' }}>
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
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <div style={{ color: theme.textLight, fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <div>Distância Estimada: <span style={{ color: theme.primary }}>{(estimatedDistanceKm != null && estimatedTimeText != null) ? `${estimatedDistanceKm} KM | ${estimatedTimeText}` : (distanceCalculating ? 'Calculando...' : 'Calculando...')}</span></div>
                                    <button title="Histórico de otimizações" onClick={() => setShowLogsPopover(s => !s)} style={{ background: 'transparent', border: 'none', color: theme.textLight, cursor: 'pointer', fontSize: '16px' }}>📜</button>
                                    {showLogsPopover && (
                                        <div style={{ position: 'absolute', right: '32px', top: '120px', background: theme.card, color: theme.textMain, padding: '10px', borderRadius: '8px', boxShadow: theme.shadow, width: '320px', zIndex: 2200 }}>
                                            <div style={{ fontWeight: 700, marginBottom: '8px' }}>Últimas otimizações</div>
                                            {logsHistory?.length === 0 ? <div style={{ color: theme.textLight }}>Nenhum registro recente.</div> : (
                                                logsHistory?.map((l, i) => (
                                                    <div key={i} style={{ padding: '6px 0', borderBottom: i < (logsHistory?.length || 0) - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
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
                                    {(() => {
                                        const enviarEnabled = Boolean(canSendRoute);
                                        const onEnviarClick = async () => {
                                            if (!enviarEnabled) return;
                                            try {
                                                // if we have a prepared motorista id, send directly to that motorista
                                                if (canSendMotoristaId) {
                                                    const drv = (frota || []).find(x => String(x.id) === String(canSendMotoristaId));
                                                    if (drv) {
                                                        await assignDriver(drv);
                                                        try { setCanSendMotoristaId(null); } catch (e) { }
                                                        return;
                                                    }
                                                }
                                            } catch (e) { /* ignore and fallback to modal */ }
                                            setDriverSelectMode('dispatch'); setShowDriverSelect(true);
                                        };
                                        return (
                                            <button disabled={!canSendRoute} onClick={onEnviarClick} style={{ backgroundColor: canSendRoute ? '#28a745' : '#6c757d', opacity: 1, cursor: 'pointer' }}>ENVIAR ROTA</button>
                                        );
                                    })()}
                                </div>
                            </div>
                        </div>
                        {(!pedidosPendentes || pedidosPendentes.length === 0) ? <p style={{ textAlign: 'center', color: theme.textLight }}>Tudo limpo! Sem pendências.</p> : (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px' }}>
                                {pedidosPendentes?.filter(e => String(e.status || '').trim().toLowerCase() === 'pendente').map(p => {
                                    const tipo = p.tipo || 'Entrega';
                                    const tipoColor = getColorForType(tipo);
                                    const contrast = getContrastText(tipoColor);
                                    return (
                                        <div key={p.id} style={{ border: `1px solid ${tipoColor}`, padding: '20px', borderRadius: '12px', borderLeft: `6px solid ${tipoColor}`, background: theme.card }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <h4 style={{ margin: '0 0 5px 0' }}>{p.cliente}</h4>
                                                <span style={{ fontSize: '12px', padding: '6px 10px', borderRadius: '12px', background: tipoColor, color: contrast, fontWeight: 700 }}>{tipo}</span>
                                            </div>
                                            <p style={{ fontSize: '13px', color: theme.textLight, margin: '4px 0' }}>{p.endereco} {(!(p.lat && p.lng)) && <span title="Sem coordenadas: não participará da roteirização automática" style={{ color: '#f59e0b', marginLeft: 8 }}>⚠️ Sem coords</span>}</p>
                                            <p style={{ fontSize: '13px', color: theme.textLight, margin: '4px 0' }}><strong>Obs:</strong> Sem observações</p>
                                            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                                                <button onClick={() => excluirPedido(p.id)} style={{ background: 'none', border: 'none', color: theme.danger, cursor: 'pointer', fontSize: '12px' }}>Remover</button>
                                                {(p.lat && p.lng) ? (
                                                    <button onClick={() => { try { window.open('https://www.google.com/maps/search/?api=1&query=' + Number(p.lat) + ',' + Number(p.lng), '_blank', 'noopener'); } catch (e) { } }} style={{ background: '#0ea5e9', border: 'none', color: '#fff', padding: '6px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>Navegar</button>
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
                                        <tr key={m.id} onClick={() => setSelectedMotorista(m)} style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }}>
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

    // estado do botão gerenciado exclusivamente em recalcRotaForMotorista (true) ou logout do motorista (false)
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
                        online?.map(m => (
                            <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 8px', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                                <div style={{ flex: 1 }}>
                                    <button disabled={loading} onClick={() => handleSelect(m)} style={{ background: 'transparent', border: 'none', textAlign: 'left', cursor: loading ? 'wait' : 'pointer', padding: 0 }}>
                                        <div style={{ fontWeight: 700, color: '#ffffff' }}>{m.nome}</div>
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