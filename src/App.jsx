import React, { useState, useEffect, useRef } from 'react';
import { GoogleMap, InfoWindow } from '@react-google-maps/api';
import supabase, { subscribeToTable, isMock } from './supabaseClient';

// --- CONFIGURAÇÃO VISUAL ---
// Google Maps helpers
const GOOGLE_MAPS_API_KEY = (typeof import.meta !== 'undefined' && import.meta.env) ? (import.meta.env.VITE_GOOGLE_MAPS_KEY || 'AIzaSyBeec8r4DWBdNIEFSEZg1CgRxIHjYMV9dM') : 'AIzaSyBeec8r4DWBdNIEFSEZg1CgRxIHjYMV9dM';

function numberedIconUrl(number) {
    const n = number || '';
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='36' height='36'><circle cx='18' cy='18' r='18' fill='%232563eb' stroke='%23fff' stroke-width='3'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-size='16' fill='%23fff' font-family='Arial' font-weight='800'>${n}</text></svg>`;
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

const motoristaIconUrl = 'http://maps.google.com/mapfiles/ms/icons/blue-dot.png';

function motoristaIconUrlFor(heading = 0) {
    // simple truck / arrow SVG rotated by `heading` degrees around center
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 40 40'>
        <g transform='translate(20 20) rotate(${heading})'>
            <rect x='-10' y='-8' width='20' height='12' rx='3' fill='%232563eb' stroke='%23fff' stroke-width='1'/>
            <polygon points='10,-5 16,0 10,5' fill='%232563eb' />
            <circle cx='-6' cy='6' r='3' fill='%23000' />
            <circle cx='6' cy='6' r='3' fill='%23000' />
        </g>
    </svg>`;
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

// AdvancedMarker helper: uses google.maps.marker.AdvancedMarkerElement to avoid deprecation warnings
function AdvancedMarker({ map, position, iconUrl, onClick }) {
    const localRef = useRef(null);
    useEffect(() => {
        // Guard: ensure map instance and Google Maps API are ready before creating AdvancedMarker
        if (!map || !window.google || !window.google.maps || !map.getDiv || !window.google.maps.marker) return;
        const container = document.createElement('div');
        container.style.display = 'inline-block';
        container.style.transform = 'translate(-50%, -50%)';
        const img = document.createElement('img');
        img.src = iconUrl;
        img.style.width = '40px';
        img.style.height = '40px';
        img.style.pointerEvents = 'auto';
        img.draggable = false;
        container.appendChild(img);
        const adv = new window.google.maps.marker.AdvancedMarkerElement({ map, position, element: container });
        if (onClick) adv.addListener('click', onClick);
        localRef.current = adv;
        return () => {
            try { if (localRef.current) { localRef.current.map = null; localRef.current.element && localRef.current.element.remove(); } } catch (e) { }
        };
    }, [map, position && position.lat, position && position.lng, iconUrl]);
    return null;
}

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
const NEW_LOAD_STATUS = 'Aguardando';

// --- LÓGICA (NÃO MEXEMOS EM NADA AQUI) ---

const otimizarRota = (pontoPartida, listaPedidos) => {
    let rotaOrdenada = [];
    let atual = pontoPartida;
    let pendentes = [...listaPedidos];
    while (pendentes.length > 0) {
        let maisProximo = null;
        let menorDistancia = Infinity;
        let indexMaisProximo = -1;
        pendentes.forEach((pedido, index) => {
            const dist = Math.sqrt(Math.pow(pedido.lat - atual[0], 2) + Math.pow(pedido.lng - atual[1], 2));
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
// Retorna a lista de pedidos reordenada conforme waypoint_order
async function otimizarRotaComGoogle(pontoPartida, listaPedidos) {
    if (!listaPedidos || listaPedidos.length === 0) return [];
    if (typeof window === 'undefined' || !window.google || !window.google.maps || !window.google.maps.DirectionsService) {
        throw new Error('Google Maps API não disponível');
    }
    return new Promise((resolve, reject) => {
        try {
            const directionsService = new window.google.maps.DirectionsService();
            const origin = { lat: Number(pontoPartida[0]), lng: Number(pontoPartida[1]) };
            const waypoints = listaPedidos.map(p => ({ location: { lat: Number(p.lat), lng: Number(p.lng) }, stopover: true }));
            const request = {
                origin,
                destination: origin,
                travelMode: window.google.maps.TravelMode.DRIVING,
                waypoints,
                optimizeWaypoints: true
            };
            directionsService.route(request, (result, status) => {
                try {
                    if (status === 'OK' && result && result.routes && result.routes[0]) {
                        const wpOrder = result.routes[0].waypoint_order;
                        if (Array.isArray(wpOrder) && wpOrder.length === waypoints.length) {
                            const ordered = wpOrder.map(i => listaPedidos[i]);
                            resolve(ordered);
                            return;
                        }
                        resolve(listaPedidos);
                        return;
                    }
                    if (status === 'ZERO_RESULTS') {
                        // Sem rota possível, retorna lista original
                        resolve(listaPedidos);
                        return;
                    }
                    // Outros status: fallback conservador
                    console.warn('DirectionsService retornou status:', status);
                    resolve(listaPedidos);
                } catch (e) { resolve(listaPedidos); }
            });
        } catch (e) {
            reject(e);
        }
    });
}

export default function App() {
    const [darkMode, setDarkMode] = useState(true);
    const theme = darkMode ? darkTheme : lightTheme;
    const [abaAtiva, setAbaAtiva] = useState('Visão Geral'); // Mudei o nome pra ficar chique
    const [gestorPosicao, setGestorPosicao] = useState([-23.5505, -46.6333]);

    // Estados do Supabase
    const [pedidosEmEspera, setPedidosEmEspera] = useState([]); // agora vem de `entregas`
    const [frota, setFrota] = useState([]); // agora vem de `motoristas`
    const [totalEntregas, setTotalEntregas] = useState(0);
    const [avisos, setAvisos] = useState([]);
    const [gestorPhone, setGestorPhone] = useState(null);
    const [rotaAtiva, setRotaAtiva] = useState([]);
    const [motoristaDaRota, setMotoristaDaRota] = useState(null);
    const [selectedMotorista, setSelectedMotorista] = useState(null);
    const [showDriverSelect, setShowDriverSelect] = useState(false);
    const [observacoesGestor, setObservacoesGestor] = useState('');
    const [dispatchLoading, setDispatchLoading] = useState(false);
    const [nomeCliente, setNomeCliente] = useState('');
    const [enderecoEntrega, setEnderecoEntrega] = useState('');
    const [recentList, setRecentList] = useState([]);
    const audioRef = useRef(new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3'));

    const mapRef = useRef(null);
    const mapRefUnused = mapRef; // preserve ref usage pattern; no history counters needed
    const [googleLoaded, setGoogleLoaded] = useState(typeof window !== 'undefined' && window.google && window.google.maps ? true : false);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (window.google && window.google.maps) { setGoogleLoaded(true); return; }
        const existing = document.querySelector('script[data-google-maps-api]');
        if (existing) {
            const onLoadExisting = () => setGoogleLoaded(true);
            existing.addEventListener('load', onLoadExisting);
            return () => existing.removeEventListener('load', onLoadExisting);
        }
        const s = document.createElement('script');
        s.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}`;
        s.async = true;
        s.defer = true;
        s.setAttribute('data-google-maps-api', '1');
        // Add loading attribute to hint async loading (per console recommendation)
        try { s.setAttribute('loading', 'async'); } catch (e) { /* ignore if unsupported */ }
        const onLoad = () => setGoogleLoaded(true);
        s.addEventListener('load', onLoad);
        document.head.appendChild(s);
        return () => { s.removeEventListener('load', onLoad); };
    }, []);

    useEffect(() => {
        carregarDados();
        // Geolocalização automática removida para evitar timeouts/permits bloqueados
    }, []);

    // Ordena a rota ativa pelo campo 'ordem' (caixeiro viajante) para visualização
    const orderedRota = rotaAtiva && rotaAtiva.slice ? rotaAtiva.slice().sort((a, b) => (a.ordem || 0) - (b.ordem || 0)) : [];

    // center map on motorista Leandro (id 1) when available, otherwise gestorPosicao
    const motoristaLeandro = frota && frota.find ? frota.find(m => m.id === 1) : null;
    const mapCenter = (motoristaLeandro && motoristaLeandro.lat != null && motoristaLeandro.lng != null)
        ? { lat: motoristaLeandro.lat, lng: motoristaLeandro.lng }
        : { lat: gestorPosicao[0], lng: gestorPosicao[1] };

    async function carregarDados() {
        // motoristas reais
        try {
            const { data: motoristas } = await supabase.from('motoristas').select('*');
            if (motoristas) setFrota(motoristas);
        } catch (e) { console.warn('Erro carregando motoristas:', e); }

        // entregas: novas cargas — filtro rigoroso pela string exata definida em NEW_LOAD_STATUS
        try {
            const { data: entregasPend, error: entregasErr } = await supabase.from('entregas').select('*').eq('status', NEW_LOAD_STATUS);
            if (entregasErr) {
                console.warn('carregarDados: erro ao buscar entregas (filtro de status)', entregasErr);
            } else if (entregasPend) setPedidosEmEspera(entregasPend);
        } catch (e) { console.warn('Erro carregando entregas (filtro de status):', e); }

        // total de entregas
        try {
            const { data: todas } = await supabase.from('entregas').select('*');
            if (todas) setTotalEntregas(todas.length);
        } catch (e) { console.warn('Erro contando entregas:', e); }

        // avisos do gestor
        try {
            const { data: avisosData } = await supabase.from('avisos_gestor').select('titulo, mensagem, created_at').order('created_at', { ascending: false }).limit(10);
            if (avisosData) setAvisos(avisosData);
        } catch (e) { console.warn('Erro carregando avisos:', e); }

        // configuracoes (gestor_phone)
        try {
            const { data: cfg } = await supabase.from('configuracoes').select('valor').eq('chave', 'gestor_phone').limit(1);
            if (cfg && cfg.length > 0) setGestorPhone(cfg[0].valor);
        } catch (e) { /* ignore */ }

        // Histórico recente (clientes únicos) para preencher atalho na Nova Carga
        try {
            const { data: recent } = await supabase.from('entregas').select('cliente,endereco,created_at').order('id', { ascending: false }).limit(200);
            if (recent) {
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
            }
        } catch (e) { console.warn('Erro carregando histórico de entregas:', e); }
    }

    // Realtime: escuta alterações em 'entregas', 'motoristas' e 'avisos_gestor'
    useEffect(() => {
        // If real Supabase client is available, use a single channel named 'custom-filter-channel'
        if (!isMock && supabase && supabase.channel) {
            const channel = supabase.channel('custom-filter-channel');

            channel.on('postgres_changes', { event: '*', schema: 'public', table: 'motoristas' }, (payload) => {
                // update local state directly if record present, parsing lat/lng to numbers
                const rec = payload.record;
                try {
                    if (rec && rec.id) {
                        const parsed = { ...rec };
                        if (parsed.lat != null) {
                            const v = parseFloat(parsed.lat);
                            parsed.lat = isNaN(v) ? null : v;
                        }
                        if (parsed.lng != null) {
                            const v2 = parseFloat(parsed.lng);
                            parsed.lng = isNaN(v2) ? null : v2;
                        }
                        setFrota(prev => {
                            const exists = prev.find(p => p.id === parsed.id);
                            if (exists) return prev.map(p => p.id === parsed.id ? { ...p, ...parsed } : p);
                            return [...prev.filter(p => p.id !== parsed.id), parsed];
                        });
                    }
                } catch (e) {
                    console.warn('Erro processando payload motoristas:', e);
                }
            });

            channel.on('postgres_changes', { event: '*', schema: 'public', table: 'entregas' }, (payload) => {
                try {
                    const rec = payload.record;
                    if (rec && rec.id) {
                        const id = rec.id;
                        // Update local pending deliveries list conservatively without refetching
                        setPedidosEmEspera(prev => {
                            try {
                                if (payload.event === 'DELETE') return prev.filter(p => p.id !== id);
                                // If the record matches our NEW_LOAD_STATUS include/update it, otherwise remove
                                if (rec.status === NEW_LOAD_STATUS) {
                                    const exists = prev.find(p => p.id === id);
                                    if (exists) return prev.map(p => p.id === id ? { ...p, ...rec } : p);
                                    return [...prev, rec];
                                } else {
                                    return prev.filter(p => p.id !== id);
                                }
                            } catch (e) { console.warn('Erro atualizando pedidosEmEspera do payload:', e); return prev; }
                        });

                        // Update rotaAtiva if present
                        setRotaAtiva(prev => {
                            try {
                                const exists = prev.find(p => p.id === id);
                                if (payload.event === 'DELETE') return prev.filter(p => p.id !== id);
                                if (rec.ordem || rec.status === 'em_rota') {
                                    if (exists) return prev.map(p => p.id === id ? { ...p, ...rec } : p);
                                    return [...prev, rec];
                                }
                                return prev;
                            } catch (e) { console.warn('Erro atualizando rotaAtiva do payload:', e); return prev; }
                        });

                        return; // handled via local updates
                    }
                } catch (e) {
                    console.warn('Erro processando payload entregas:', e);
                }
                // Fallback: se payload inválido, re-carrega dados completos
                carregarDados();
            });

            channel.on('postgres_changes', { event: '*', schema: 'public', table: 'avisos_gestor' }, (payload) => {
                carregarDados();
            });

            channel.subscribe();

            return () => {
                try { supabase.removeChannel(channel); } catch (e) { channel.unsubscribe && channel.unsubscribe(); }
            };
        }

        // Fallback: mock polling via helper
        const unsubPedidos = subscribeToTable('entregas', (payload) => { carregarDados(); }, { event: '*', schema: 'public' });
        const unsubFrota = subscribeToTable('motoristas', (payload) => { carregarDados(); }, { event: '*', schema: 'public' });
        const unsubAvisos = subscribeToTable('avisos_gestor', (payload) => { carregarDados(); }, { event: '*', schema: 'public' });

        return () => {
            try { unsubPedidos && unsubPedidos(); } catch (e) { /* ignore */ }
            try { unsubFrota && unsubFrota(); } catch (e) { /* ignore */ }
            try { unsubAvisos && unsubAvisos(); } catch (e) { /* ignore */ }
        };
    }, []);

    // Auto-zoom / fitBounds behavior for Google Map when pontos mudam
    useEffect(() => {
        if (!mapRef.current) return;
        const map = mapRef.current;
        const pontos = [gestorPosicao, ...orderedRota.map(p => [p.lat, p.lng])];
        if (!pontos || pontos.length === 0) return;
        const bounds = new window.google.maps.LatLngBounds();
        pontos.forEach(pt => bounds.extend({ lat: pt[0], lng: pt[1] }));
        try { map.fitBounds(bounds, 60); } catch (e) { /* ignore */ }
    }, [orderedRota, gestorPosicao]);

    const adicionarAosPendentes = async (e) => {
        e.preventDefault();
        const lat = gestorPosicao[0] + (Math.random() - 0.5) * 0.04;
        const lng = gestorPosicao[1] + (Math.random() - 0.5) * 0.04;
        // Preparar observações: enviar null quando vazio para evitar erros de coluna/valores
        const obsValue = (observacoesGestor && String(observacoesGestor).trim().length > 0) ? String(observacoesGestor).trim() : null;
        const clienteVal = (nomeCliente && String(nomeCliente).trim().length > 0) ? String(nomeCliente).trim() : null;
        const enderecoVal = (enderecoEntrega && String(enderecoEntrega).trim().length > 0) ? String(enderecoEntrega).trim() : null;
        if (!clienteVal || !enderecoVal) { alert('Preencha nome do cliente e endereço.'); return; }
        const { error } = await supabase.from('entregas').insert([{
            cliente: clienteVal,
            endereco: enderecoVal,
            tipo: 'Entrega',
            lat: lat,
            lng: lng,
            status: NEW_LOAD_STATUS,
            observacoes: obsValue
        }]);
        if (!error) { alert("✅ Salvo com sucesso!"); setNomeCliente(''); setEnderecoEntrega(''); setObservacoesGestor(''); carregarDados(); }
    };

    const excluirPedido = async (id) => {
        const parsedId = typeof id === 'string' ? parseInt(id, 10) : id;
        if (!parsedId || isNaN(parsedId)) {
            console.warn('excluirPedido: id inválido', id);
            return;
        }
        const { error } = await supabase.from('entregas').delete().eq('id', parsedId);
        if (!error) carregarDados();
    };

    const dispararRota = async () => {
        if (pedidosEmEspera.length === 0) return alert("⚠️ Fila vazia.");
        // Open driver selector modal to choose which driver will receive the route
        setShowDriverSelect(true);
    };

    // Assign a selected driver: optimize route and update each entrega to 'em_rota' with motorista_id e ordem
    const assignDriver = async (driver) => {
        if (!driver || !driver.id) return;
        setDispatchLoading(true);
        try {
            try { audioRef.current.play().catch(() => { }); } catch (e) { }
            let rotaOtimizada = [];
            try {
                rotaOtimizada = await otimizarRotaComGoogle(gestorPosicao, pedidosEmEspera);
                if (!rotaOtimizada || rotaOtimizada.length === 0) rotaOtimizada = otimizarRota(gestorPosicao, pedidosEmEspera);
            } catch (e) {
                // fallback para algoritmo local em caso de erro com Google API
                rotaOtimizada = otimizarRota(gestorPosicao, pedidosEmEspera);
            }
            const motoristaIdNum = Number(driver.id);
            // Validate motorista exists in local `frota` to avoid sending wrong id
            const motoristaExists = frota && frota.find ? frota.find(m => Number(m.id) === motoristaIdNum) : null;
            if (!motoristaExists) console.warn('assignDriver: motorista_id não encontrado na frota local', motoristaIdNum);
            const statusValue = 'em_rota';

            // Determine pedidos to dispatch and ensure IDs are numbers
            const pedidosParaDespachar = rotaOtimizada; // use rota otimizada as the set to dispatch
            const assignedIds = (pedidosParaDespachar || []).map(p => Number(p.id)).filter(n => Number.isFinite(n));

            if (assignedIds.length === 0) {
                console.warn('assignDriver: nenhum pedido válido para atualizar');
            } else {
                let updErr = null;
                try {
                    // Bulk update: set motorista_id and status for all selected pedidos
                    const { data: updData, error } = await supabase.from('entregas').update({ motorista_id: Number(driver.id), status: statusValue }).in('id', assignedIds);
                    updErr = error;
                    if (updErr) {
                        console.error('Erro bulk updating entregas:', updErr && updErr.message, updErr && updErr.hint, updErr && updErr.details, updErr && updErr.code);
                    } else {
                        // Only remove the updated pedidos from local state if the DB update succeeded
                        setPedidosEmEspera(prev => prev.filter(p => !assignedIds.includes(Number(p.id))));
                    }
                } catch (err) {
                    updErr = err;
                    console.error('Erro na requisição bulk update:', err && err.message, err && err.hint);
                }

                // Update local rotaOtimizada objects with ordem for UI only
                for (let i = 0; i < rotaOtimizada.length; i++) {
                    const pedido = rotaOtimizada[i];
                    const pid = typeof pedido.id === 'string' ? parseInt(pedido.id, 10) : pedido.id;
                    rotaOtimizada[i] = { ...pedido, ordem: i + 1, ordem_entrega: i + 1, motorista_id: Number(driver.id), id: pid };
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
                    const pid = typeof rotaOtimizada[i].id === 'string' ? parseInt(rotaOtimizada[i].id, 10) : rotaOtimizada[i].id;
                    if (!pid || isNaN(pid)) continue;
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
    return (
        <div style={{ minHeight: '100vh', minWidth: '1200px', backgroundColor: theme.bg, fontFamily: "'Inter', sans-serif", color: theme.textMain }}>

            {/* 1. HEADER SUPERIOR (NAVBAR) */}
            <header style={{
                backgroundColor: theme.headerBg,
                color: theme.headerText,
                padding: '0 40px',
                height: '70px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                boxShadow: '0 4px 20px rgba(0,0,0,0.2)'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                    <div style={{ width: '35px', height: '35px', background: theme.primary, borderRadius: '8px', display: 'flex', justifyContent: 'center', alignItems: 'center', fontWeight: 'bold' }}>LC</div>
                    <h2 style={{ margin: 0, fontSize: '20px', letterSpacing: '1px' }}>LOGI<span style={{ fontWeight: '300', opacity: 0.7 }}>CONTROL</span></h2>
                </div>

                {/* ABAS NO TOPO */}
                <nav style={{ display: 'flex', gap: '10px' }}>
                    {['Visão Geral', 'Nova Carga', 'Central de Despacho', 'Equipe'].map(tab => (
                        <button key={tab} onClick={() => setAbaAtiva(tab)} style={{
                            padding: '10px 20px',
                            background: abaAtiva === tab ? 'rgba(255,255,255,0.1)' : 'transparent',
                            border: abaAtiva === tab ? `1px solid ${theme.primary}` : '1px solid transparent',
                            color: abaAtiva === tab ? theme.primary : '#94a3b8', // Texto colorido quando ativo
                            borderRadius: '20px',
                            cursor: 'pointer',
                            fontWeight: '600',
                            fontSize: '14px',
                            transition: '0.3s'
                        }}>
                            {tab.toUpperCase()}
                        </button>
                    ))}
                </nav>

                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ textAlign: 'right', fontSize: '12px' }}>
                        <div style={{ color: theme.success, fontWeight: 'bold' }}>● SISTEMA ONLINE</div>
                        <div style={{ opacity: 0.6 }}>São Paulo, BR</div>
                        {gestorPhone && <div style={{ opacity: 0.6 }}>Contato: {gestorPhone}</div>}
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={() => setDarkMode(d => !d)} style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)', background: 'transparent', color: theme.headerText, cursor: 'pointer' }}>{darkMode ? 'Modo Claro' : 'Modo Escuro'}</button>
                        <button onClick={async () => { carregarDados(); alert('Dados atualizados.'); }} style={{ padding: '8px 12px', borderRadius: '8px', border: 'none', background: theme.accent, color: '#fff', cursor: 'pointer' }}>Atualizar Posição</button>
                    </div>
                </div>
            </header>

            {/* 2. ÁREA DE CONTEÚDO */}
            <main style={{ maxWidth: '1200px', margin: '40px auto', padding: '0 20px' }}>

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
                            <div style={{ height: '100%', borderRadius: '12px', overflow: 'hidden' }}>
                                {googleLoaded ? (
                                    <GoogleMap
                                        mapContainerStyle={{ width: '100%', height: '100%' }}
                                        center={mapCenter}
                                        zoom={13}
                                        onLoad={(map) => { mapRef.current = map; setGoogleLoaded(true); }}
                                    >
                                        {(() => {
                                            const map = mapRef.current;
                                            if (!map || !window.google || !window.google.maps) return null;
                                            return (
                                                <>
                                                    {/* Base / gestor (validação de coordenadas) */}
                                                    {(() => {
                                                        const lat = parseFloat(gestorPosicao[0]);
                                                        const lng = parseFloat(gestorPosicao[1]);
                                                        if (!isNaN(lat) && !isNaN(lng)) return <AdvancedMarker map={map} position={{ lat, lng }} iconUrl={numberedIconUrl('G')} />;
                                                        return null;
                                                    })()}

                                                    {/* Entregas (rota) com validação de lat/lng e marcadores avançados */}
                                                    {orderedRota.map((p, i) => {
                                                        const lat = parseFloat(p.lat);
                                                        const lng = parseFloat(p.lng);
                                                        if (isNaN(lat) || isNaN(lng)) return null;
                                                        return <AdvancedMarker key={p.id} map={map} position={{ lat, lng }} iconUrl={numberedIconUrl(p.ordem || (i + 1))} />;
                                                    })}

                                                    {/* Polylines removed — mapa exibe somente marcadores */}

                                                    {/* Motoristas (markers) - validação e AdvancedMarker */}
                                                    {frota && frota.map(m => {
                                                        const lat = parseFloat(m.lat);
                                                        const lng = parseFloat(m.lng);
                                                        if (!m || isNaN(lat) || isNaN(lng)) return null;
                                                        return <AdvancedMarker key={`m-${m.id}`} map={map} position={{ lat, lng }} iconUrl={motoristaIconUrlFor(m.heading || 0)} onClick={() => setSelectedMotorista(m)} />;
                                                    })}

                                                    {selectedMotorista && selectedMotorista.lat != null && selectedMotorista.lng != null && (
                                                        <InfoWindow position={{ lat: selectedMotorista.lat, lng: selectedMotorista.lng }} onCloseClick={() => setSelectedMotorista(null)}>
                                                            <div style={{ minWidth: '160px' }}>
                                                                {selectedMotorista.avatar_path ? (
                                                                    <img src={selectedMotorista.avatar_path} alt={selectedMotorista.nome} style={{ width: '40px', height: '40px', borderRadius: '8px', objectFit: 'cover', marginRight: '8px', float: 'left' }} />
                                                                ) : null}
                                                                <div style={{ fontWeight: '700' }}>{selectedMotorista.nome}</div>
                                                                <div style={{ fontSize: '12px', color: selectedMotorista.esta_online ? theme.success : theme.danger }}>{selectedMotorista.esta_online ? 'Online' : 'Offline'}</div>
                                                            </div>
                                                        </InfoWindow>
                                                    )}
                                                </>
                                            );
                                        })()}
                                    </GoogleMap>
                                ) : (
                                    <div style={{ width: '100%', height: '100%' }} />
                                )}
                            </div>
                        </div>

                        {/* INFO LATERAL */}
                        <div style={{ background: theme.card, borderRadius: '16px', padding: '25px', boxShadow: theme.shadow }}>
                            <h3 style={{ marginTop: 0, color: theme.textMain }}>Status da Operação</h3>
                            {motoristaDaRota ? (
                                <div>
                                    <div style={{ padding: '15px', background: '#e0e7ff', borderRadius: '12px', marginBottom: '20px', color: theme.primary }}>
                                        <strong>🚛 Motorista:</strong> {motoristaDaRota.nome}<br />
                                        <strong>🔌 Status:</strong> {motoristaDaRota.esta_online ? 'Online' : 'Offline'}
                                        {motoristaDaRota.lat && motoristaDaRota.lng && (<div><strong>📍</strong> {motoristaDaRota.lat.toFixed ? `${motoristaDaRota.lat.toFixed(4)}, ${motoristaDaRota.lng.toFixed(4)}` : `${motoristaDaRota.lat}, ${motoristaDaRota.lng}`}</div>)}
                                    </div>
                                    <h4 style={{ margin: '10px 0' }}>Próximas Entregas:</h4>
                                    <ul style={{ paddingLeft: '20px', fontSize: '14px', color: theme.textMain }}>
                                        {rotaAtiva.map((p, i) => <li key={p.id} style={{ marginBottom: '8px' }}><strong>{i + 1}.</strong> {p.cliente}</li>)}
                                    </ul>
                                </div>
                            ) : (
                                <p style={{ color: theme.textLight }}>Nenhuma rota despachada no momento.</p>
                            )}
                            {/* Avisos do gestor */}
                            <div style={{ marginTop: '20px' }}>
                                <h4 style={{ marginBottom: '8px' }}>Avisos</h4>
                                {avisos.length === 0 ? <div style={{ color: theme.textLight }}>Nenhum aviso.</div> : (
                                    <ul style={{ paddingLeft: '18px', margin: 0 }}>
                                        {avisos.map((a, i) => (
                                            <li key={i} style={{ marginBottom: '10px', fontSize: '13px' }}>
                                                <div style={{ fontWeight: '700' }}>{a.titulo}</div>
                                                <div style={{ color: theme.textLight }}>{a.mensagem}</div>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
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
                                    <select name="tipo" defaultValue="Entrega" style={{ padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1' }}>
                                        <option>Entrega</option>
                                        <option>Recolha</option>
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
                                {recentList.length === 0 ? (
                                    <div style={{ color: theme.textLight, padding: '12px' }}>Nenhum histórico disponível.</div>
                                ) : (
                                    recentList.map((it, idx) => (
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
                        {pedidosEmEspera.length === 0 ? <p style={{ textAlign: 'center', color: theme.textLight }}>Tudo limpo! Sem pendências.</p> : (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px' }}>
                                {pedidosEmEspera.map(p => (
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
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ textAlign: 'left', borderBottom: '2px solid #f1f5f9', color: theme.textLight }}>
                                    <th style={{ padding: '10px' }}>NOME</th>
                                    <th>STATUS</th>
                                    <th>VEÍCULO</th>
                                    <th>PLACA</th>
                                </tr>
                            </thead>
                            <tbody>
                                {frota.map(m => (
                                    <tr key={m.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                        <td style={{ padding: '15px 10px', fontWeight: 'bold' }}>{m.nome}</td>
                                        <td><span style={{ padding: '5px 10px', borderRadius: '15px', background: m.status === 'Online' ? '#dcfce7' : '#fee2e2', color: m.status === 'Online' ? '#166534' : '#991b1b', fontSize: '12px', fontWeight: 'bold' }}>{m.status}</span></td>
                                        <td>{m.veiculo}</td>
                                        <td style={{ fontFamily: 'monospace' }}>{m.placa}</td>
                                    </tr>
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
                theme={theme}
                loading={dispatchLoading}
            />
        </div>
    );
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
function DriverSelectModal({ visible, onClose, frota = [], onSelect, theme, loading = false }) {
    const [localSelected, setLocalSelected] = useState(null);
    useEffect(() => { if (!visible) setLocalSelected(null); }, [visible]);
    if (!visible) return null;
    const online = (frota || []).filter(m => m.esta_online === true);

    const handleSelect = async (m) => {
        if (loading) return; // bloqueia se já estiver enviando
        setLocalSelected(m.id);
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
                    <button onClick={onClose} style={{ background: 'transparent', border: 'none', fontSize: '18px', cursor: 'pointer' }}>✕</button>
                </div>
                <div style={{ maxHeight: '58vh', overflow: 'auto' }}>
                    {online.length === 0 ? (
                        <div style={{ padding: '12px', color: theme.textLight }}>Nenhum motorista online no momento.</div>
                    ) : (
                        online.map(m => (
                            <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 8px', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                                <div style={{ flex: 1 }}>
                                    <button disabled={loading} onClick={() => handleSelect(m)} style={{ background: 'transparent', border: 'none', textAlign: 'left', cursor: loading ? 'wait' : 'pointer', padding: 0 }}>
                                        <div style={{ fontWeight: 700 }}>{m.nome}</div>
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