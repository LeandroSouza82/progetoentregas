import React, { useEffect, useRef, useMemo, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import { MapContainer, TileLayer, Marker, Popup, Polyline, Tooltip, LayersControl, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import polyline from 'polyline';
import { supabase } from './supabaseClient';
import createCustomPinIcon from './CustomPin.jsx';
// Import opcional do Mapbox React (aliased para evitar conflitos com react-leaflet)
// Disponibiliza `MapboxMap`, `MapboxMarker` e `MapboxPopup` se você quiser usar Mapbox GL React
import MapboxMap, { Marker as MapboxMarker, Popup as MapboxPopup } from 'react-map-gl';

const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;

if (!token) {
  console.error("❌ Erro Crítico: Token do Mapbox não encontrado nas variáveis de ambiente.");
}

const isValidSC = (lat, lng) => {
    if (lat == null || lng == null) return false;
    const latN = Number(lat); const lngN = Number(lng);
    if (!Number.isFinite(latN) || !Number.isFinite(lngN)) return false;
    // 🛡️ Região Estrita: Grande Florianópolis (Impede drift para SP)
    return (latN <= -27.35 && latN >= -27.90 && lngN >= -48.98 && lngN <= -48.30);
};

function MapaLogistica({ entregas = [], frota = [], height = 500, mobile = false, focusCoords = null, motoristaDaRota = null, runtimePolylines = {}, rotaCoordenadas = [], clearMap = false, darkMode = undefined, rotaOrdenadaState = [] }) {
    // 🛡️ Validação de Injeção: Se o token não for encontrado, exibe erro amigável em vez de quebrar
    if (!token) {
        return (
            <div style={{ width: '100%', height: height, background: '#111827', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f87171', borderRadius: '12px', border: '1px solid #7f1d1d', padding: '20px', boxSizing: 'border-box' }}>
                <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '40px', marginBottom: '10px' }}>⚠️</div>
                    <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', fontWeight: 800 }}>Erro de Configuração</h3>
                    <p style={{ margin: 0, fontSize: '14px', color: '#9ca3af' }}>A credencial do Mapbox (VITE_MAPBOX_ACCESS_TOKEN) não foi encontrada no arquivo .env.local.</p>
                </div>
            </div>
        );
    }


    const mapRef = useRef(null);
    // cache último posicionamento conhecido por motorista (id -> {lat,lng,ultima_atualizacao})
    const lastCoordsRef = useRef(new Map());
    // timestamp quando uma atualização inválida foi recebida (id -> ms)
    const lastInvalidTimeRef = useRef(new Map());
    // cache último ângulo de cada motorista (id -> angulo)
    const lastAnglesRef = useRef(new Map());
    // timestamp of last DB GPS update per motorista (ms)
    const lastGpsUpdateRef = useRef(new Map());
    // displayed positions for smooth marker interpolation (id -> {lat,lng})
    const lastDisplayedRef = useRef(new Map());
    // No delivery state kept here in emergency mode — map will render only fleet markers
    const [gestorPos, setGestorPos] = useState(null);
    const [focusMarker, setFocusMarker] = useState(null);
    // map visual mode: 'dark' or 'light' — affects polyline styling
    const [mapMode, setMapMode] = useState(token && token.length > 0 ? 'dark' : 'light');

    // --- MEMÓRIA DO PINO CLICADO ---
    // removido: usamos popups por hover em vez de estado selecionado

    // Local copy of entregas so the map can react to realtime updates
    // 1. Mudança de Array para Objeto para travar o estado por ID
    const [localEntregas, setLocalEntregas] = useState({});

    // Atualiza status local sem remover o registro (mantém o pino visível)
    const atualizarStatusLocal = (id, novoStatus, dadosAdicionais = {}) => {
        setLocalEntregas(prev => {
            const copy = { ...(prev || {}) };
            const existing = copy[id] || {};
            copy[id] = {
                ...existing,
                id,
                status: String(novoStatus || existing.status || '').toLowerCase(),
                ...dadosAdicionais
            };
            return copy;
        });
    };

    // control visual clearing of pins (does not delete from DB)
    const [showPins, setShowPins] = useState(true);
    useEffect(() => setShowPins(!clearMap), [clearMap]);

    // subscribe to Supabase realtime updates for `entregas` using object-by-id state
    useEffect(() => {
        const channel = supabase.channel('realtime-entregas-final');

        // INSERT: adiciona o novo pino (se válido)
        channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'entregas' }, (payload) => {
            try {
                const rec = payload.new;
                if (!rec) return;
                const marker = normalizeEntregaToMarker(rec);
                // atualiza localEntregas também
                setLocalEntregas(prev => ({ ...(prev || {}), [rec.id]: { ...(prev && prev[rec.id] ? prev[rec.id] : {}), ...rec } }));
                if (!marker) return;
                setEntregaMarkersState(prev => {
                    if (prev.findIndex(i => i.id === marker.id) !== -1) return prev;
                    return [...prev, marker];
                });
            } catch (e) { /* ignore */ }
        });

        // UPDATE: atualiza somente o item alterado mantendo a ordem
        channel.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'entregas' }, (payload) => {
            try {
                const rec = payload.new;
                if (!rec) return;
                // atualiza localEntregas também (merge)
                setLocalEntregas(prev => {
                    const copy = { ...(prev || {}) };
                    copy[rec.id] = { ...(copy[rec.id] || {}), ...rec };
                    return copy;
                });

                setEntregaMarkersState(current => {
                    const idx = current.findIndex(item => item.id === rec.id);
                    if (idx !== -1) {
                        const novaLista = [...current];
                        const existing = novaLista[idx] || {};
                        const atualizado = normalizeEntregaToMarker({ ...existing, ...rec }) || { ...existing, ...rec };
                        novaLista[idx] = { ...novaLista[idx], ...atualizado };
                        return novaLista;
                    }
                    return current;
                });
            } catch (e) { /* ignore */ }
        });

        // DELETE: remove o pino
        channel.on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'entregas' }, (payload) => {
            try {
                const rec = payload.old;
                if (!rec) return;
                setLocalEntregas(prev => {
                    const copy = { ...(prev || {}) };
                    delete copy[rec.id];
                    return copy;
                });
                setEntregaMarkersState(prev => prev.filter(i => i.id !== rec.id));
            } catch (e) { /* ignore */ }
        });

        channel.subscribe();

        return () => { try { supabase.removeChannel(channel); } catch (e) { try { channel.unsubscribe && channel.unsubscribe(); } catch (e2) { } } };
    }, []);

    // 2. Converter para Array para o resto do código não quebrar (mantemos localEntregas para realtime)
    const entregasArray = useMemo(() => Object.values(localEntregas || {}), [localEntregas]);

    // Estado explícito dos marcadores para permitir updates incrementais (UPDATE em realtime)
    const [entregaMarkersState, setEntregaMarkersState] = useState([]);

    // Helper para normalizar um registro de entrega em marcador
    const normalizeEntregaToMarker = (e) => {
        try {
            if (!e || e.id == null) return null;
            const lat = parseFloat(e.lat);
            const lng = parseFloat(e.lng);
            if (isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) return null;
            const allowedTipos = new Set(['entrega', 'recolha', 'outros', 'outro']);
            const tipoRaw = String(e.tipo || '').trim().toLowerCase();
            const tipoFinal = allowedTipos.has(tipoRaw) ? tipoRaw : 'outros';
            return {
                ...e,
                id: e.id,
                lat,
                lng,
                endereco: e.endereco || e.address || '',
                status: String(e.status || 'pendente').toLowerCase(),
                tipo: tipoFinal
            };
        } catch (err) { return null; }
    };

    // Inicializa/normaliza o estado de marcadores a partir da prop `entregas`
    useEffect(() => {
        try {
            if (!entregas || !Array.isArray(entregas) || entregas.length === 0) {
                setEntregaMarkersState([]);
                return;
            }
            const list = entregas
                .filter(e => String(e.status || '').trim().toLowerCase() !== 'arquivado')
                .map(normalizeEntregaToMarker)
                .filter(Boolean);
            setEntregaMarkersState(list);
        } catch (e) { /* ignore */ }
    }, [entregas]);

    // INTERVENÇÃO: sincroniza a prop `entregas` recebida do App com o estado local
    useEffect(() => {
        try {
            if (!entregas || !Array.isArray(entregas) || entregas.length === 0) return;
            const novo = {};
            entregas.forEach(e => { if (e && e.id != null) novo[e.id] = e; });
            setLocalEntregas(prev => {
                // Only replace if different to avoid unnecessary renders
                try {
                    const keysPrev = Object.keys(prev || {});
                    const keysNew = Object.keys(novo || {});
                    if (keysPrev.length === keysNew.length && keysNew.every(k => prev && prev[k] && prev[k].id === novo[k].id)) return prev;
                } catch (e) { }
                return novo;
            });
        } catch (e) { /* ignore */ }
    }, [entregas]);

    // Usa o estado de marcadores gerenciado localmente (inicializado pela prop `entregas`)
    const entregaMarkers = entregaMarkersState;

    // Show any passed fleet items that have valid SC coords and are online & recent
    // Nota: atualização síncrona do cache será feita dentro do useMemo de frotaMarkers

    const frotaMarkers = React.useMemo(() => {
        const out = [];
        // 1. Cria um Set de IDs que chegaram agora do Supabase e estão ONLINE
        const idsOnlineAgora = new Set((frota || []).filter(m => String(m.esta_online) === 'true').map(m => m.id));

        // 2. LIMPEZA BRUTA: Se o ID estava no mapa mas não está no Set de online, DELETA do cache
        Array.from(lastCoordsRef.current.keys()).forEach(id => {
            if (!idsOnlineAgora.has(id)) {
                lastCoordsRef.current.delete(id);
                lastAnglesRef.current.delete(id);
            }
        });

        // 3. Monta a lista de marcadores ativos (só quem está na lista AGORA)
        (frota || []).forEach(m => {
            if (!m || !m.id) return;

            const isOnline = String(m.esta_online) === 'true';

            const hasCoords = (m.lat != null && m.lng != null);
            // treat string '0' or numeric 0 as invalid
            const latN = hasCoords ? Number(m.lat) : null;
            const lngN = hasCoords ? Number(m.lng) : null;

            // If online and coords present, validate and update cache
            if (isOnline && hasCoords && Number.isFinite(latN) && Number.isFinite(lngN) && !(latN === 0 && lngN === 0)) {
                // Ignore coords way outside expected bounds
                if (!isValidSC(latN, lngN)) {
                    // mark invalid time but keep last known for up to 30s
                    if (!lastInvalidTimeRef.current.has(m.id)) lastInvalidTimeRef.current.set(m.id, Date.now());
                    return;
                }

                // noise filter: ignore impossible jumps (e.g., >500km between prev and new)
                const prevCoords = lastCoordsRef.current.get(m.id);
                if (prevCoords && prevCoords.lat != null && prevCoords.lng != null) {
                    try {
                        const dist = distanceMeters({ lat: prevCoords.lat, lng: prevCoords.lng }, { lat: latN, lng: lngN });
                        if (dist > 500000) {
                            // ignore this noisy update, keep previous coords
                            console.warn(`Ignored noisy jump for motorista ${m.id}: ${Math.round(dist)}m`);
                            // mark invalid time but keep last known for up to 30s
                            if (!lastInvalidTimeRef.current.has(m.id)) lastInvalidTimeRef.current.set(m.id, Date.now());
                            return;
                        }
                    } catch (e) { /* ignore */ }
                }

                // --- INÍCIO DA CORREÇÃO DE ROTAÇÃO ---
                try {
                    const id = m.id;
                    const prevCoords = lastCoordsRef.current.get(id);
                    let currentAngle = lastAnglesRef.current.get(id) || 0;

                    // 1. Prioridade para o Heading (bússola real) enviado pelo dispositivo
                    if (m.heading !== undefined && m.heading !== null && m.heading !== -1) {
                        currentAngle = Number(m.heading);
                    }
                    // 2. Cálculo por vetor apenas se houver deslocamento significativo (> 5 metros)
                    else if (prevCoords && prevCoords.lat != null && prevCoords.lng != null) {
                        const dist = distanceMeters(
                            { lat: prevCoords.lat, lng: prevCoords.lng },
                            { lat: latN, lng: lngN }
                        );

                        // Bloqueia atualização de ângulo se a moto estiver parada ou com GPS oscilando
                        if (dist > 5) {
                            currentAngle = calcularAngulo(prevCoords, { lat: latN, lng: lngN });
                        }
                    }

                    // 3. Salva no cache de ângulos para persistência visual
                    lastAnglesRef.current.set(id, currentAngle);
                } catch (error) {
                    console.error("Falha no cálculo de rotação do motorista:", error);
                }
                // --- FIM DA CORREÇÃO DE ROTAÇÃO ---

                const prevCoords2 = lastCoordsRef.current.get(m.id);
                lastCoordsRef.current.set(m.id, { lat: latN, lng: lngN });
                // record DB update timestamp only when coords changed
                try {
                    if (!prevCoords2 || prevCoords2.lat !== latN || prevCoords2.lng !== lngN) {
                        lastGpsUpdateRef.current.set(m.id, Date.now());
                        if (!lastDisplayedRef.current.get(m.id)) lastDisplayedRef.current.set(m.id, { lat: latN, lng: lngN });
                    }
                } catch (e) { /* ignore */ }
                // clear any invalid marker timestamp
                if (lastInvalidTimeRef.current.has(m.id)) lastInvalidTimeRef.current.delete(m.id);
                out.push({ id: m.id, lat: latN, lng: lngN, title: m.nome || 'Motorista', online: true });
            } else {
                // If coords are missing or driver offline, do NOT immediately delete last known coords.
                const prevKnown = lastCoordsRef.current.get(m.id);
                if (prevKnown) {
                    const invalidSince = lastInvalidTimeRef.current.get(m.id) || Date.now();
                    if (!lastInvalidTimeRef.current.has(m.id)) lastInvalidTimeRef.current.set(m.id, invalidSince);
                    const age = Date.now() - invalidSince;
                    if (age <= 30000) {
                        // keep displaying last known for up to 30s
                        out.push({ id: m.id, lat: prevKnown.lat, lng: prevKnown.lng, title: m.nome || 'Motorista', online: false });
                    } else {
                        // expired: remove cache entry
                        lastCoordsRef.current.delete(m.id);
                        lastAnglesRef.current.delete(m.id);
                        lastDisplayedRef.current.delete(m.id);
                        lastInvalidTimeRef.current.delete(m.id);
                    }
                }
            }
        });
        return out;
    }, [frota]);

    // On load: center or fit bounds (Leaflet)
    const handleLoad = (mapInstance) => {
        try {
            const inst = mapInstance;
            mapRef.current = inst;
            // Combine fleet + entregas so map fits all pins on load
            const combined = [
                ...frotaMarkers.map(p => ({ lat: p.lat, lng: p.lng })),
                ...entregaMarkers.map(p => ({ lat: p.lat, lng: p.lng }))
            ].filter(pt => pt && Number.isFinite(Number(pt.lat)) && Number.isFinite(Number(pt.lng)));
            if (!combined || combined.length === 0) {
                try { inst.setView([-27.5969, -48.5495], 12); } catch (e) { }
                return;
            }
            try {
                const bounds = L.latLngBounds(combined.map(pt => L.latLng(Number(pt.lat), Number(pt.lng))));
                inst.fitBounds(bounds, { padding: [50, 50], maxZoom: 15, animate: false });
            } catch (e) { /* ignore */ }
        } catch (e) { /* ignore */ }
    };

    // Quando `focusCoords` externo mudar, faz flyTo e marca temporariamente
    // (o App passa `enderecoCoords` como prop para solicitar o foco)

    const mapStyle = { width: '100%', height: mobile ? 250 : height };

    // Determine safe center: prefer fleet first, fallback to default center
    const defaultCenter = { lat: -27.63, lng: -48.65 }; // Palhoça / São José (Grande Florianópolis)
    const computedCenter = useMemo(() => {
        const firstFleet = (frotaMarkers && frotaMarkers.length > 0) ? frotaMarkers[0] : null;
        const candidate = firstFleet || defaultCenter;
        const lat = Number(candidate.lat);
        const lng = Number(candidate.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return defaultCenter;
        return { lat, lng };
    }, [frotaMarkers]);

    // When clearMap toggled on, reset view to fleet bounds or default
    useEffect(() => {
        try {
            if (!mapRef.current) return;
            if (clearMap) {
                // Force a clean view centered on Santa Catarina default (frontend-only cleanup)
                try { mapRef.current.setView([defaultCenter.lat, defaultCenter.lng], 12); } catch (e) { }
            }
        } catch (e) { /* ignore */ }
    }, [clearMap, frotaMarkers]);

    // Track last known markers to avoid refitting on every render
    const lastPointsKeyRef = useRef('');
    const hasInitializedBoundsRef = useRef(false);
    const hasAutoCenteredRef = useRef(false);
    useEffect(() => {
        try {
            if (focusCoords && focusCoords.lat != null && focusCoords.lng != null && mapRef.current && typeof mapRef.current.flyTo === 'function') {
                try {
                    const lat = Number(focusCoords.lat);
                    const lng = Number(focusCoords.lng);
                    if (Number.isFinite(lat) && Number.isFinite(lng)) {
                        mapRef.current.flyTo([lat, lng], 16);
                        setFocusMarker({ lat, lng });
                        setTimeout(() => setFocusMarker(null), 8000);
                    }
                } catch (e) { /* ignore */ }
            }
        } catch (e) { /* ignore */ }
        try {
            // Ajustar bounds sempre que as entregas ou frota mudarem (auto-fit)
            const key = JSON.stringify({
                f: frotaMarkers.map(p => ({ id: p.id, lat: p.lat, lng: p.lng })),
                e: entregaMarkers.map(p => ({ id: p.id, lat: p.lat, lng: p.lng }))
            });
            if (key === lastPointsKeyRef.current) return; // nothing changed
            lastPointsKeyRef.current = key;
            if (!mapRef.current) return;
            const inst = mapRef.current;
            const points = [
                ...frotaMarkers.map(p => ({ lat: p.lat, lng: p.lng })),
                ...entregaMarkers.map(p => ({ lat: p.lat, lng: p.lng }))
            ].filter(pt => pt && Number.isFinite(Number(pt.lat)) && Number.isFinite(Number(pt.lng)));
            if (!points || points.length === 0) {
                try { inst.setView([defaultCenter.lat, defaultCenter.lng], 12); } catch (e) { }
                return;
            }
            try {
                // Only auto-fit when there is at least one delivery
                if ((entregaMarkers || []).length < 1) return;
                const bounds = L.latLngBounds(points.map(pt => L.latLng(Number(pt.lat), Number(pt.lng))));
                // Use flyToBounds for smooth animation; Leaflet duration is in seconds
                if (typeof inst.flyToBounds === 'function') {
                    try { inst.flyToBounds(bounds, { padding: [50, 50], maxZoom: 15, duration: 1 }); } catch (e) { inst.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 }); }
                } else {
                    inst.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
                }
            } catch (e) { /* ignore */ }
        } catch (e) { /* ignore */ }
    }, [frotaMarkers, entregaMarkers, focusCoords]);

    // Helper: create pin icon for entregas (blue circle with white number)
    // use createCustomPinIcon from src/CustomPin.jsx
    const normalizeText = (s) => {
        try {
            return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
        } catch (e) {
            return String(s || '').toLowerCase().trim();
        }
    };

    // Local getMarkerIcon (case-insensitive) — same rules used in App.jsx
    function getMarkerIcon(status, tipo) {
        try {
            const statusNormalizado = String(status || '').trim().toLowerCase();
            const tipoNormalizado = String(tipo || '').trim().toLowerCase();

            // Verde: entrega concluída com sucesso
            if (['entregue', 'sucesso', 'concluido'].includes(statusNormalizado)) return '#10b981';
            // Vermelho: falha na entrega
            if (statusNormalizado === 'falha') return '#ef4444';

            if (tipoNormalizado === 'recolha') return '#fb923c'; // laranja
            if (tipoNormalizado === 'entrega') return '#2563eb'; // azul
            if (tipoNormalizado === 'outros' || tipoNormalizado === 'outro') return '#a78bfa'; // lilás

            return '#2563eb';
        } catch (e) {
            return '#2563eb';
        }
    }

    // Função para calcular o ângulo (bearing) entre dois pontos
    // Padrão seguro: aceitar objetos { lat, lng } e garantir retorno em [0,360)
    function calcularAngulo(p1, p2) {
        try {
            if (!p1 || !p2) return 0;
            const dLon = (p2.lng - p1.lng) * Math.PI / 180;
            const y = Math.sin(dLon) * Math.cos(p2.lat * Math.PI / 180);
            const x = Math.cos(p1.lat * Math.PI / 180) * Math.sin(p2.lat * Math.PI / 180) -
                Math.sin(p1.lat * Math.PI / 180) * Math.cos(p2.lat * Math.PI / 180) * Math.cos(dLon);
            let brng = Math.atan2(y, x) * 180 / Math.PI;
            return (brng + 360) % 360;
        } catch (e) { return 0; }
    }

    // Gera o ícone da moto limpo: usa estrutura específica com aura, imagem e nome do motorista
    function getV10MotoIcon(online, angulo = 0, nome = '') {
        const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const safeName = esc(nome);
        // usar caminho absoluto root para /moto.png (garante consistência de deploy)
        const motoSrc = '/moto.png';
        const html = `
    <div style="width:60px;height:80px;position:relative;display:block;pointer-events:auto;">
        <div style="position:absolute;left:50%;bottom:0;transform:translateX(-50%);display:flex;align-items:flex-end;justify-content:center;">
            <div style="position: absolute; width: 45px; height: 45px; background: rgba(255, 0, 0, 0.4); border-radius: 50%; filter: blur(4px); z-index: 1; bottom: 6px;"></div>

            <!-- Container rotacionável: aplica transform + transition aqui para suavizar a rotação -->
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:2;transform:rotate(${angulo}deg);transition: transform 0.5s cubic-bezier(0.4, 0, 0.2, 1);">
                <img src="${motoSrc}" style="width:50px;height:50px;display:block;" />
                <div style="margin-top:4px;background:rgba(0,0,0,0.8);color:white;padding:2px 8px;border-radius:10px;font-size:11px;white-space:nowrap;">${safeName}</div>
            </div>
        </div>
    </div>`;
        return L.divIcon({ html, className: 'moto-icon-limpo', iconSize: [60, 80], iconAnchor: [30, 80] });
    }

    function getGestorIcon() {
        const html = '<div style="width:22px;height:22px;border-radius:50%;background:#2563eb;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.4);"></div>';
        return L.divIcon({ html, className: 'gestor-pos-icon', iconSize: [22, 22], iconAnchor: [11, 11], popupAnchor: [0, -12] });
    }

    // Decode encoded polyline or parse JSON array (uses polyline lib)
    function decodePolyline(encoded) {
        if (!encoded) return [];
        if (Array.isArray(encoded)) return encoded;
        if (typeof encoded === 'object' && Array.isArray(encoded.coordinates)) return encoded.coordinates;
        if (typeof encoded === 'string') {
            const trimmed = encoded.trim();
            if (trimmed.startsWith('[')) {
                try { return JSON.parse(trimmed); } catch (e) { /* fallthrough */ }
            }
            try {
                return polyline.decode(trimmed);
            } catch (e) { return []; }
        }
        return [];
    }

    // Helpers for animation and geometry
    const toLatLng = (p) => ({ lat: Number(p[0]), lng: Number(p[1]) });
    const distanceMeters = (a, b) => {
        const R = 6371000; // m
        const lat1 = a.lat * Math.PI / 180;
        const lat2 = b.lat * Math.PI / 180;
        const dLat = (b.lat - a.lat) * Math.PI / 180;
        const dLon = (b.lng - a.lng) * Math.PI / 180;
        const sa = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(sa), Math.sqrt(1 - sa));
        return R * c;
    };
    const lerpLatLng = (a, b, t) => ({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });

    const [, setDisplayTick] = useState(0); // used to force rerenders during animation

    // Smoothly interpolate displayed marker positions toward lastCoordsRef, but only when
    // actual DB-updated coordinates changed. If no coordinate change for >10s, keep marker static.
    useEffect(() => {
        let raf = null;
        let lastTime = performance.now();
        function loop(now) {
            const dt = Math.max(0, (now - lastTime) / 1000);
            lastTime = now;
            let changed = false;
            try {
                (frotaMarkers || []).forEach(m => {
                    const id = m.id;
                    const target = lastCoordsRef.current.get(id);
                    if (!target) return;
                    const disp = lastDisplayedRef.current.get(id) || target;
                    const lastUpdate = lastGpsUpdateRef.current.get(id) || 0;
                    const age = Date.now() - lastUpdate;
                    // If no recent update within 10s and target equals displayed, ensure static
                    if (age > 10000) {
                        if (disp.lat !== target.lat || disp.lng !== target.lng) {
                            // snap to target and stop
                            lastDisplayedRef.current.set(id, { lat: target.lat, lng: target.lng });
                            changed = true;
                        }
                        return;
                    }

                    // If coordinates unchanged, do nothing
                    if (Math.abs(disp.lat - target.lat) < 1e-6 && Math.abs(disp.lng - target.lng) < 1e-6) return;

                    // Interpolate towards target (smoothing factor)
                    const smoothing = 6; // higher = faster convergence
                    const t = Math.min(1, smoothing * dt);
                    const nx = disp.lat + (target.lat - disp.lat) * t;
                    const ny = disp.lng + (target.lng - disp.lng) * t;
                    lastDisplayedRef.current.set(id, { lat: nx, lng: ny });
                    changed = true;
                });
            } catch (e) { /* ignore */ }
            if (changed) setDisplayTick(n => n + 1);
            raf = requestAnimationFrame(loop);
        }
        raf = requestAnimationFrame(loop);
        return () => { if (raf) cancelAnimationFrame(raf); };
    }, [frotaMarkers]);

    // Delivery-route DB subscription disabled in emergency mode (no polylines from DB)
    // useEffect intentionally removed to avoid map-side processing of deliveries.
    // (Previously fetched rota_polyline from 'entregas' and subscribed to realtime changes.)

    // Polylines from deliveries disabled in emergency mode — map will not draw delivery/routes.

    // Conectar entregas em ordem (1->2->3) para conferência visual no dashboard
    // Delivery route positions disabled in emergency mode.

    // Focus on Leandro's route when available (executa apenas uma vez)
    const hasFocusedLeandroRef = useRef(false);
    // Focus-on-Leandro logic removed in emergency mode (avoid map re-centering based on routes).

    // Geolocation helper: locate user and set marker
    function Geolocate() {
        const map = useMapEvents({
            locationfound(e) {
                try {
                    const lat = Number(e.latlng.lat);
                    const lng = Number(e.latlng.lng);
                    if (Number.isFinite(lat) && Number.isFinite(lng)) {
                        // store gestor position but do NOT flyTo on first load (avoid jump)
                        setGestorPos([lat, lng]);
                    }
                } catch (err) { /* ignore */ }
            },
            locationerror() {
                // user denied or unavailable — fallback handled by initial center
            }
        });

        useEffect(() => {
            try {
                if (!map) return;
                // request location once on mount (will only auto-center once)
                if (!hasAutoCenteredRef.current) map.locate({ setView: false, maxZoom: 15 });
            } catch (e) { /* ignore */ }
        }, [map]);

        return null;
    }

    function AutoFitBounds({ gestorPos, entregas }) {
        const map = useMap();

        // Usamos o window.MAP_JA_FOCOU para que, mesmo que o componente recarregue,
        // a memória do foco persista fora do ciclo de vida do React.
        useEffect(() => {
            if (!map || window.MAP_JA_FOCOU) return;

            const points = [];
            const gLat = Array.isArray(gestorPos) ? gestorPos[0] : gestorPos?.lat;
            const gLng = Array.isArray(gestorPos) ? gestorPos[1] : gestorPos?.lng;

            if (Number.isFinite(parseFloat(gLat)) && Number.isFinite(parseFloat(gLng))) {
                points.push([parseFloat(gLat), parseFloat(gLng)]);
            }

            if (Array.isArray(entregas) && entregas.length > 0) {
                entregas.forEach(p => {
                    const lat = parseFloat(p.lat);
                    const lng = parseFloat(p.lng);
                    if (Number.isFinite(lat) && Number.isFinite(lng)) points.push([lat, lng]);
                });
            }

            // Só faz o zoom se tivermos pontos E se as entregas já tiverem carregado do banco
            if (points.length > 1) {
                try {
                    if (typeof map.flyToBounds === 'function') {
                        map.flyToBounds(points, { padding: [80, 80], maxZoom: 15 });
                    } else {
                        map.fitBounds(points, { padding: [80, 80], maxZoom: 15 });
                    }
                    window.MAP_JA_FOCOU = true; // Trava global: o mapa não mexe mais sozinho até você dar F5
                } catch (err) {
                    console.error('Erro ao ajustar bordas:', err);
                }
            }
        }, [map, gestorPos, entregas]);

        return null;
    }

    // Listen for LayersControl base layer change to toggle mapMode
    useEffect(() => {
        try {
            const map = mapRef.current;
            if (!map || typeof map.on !== 'function') return;
            const handler = (e) => {
                try {
                    const name = String(e?.name || '').toLowerCase();
                    if (name.includes('noturno') || name.includes('dark')) setMapMode('dark');
                    else setMapMode('light');
                } catch (err) { /* ignore */ }
            };
            map.on('baselayerchange', handler);
            return () => { try { map.off('baselayerchange', handler); } catch (e) { } };
        } catch (e) { /* ignore */ }
    }, []);

    // Inject CSS to ensure delivery popups are above polylines
    useEffect(() => {
        try {
            if (typeof document === 'undefined') return;
            if (document.getElementById('delivery-popup-style')) return;
            const style = document.createElement('style');
            style.id = 'delivery-popup-style';
            style.innerHTML = `
                .delivery-popup.leaflet-popup-content-wrapper { z-index: 5000 !important; }
                .delivery-popup.leaflet-popup-tip { z-index: 5000 !important; }
            `;
            document.head.appendChild(style);
        } catch (e) { /* ignore */ }
    }, []);

    const processedRuntimePolylines = useMemo(() => {
        try {
            if (!runtimePolylines || (typeof runtimePolylines === 'object' && Object.keys(runtimePolylines).length === 0)) return [];
            const items = Array.isArray(runtimePolylines) ? runtimePolylines : (typeof runtimePolylines === 'object' && runtimePolylines !== null ? Object.values(runtimePolylines) : [runtimePolylines]);
            const out = items.map(r => {
                try {
                    const coords = decodePolyline(r) || [];
                    const latlngs = (coords || []).map(c => Array.isArray(c) ? [Number(c[0]), Number(c[1])] : c).filter(p => p && Number.isFinite(p[0]) && Number.isFinite(p[1]));
                    return (latlngs && latlngs.length >= 2) ? latlngs : null;
                } catch (e) { return null; }
            }).filter(Boolean);
            return out;
        } catch (e) { return []; }
    }, [runtimePolylines]);

    // removed processedRotaCoordenadas to avoid noisy logs and fixed test data being rendered

    /* INTERVENÇÃO: Mapa Estabilizado (Removido useMemo que destruía o MapContainer) */

    // 1. Defina a URL do Tile fora para evitar recálculos
    const initialMapboxUrl = token && token.length > 0
        ? `https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/{z}/{x}/{y}?access_token=${token}`
        : `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`;
    
    const [currentTileUrl, setCurrentTileUrl] = useState(initialMapboxUrl);

    // Se o token mudar externamente, reseta a URL
    useEffect(() => {
        setCurrentTileUrl(initialMapboxUrl);
    }, [token, initialMapboxUrl]);

    // 📍 CORREÇÃO MANUAL: atualiza a coordenada do pino no banco após arrastar
    const handleArrastarPino = async (e, id) => {
        try {
            const { lat, lng } = e.target.getLatLng();
            await supabase.from('entregas').update({ lat, lng }).eq('id', id);
            console.log(`📍 Pino ${id} ajustado manualmente para`, { lat, lng });
        } catch (err) {
            console.warn('handleArrastarPino: erro ao atualizar coordenada', err);
        }
    };

    const handleCenterClick = () => {
        try {
            const map = mapRef.current;
            if (!map) return;
            if (gestorPos && Array.isArray(gestorPos)) {
                map.flyTo(gestorPos, 15);
                hasAutoCenteredRef.current = true;
            } else {
                try { map.locate({ setView: true, maxZoom: 15 }); } catch (e) { }
            }
        } catch (e) { /* ignore */ }
    };

    return (
        <div style={{ position: 'relative', width: '100%', height: mobile ? 250 : height }}>
            <MapContainer
                center={[-27.66090, -48.70871]}
                zoom={13}
                accessToken={token}
                maxBounds={[[-27.90, -48.98], [-27.35, -48.30]]}
                scrollWheelZoom={true}
                dragging={true}
                trackResize={true}
                zoomAnimation={true}
                fadeAnimation={true}
                markerZoomAnimation={true}
                style={{ width: '100%', height: '100%' }}
                whenReady={(mapInstance) => { mapRef.current = mapInstance.target; }}
            >
                <Geolocate />

                {/* Ajusta automaticamente os bounds quando entregas ou gestor mudam */}
                <AutoFitBounds gestorPos={gestorPos} entregas={entregaMarkers} />

                <TileLayer
                    url={currentTileUrl}
                    attribution={'© Mapbox © OSM'}
                    tileSize={currentTileUrl.includes('mapbox') ? 512 : 256}
                    zoomOffset={currentTileUrl.includes('mapbox') ? -1 : 0}
                    eventHandlers={{
                        tileerror: (e) => {
                            if (currentTileUrl.includes('mapbox')) {
                                console.warn('⚠️ Falha ao carregar tiles do Mapbox. Verifique o Token. Usando fallback OpenStreetMap.');
                                setCurrentTileUrl('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png');
                            }
                        }
                    }}
                />

                {/* Marcadores de Entregas - HISTÓRICO COMPLETO NO MAPA */}
                {showPins && [...entregaMarkers]
                    .sort((a, b) => {
                        // Ordenar por ordem_logistica; usar id como tiebreaker para garantir
                        // sequência estável quando ordem_logistica for igual, 0 ou nulo
                        const oa = (Number(a.ordem_logistica) > 0) ? Number(a.ordem_logistica) : Number.MAX_SAFE_INTEGER;
                        const ob = (Number(b.ordem_logistica) > 0) ? Number(b.ordem_logistica) : Number.MAX_SAFE_INTEGER;
                        if (oa !== ob) return oa - ob;
                        return (Number(a.id) || 0) - (Number(b.id) || 0);
                    })
                    .map((p, idx) => {
                        // idx+1 da lista ordenada = sequência real que o motorista percorre
                        const numeroMapa = idx + 1;
                        const statusLimpo = String(p.status || '').trim().toLowerCase();

                        // Função para formatar o horário de Brasília (São Paulo)
                        const formatarHorarioBrasil = (dataString) => {
                            if (!dataString) return null;
                            try {
                                const data = new Date(dataString);
                                return data.toLocaleTimeString('pt-BR', {
                                    timeZone: 'America/Sao_Paulo',
                                    hour: '2-digit',
                                    minute: '2-digit'
                                });
                            } catch (e) { return null; }
                        };

                        // Só busca o horário se já foi concluído ou se deu falha
                        const horarioFinal = (statusLimpo === 'entregue' || statusLimpo === 'falha')
                            ? formatarHorarioBrasil(p.horario_conclusao || p.data_conclusao)
                            : null;

                        return (
                            <Marker
                                key={`marker-${p.id}`}
                                position={[parseFloat(p.lat), parseFloat(p.lng)]}
                                icon={createCustomPinIcon(
                                    getMarkerIcon(p.status, p.tipo),
                                    numeroMapa,
                                    p.status
                                )}
                                draggable={statusLimpo === 'pendente'}
                                eventHandlers={{
                                    mouseover: (e) => e.target.openPopup(),
                                    mouseout: (e) => e.target.closePopup(),
                                    dragend: (e) => handleArrastarPino(e, p.id)
                                }}
                            >
                                <Popup className="custom-leaflet-popup" closeButton={false} autoPan={false}>
                                    <div style={{ fontFamily: 'sans-serif', minWidth: '160px' }}>
                                        <strong style={{ fontSize: '14px', display: 'block', marginBottom: '4px' }}>
                                            <span style={{ color: '#2563eb', marginRight: '6px' }}>#{numeroMapa}</span>{p.cliente || 'Pedido'}
                                        </strong>

                                        <div style={{ fontSize: '12px', marginBottom: '2px' }}>
                                            <b>Status:</b> {
                                                statusLimpo === 'entregue' ? '✅ Entregue' :
                                                    statusLimpo === 'falha' ? '❌ Falha' : '⏳ Em rota'
                                            }
                                        </div>

                                        {/* O HORÁRIO SÓ APARECE AQUI SE EXISTIR (FINALIZADOS) */}
                                        {horarioFinal && (
                                            <div style={{ fontSize: '11px', color: '#444', fontWeight: 'bold' }}>
                                                🕒 Finalizado às: {horarioFinal}
                                            </div>
                                        )}

                                        {statusLimpo === 'falha' && p.motivo_nao_entrega && (
                                            <div style={{ fontSize: '11px', color: '#d32f2f', marginTop: '4px' }}>
                                                <b>Motivo:</b> {p.motivo_nao_entrega}
                                            </div>
                                        )}

                                        <div style={{ fontSize: '10px', color: '#888', marginTop: '6px', borderTop: '1px solid #eee', paddingTop: '4px' }}>
                                            📍 {p.endereco}
                                        </div>
                                    </div>
                                </Popup>
                            </Marker>
                        );
                    })}

                {/* popup condicional removido: usamos Hover Popups dentro de cada Marker */}

                {/* Marcadores da Frota (Motos) */}
                {frotaMarkers.map(m => {
                    // Busca a posição atual (suavizada pelo seu ref de display)
                    const disp = lastDisplayedRef.current.get(m.id) || { lat: m.lat, lng: m.lng };

                    // Pega o ângulo atual guardado
                    let currentAngle = lastAnglesRef.current.get(m.id) || 0;

                    // Se a moto se moveu, o sistema deve atualizar o ângulo baseado no trajeto
                    // Isso evita que a moto "teleporte" de direção
                    return (
                        <Marker
                            key={'v10-marker-' + m.id}
                            position={[parseFloat(disp.lat), parseFloat(disp.lng)]}
                            icon={getV10MotoIcon(true, (m.heading || 0), (m.nome || m.title))}
                            zIndexOffset={2000}
                            className="moto-smooth-move"
                        />
                    );
                })}

                {/* Sua posição (Gestor) */}
                {gestorPos && (
                    <Marker position={[parseFloat(gestorPos[0]), parseFloat(gestorPos[1])]} icon={getGestorIcon()}>
                        <Popup>Você está aqui</Popup>
                    </Marker>
                )}
            </MapContainer>

            {/* Botão de Centralizar */}
            <button
                onClick={handleCenterClick}
                style={{ position: 'absolute', top: 12, right: 12, zIndex: 1500, background: '#fff', border: 'none', padding: 8, borderRadius: 8, cursor: 'pointer', boxShadow: '0 2px 6px rgba(0,0,0,0.2)' }}
            >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0f172a" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M12 2v2m0 16v2M4 12H2m20 0h-2" /></svg>
            </button>
        </div>
    );
}

export default MapaLogistica;