import React, { useEffect, useRef, useMemo, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import { MapContainer, TileLayer, Marker, Popup, Polyline, Tooltip, LayersControl, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import polyline from 'polyline';
import { supabase } from './supabaseClient';
import createCustomPinIcon from './CustomPin.jsx';

const token = import.meta.env.VITE_MAPBOX_TOKEN || '';

// Safety helper: Santa Catarina bounds (manager requested)
const isValidSC = (lat, lng) => {
    if (lat == null || lng == null) return false;
    const latN = Number(lat); const lngN = Number(lng);
    if (!Number.isFinite(latN) || !Number.isFinite(lngN)) return false;
    // ✅ Santo Amaro da Imperatriz: Lat até -28.20
    return (latN < -25.0 && latN > -28.20 && lngN > -50.0 && lngN < -48.0);
};

function MapaLogistica({ entregas = [], frota = [], height = 500, mobile = false, focusCoords = null, motoristaDaRota = null, runtimePolylines = {}, clearMap = false, darkMode = undefined }) {
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

    // Local copy of entregas so the map can react to realtime updates
    const [localEntregas, setLocalEntregas] = useState(entregas || []);
    useEffect(() => setLocalEntregas(entregas || []), [entregas]);

    // control visual clearing of pins (does not delete from DB)
    const [showPins, setShowPins] = useState(true);
    useEffect(() => setShowPins(!clearMap), [clearMap]);

    // subscribe to Supabase realtime updates for `entregas` to reflect status changes immediately
    useEffect(() => {
        try {
            const channel = supabase.channel('public:entregas')
                .on('postgres_changes', { event: '*', schema: 'public', table: 'entregas' }, (payload) => {
                    try {
                        // support payload.new (insert/update), payload.old (delete) and payload.record
                        const rec = payload.new || payload.record || payload.old || null;
                        if (!rec) return;

                        // Normalize status and ignore concluded/failure deliveries
                        let st = '';
                        try { st = String(rec.status || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim(); } catch (err) { st = String(rec.status || '').toLowerCase(); }

                        // If the incoming record is concluded or failed, remove it from local list
                        if (st === 'concluido' || st === 'falha') {
                            try {
                                setLocalEntregas(prev => {
                                    const idx = (prev || []).findIndex(p => p && p.id === rec.id);
                                    if (idx === -1) return prev;
                                    const cp = [...prev]; cp.splice(idx, 1); return cp;
                                });
                            } catch (e) { /* ignore */ }
                            return;
                        }

                        // Otherwise insert or update the local list
                        setLocalEntregas(prev => {
                            try {
                                const i = (prev || []).findIndex(p => p && p.id === rec.id);
                                // if deleted (no new), remove from list when necessary
                                if (payload.event === 'DELETE' || (payload.old && !payload.new)) {
                                    if (i === -1) return prev;
                                    const cp = [...prev]; cp.splice(i, 1); return cp;
                                }
                                if (i === -1) {
                                    // not found: append (new insert)
                                    return [...(prev || []), rec];
                                }
                                const copy = [...prev];
                                copy[i] = { ...copy[i], ...rec };
                                return copy;
                            } catch (e) { return prev || []; }
                        });
                    } catch (e) { /* ignore */ }
                });
            // subscribe
            channel.subscribe?.();
            return () => {
                try { channel.unsubscribe?.(); supabase.removeChannel?.(channel); } catch (e) { }
            };
        } catch (e) { /* ignore */ }
    }, []);

    // build marker lists
    // Memoize markers to avoid re-computation each render
    // ❌ TRAVA FÍSICA: Filtrar coordenadas inválidas (0,0) ou nulas
    const entregaMarkers = React.useMemo(() => {
        try {
            // include only relevant entregas: exclude those with status 'Concluído' or 'falha'
            const list = (localEntregas || []).filter(e => {
                if (!e) return false;
                try {
                    const st = String(e.status || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
                    if (st === 'concluido' || st === 'falha') return false;
                } catch (err) {
                    // If normalization fails, do a safe lowercase compare as fallback
                    const sf = String(e.status || '').toLowerCase();
                    if (sf.includes('concl') || sf.includes('falha')) return false;
                }
                return true;
            });
            return list.map(e => ({
                id: e.id,
                lat: Number(e.lat),
                lng: Number(e.lng),
                endereco: e.endereco || e.address || '',
                cliente: e.cliente,
                tipo: e.tipo,
                status: e.status,
                obs: e.obs || e.observacoes || '',
                ordem_logistica: e.ordem_logistica,
                tipo_recebedor: e.tipo_recebedor
            })).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng) && !(p.lat === 0 && p.lng === 0));
        } catch (e) { return []; }
    }, [localEntregas]);

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
                            currentAngle = calcularAngulo(prevCoords.lat, prevCoords.lng, latN, lngN);
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

    // Função para calcular o ângulo (bearing) entre dois pontos
    const calcularAngulo = (lat1, lon1, lat2, lon2) => {
        const dLon = (lon2 - lon1) * (Math.PI / 180);
        const y = Math.sin(dLon) * Math.cos(lat2 * (Math.PI / 180));
        const x = Math.cos(lat1 * (Math.PI / 180)) * Math.sin(lat2 * (Math.PI / 180)) -
            Math.sin(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.cos(dLon);
        return (Math.atan2(y, x) * (180 / Math.PI) + 360) % 360;
    };

    // Gera o ícone da moto limpo: usa estrutura específica com aura, imagem e nome do motorista
    function getV10MotoIcon(online, angulo = 0, nome = '') {
        const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const safeName = esc(nome);
        // usar caminho absoluto root para /moto.png (garante consistência de deploy)
        const motoSrc = '/moto.png';
        const html = `
    <div style="width:60px;height:80px;position:relative;display:block;pointer-events:auto;">
        <div style="position:absolute;left:50%;bottom:0;transform:translateX(-50%);display:flex;align-items:flex-end;justify-content:center;">
            <div style="position: absolute; width: 45px; height: 45px; background: rgba(255, 0, 0, 0.4); border-radius: 50%; filter: blur(4px); z-index: 1; bottom: 6px;">
            </div>
            <img src="${motoSrc}" style="width:50px;height:50px;transform:rotate(${angulo}deg);z-index:2;" />
            <div style="position:absolute;top:-20px;background:rgba(0,0,0,0.8);color:white;padding:2px 8px;border-radius:10px;font-size:11px;white-space:nowrap;z-index:3;">${safeName}</div>
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

    const mapInner = useMemo(() => {
        try {
            const mapboxUrl = token && token.length > 0
                ? `https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/{z}/{x}/{y}?access_token=${token}`
                : `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`;
            const initialCenter = [computedCenter.lat, computedCenter.lng];

            return (
                <MapContainer center={initialCenter} zoom={12} style={mapStyle} whenCreated={handleLoad}>
                    <Geolocate />
                    {token ? (
                        <LayersControl position="topright">
                            <LayersControl.BaseLayer name="Modo Noturno" checked>
                                <TileLayer
                                    url={`https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/{z}/{x}/{y}?access_token=${token}`}
                                    attribution={'© Mapbox'}
                                    tileSize={512}
                                    zoomOffset={-1}
                                    maxZoom={20}
                                />
                            </LayersControl.BaseLayer>
                            <LayersControl.BaseLayer name="Modo Rua">
                                <TileLayer
                                    url={`https://api.mapbox.com/styles/v1/mapbox/outdoors-v12/tiles/{z}/{x}/{y}?access_token=${token}`}
                                    attribution={'© Mapbox'}
                                    tileSize={512}
                                    zoomOffset={-1}
                                    maxZoom={20}
                                    detectRetina={true}
                                    opacity={1}
                                />
                            </LayersControl.BaseLayer>
                        </LayersControl>
                    ) : (
                        <TileLayer url={mapboxUrl} attribution={'© OpenStreetMap contributors'} tileSize={256} zoomOffset={0} />
                    )}

                    {/* Delivery markers: show pendente and em_rota */}
                    {showPins && entregaMarkers.map((p, idx) => {
                        const tipo = normalizeText(p.tipo || '');
                        const status = normalizeText(p.status || '');
                        // V138: prioritize status -> delivered/finalized (green), failure (red)
                        // otherwise color by tipo (entrega=blue, recolha=orange). Default to lilac only if unknown
                        let color = '#a855f7'; // default lilás (Outros)
                        if (status.includes('entreg') || status.includes('conclu')) {
                            color = '#22c55e';
                        } else if (status.includes('falha')) {
                            color = '#ef4444';
                        } else if (tipo.includes('entrega')) {
                            color = '#2563eb';
                        } else if (tipo.includes('recolha')) {
                            color = '#f97316';
                        } else {
                            color = '#a855f7';
                        }
                        const numero = (p.ordem_logistica != null && p.ordem_logistica !== '') ? p.ordem_logistica : (idx + 1);
                        const row = {
                            ...p,
                            status: p.status != null ? p.status : '',
                            motivo_nao_entrega: p.motivo_nao_entrega || p.motivo_falha || p.motivo || '',
                            recebedor: p.recebedor || '',
                            horario_conclusao: p.horario_conclusao || '',
                            data_conclusao: p.data_conclusao || ''
                        };

                        // determine tipo label based on pin color (unchanged colors)
                        let tipoLabel = 'Entrega';
                        if (color === '#f97316') tipoLabel = 'Recolha';
                        else if (color === '#a855f7') tipoLabel = 'Outros';

                        // status string shown raw (fallback to placeholder)
                        const statusText = row.status && String(row.status).trim() !== '' ? row.status : 'Desconhecido';
                        const stNorm = normalizeText(row.status);

                        // motivo fallback
                        const motivoText = row.motivo_nao_entrega || row.tipo_recebedor || 'Motivo não informado';

                        return (
                            <Marker key={`entrega-${p.id || idx}`} position={[Number(p.lat), Number(p.lng)]} icon={createCustomPinIcon(color, numero, p.status)}>
                                <Popup className="delivery-popup">
                                    <div style={{ fontWeight: 800 }}>{row.cliente || 'Sem cliente'}</div>
                                    <div style={{ marginTop: 6 }}><strong>Endereço:</strong> {row.endereco || ''}</div>
                                    <div><strong>Tipo:</strong> {tipoLabel}</div>
                                    <p><strong>Status:</strong> {statusText}</p>
                                    <p><strong>Horário:</strong> {row.horario_conclusao ? new Date(row.horario_conclusao).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) : (row.data_conclusao ? new Date(row.data_conclusao).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) : '---')}</p>
                                    {stNorm.includes('falha') && <p><strong>Motivo:</strong> {motivoText}</p>}
                                </Popup>
                            </Marker>
                        );
                    })}

                    {/* Route polylines: responsive to map mode (dark -> white with glow, light -> black) */}
                    {(() => {
                        try {
                            if (!runtimePolylines) return null;
                            const items = Array.isArray(runtimePolylines) ? runtimePolylines : (typeof runtimePolylines === 'object' && runtimePolylines !== null ? Object.values(runtimePolylines) : [runtimePolylines]);
                            return items.map((r, ri) => {
                                const coords = decodePolyline(r) || [];
                                if (!coords || coords.length < 2) return null;
                                // Ensure lat/lng pairs
                                const latlngs = coords.map(c => Array.isArray(c) ? [Number(c[0]), Number(c[1])] : c);
                                // Determine theme: prefer explicit `darkMode` prop when provided,
                                // otherwise fallback to internal `mapMode` (token-based).
                                const isDark = (typeof darkMode === 'boolean') ? darkMode : (mapMode === 'dark');

                                if (isDark) {
                                    return (
                                        <React.Fragment key={`route-${ri}`}>
                                            <Polyline positions={latlngs} pathOptions={{ color: '#ffffff', weight: 10, opacity: 0.12 }} />
                                            <Polyline positions={latlngs} pathOptions={{ color: '#ffffff', weight: 4, opacity: 0.8 }} />
                                        </React.Fragment>
                                    );
                                }
                                // Light mode: ensure polyline color is black per request
                                return <Polyline key={`route-${ri}`} positions={latlngs} pathOptions={{ color: '#000000', weight: 4, opacity: 0.8 }} />;
                            });
                        } catch (e) { return null; }
                    })()}

                    {/* Frota (drivers) markers */}
                    {frotaMarkers.map(m => {
                        const target = lastCoordsRef.current.get(m.id) || { lat: m.lat, lng: m.lng };
                        const disp = lastDisplayedRef.current.get(m.id) || target;
                        return (
                            <Marker
                                key={'v10-marker-' + m.id}
                                position={[Number(disp.lat), Number(disp.lng)]}
                                icon={getV10MotoIcon(true, lastAnglesRef.current.get(m.id) || 0, m.title)}
                                zIndexOffset={2000}
                            />
                        );
                    })}

                    {/* Gestor (you) marker */}
                    {gestorPos && (
                        <Marker position={gestorPos} icon={getGestorIcon()}>
                            <Popup>Você está aqui</Popup>
                        </Marker>
                    )}
                    {/* Focus marker disabled for deliveries — kept only for manual testing */}
                    {focusMarker && (
                        <Marker position={[focusMarker.lat, focusMarker.lng]} icon={createPinIcon('search', 'selected', null)}>
                            <Popup>Destino selecionado</Popup>
                        </Marker>
                    )}
                </MapContainer>
            );
        } catch (e) {
            console.warn('Leaflet temporariamente indisponível (map render)', e);
            return <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af' }}>Carregando Mapa...</div>;
        }
    }, [mapStyle, computedCenter, frotaMarkers, localEntregas, showPins, mapMode, runtimePolylines]);

    const handleCenterClick = () => {
        try {
            const map = mapRef.current;
            if (!map) return;
            if (gestorPos && Array.isArray(gestorPos)) {
                map.flyTo(gestorPos, 15);
                hasAutoCenteredRef.current = true;
            } else {
                // try to re-locate and center
                try { map.locate({ setView: true, maxZoom: 15 }); } catch (e) { }
            }
        } catch (e) { /* ignore */ }
    };

    return (
        <div style={{ position: 'relative', width: '100%', height: mobile ? 250 : height }}>
            {mapInner}
            <button onClick={handleCenterClick} title="Minha localização" style={{ position: 'absolute', top: 12, right: 12, zIndex: 1500, background: '#ffffffcc', border: 'none', padding: 8, borderRadius: 8, cursor: 'pointer', boxShadow: '0 2px 6px rgba(0,0,0,0.2)' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 8a4 4 0 100 8 4 4 0 000-8z" stroke="#0f172a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M17.7 6.3l1.4-1.4M4.9 19.1l1.4-1.4" stroke="#0f172a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
        </div>
    );
}

export default MapaLogistica;