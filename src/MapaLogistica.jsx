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

function MapaLogistica({ entregas = [], frota = [], height = 500, mobile = false, focusCoords = null, motoristaDaRota = null, runtimePolylines = {}, clearMap = false }) {
    const mapRef = useRef(null);
    // cache último posicionamento conhecido por motorista (id -> {lat,lng,ultima_atualizacao})
    const lastCoordsRef = useRef(new Map());
    // cache último ângulo de cada motorista (id -> angulo)
    const lastAnglesRef = useRef(new Map());
    // No delivery state kept here in emergency mode — map will render only fleet markers
    const [gestorPos, setGestorPos] = useState(null);
    const [focusMarker, setFocusMarker] = useState(null);

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
                        setLocalEntregas(prev => {
                            const i = prev.findIndex(p => p && p.id === rec.id);
                            // if deleted (no new), remove from list when necessary
                            if (payload.event === 'DELETE' || (payload.old && !payload.new)) {
                                if (i === -1) return prev;
                                const cp = [...prev]; cp.splice(i, 1); return cp;
                            }
                            if (i === -1) {
                                // not found: append (new insert) or just return prev
                                return [...prev, rec];
                            }
                            const copy = [...prev];
                            copy[i] = { ...copy[i], ...rec };
                            return copy;
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
            // include 'falha' explicitly so failures render on the map
            const list = (localEntregas || []).filter(e => e && ['pendente', 'em_rota', 'concluido', 'entregue', 'falha'].includes(String(e.status || '').toLowerCase()));
            return list.map(e => ({
                id: e.id,
                lat: Number(e.lat),
                lng: Number(e.lng),
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

            // ✅ Força a exclusão se o status não for 'true' (string ou boolean)
            const isOnline = String(m.esta_online) === 'true';

            if (isOnline && m.lat && m.lng) {
                const latN = Number(m.lat);
                const lngN = Number(m.lng);

                if (Number.isFinite(latN) && latN !== 0 && isValidSC(latN, lngN)) {
                    // compute angle based on previous coords (if available) before updating cache
                    try {
                        const prev = lastCoordsRef.current.get(m.id);
                        let ang = lastAnglesRef.current.get(m.id) || 0;
                        if (prev && prev.lat != null && prev.lng != null && (prev.lat !== latN || prev.lng !== lngN)) {
                            ang = calcularAngulo(prev.lat, prev.lng, latN, lngN);
                            lastAnglesRef.current.set(m.id, ang);
                        }
                    } catch (e) { /* ignore */ }
                    // Atualiza cache apenas de quem está online de fato
                    lastCoordsRef.current.set(m.id, { lat: latN, lng: lngN });
                    out.push({ id: m.id, lat: latN, lng: lngN, title: m.nome || 'Motorista', online: true });
                }
            } else {
                // Se deslogou ou ficou offline, garante que sumiu do cache
                lastCoordsRef.current.delete(m.id);
            }
        });
        return out;
    }, [frota]);

    // On load: center or fit bounds (Leaflet)
    const handleLoad = (mapInstance) => {
        try {
            const inst = mapInstance;
            mapRef.current = inst;
            const points = [...frotaMarkers.map(p => ({ lat: p.lat, lng: p.lng }))];
            if (!points || points.length === 0) {
                try { inst.setView([-27.5969, -48.5495], 12); } catch (e) { }
                return;
            }
            try {
                const bounds = L.latLngBounds(points.map(pt => L.latLng(Number(pt.lat), Number(pt.lng))));
                inst.fitBounds(bounds, { padding: [50, 50], maxZoom: 15, animate: false });
            } catch (e) { /* ignore */ }
        } catch (e) { /* ignore */ }
    };

    // Quando `focusCoords` externo mudar, faz flyTo e marca temporariamente
    // (o App passa `enderecoCoords` como prop para solicitar o foco)

    const mapStyle = { width: '100%', height: mobile ? 250 : height };

    // Determine safe center: prefer fleet first, fallback to default center
    const defaultCenter = { lat: -27.2423, lng: -50.2188 }; // Santa Catarina fixed default center
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
            const key = JSON.stringify({ f: frotaMarkers.map(p => ({ id: p.id, lat: p.lat, lng: p.lng })) });
            if (key === lastPointsKeyRef.current) return; // nothing changed
            lastPointsKeyRef.current = key;
            if (!mapRef.current) return;
            const inst = mapRef.current;
            const points = [...frotaMarkers.map(p => ({ lat: p.lat, lng: p.lng }))];
            if (!points || points.length === 0) {
                try { inst.setView([defaultCenter.lat, defaultCenter.lng], 12); } catch (e) { }
                return;
            }
            try {
                const bounds = L.latLngBounds(points.map(pt => L.latLng(Number(pt.lat), Number(pt.lng))));
                inst.fitBounds(bounds, { padding: [50, 50], maxZoom: 15, animate: false });
            } catch (e) { /* ignore */ }
        } catch (e) { /* ignore */ }
    }, [frotaMarkers]);

    // Helper: create pin icon for entregas (blue circle with white number)
    // use createCustomPinIcon from src/CustomPin.jsx

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
<div style="position: relative; width: 60px; height: 60px; display: flex; justify-content: center; align-items: center;">
    <div style="position: absolute; width: 45px; height: 45px; background: rgba(255, 0, 0, 0.4); border-radius: 50%; filter: blur(4px); z-index: 1;"></div>
    <img src="${motoSrc}" style="position: absolute; width: 50px; height: 50px; transform: rotate(${angulo}deg); z-index: 2; opacity: 1;" />
    <div style="position: absolute; top: -20px; background: rgba(0,0,0,0.8); color: white; padding: 2px 8px; border-radius: 10px; font-size: 11px; white-space: nowrap; z-index: 3;">${safeName}</div>
</div>`;
        return L.divIcon({
            html,
            className: 'moto-icon-limpo',
            iconSize: [60, 60],
            iconAnchor: [30, 30]
        });
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
                        setGestorPos([lat, lng]);
                        if (!hasAutoCenteredRef.current) {
                            try { map.flyTo(e.latlng, 15); } catch (err) { }
                            hasAutoCenteredRef.current = true;
                        }
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
                        const tipoRaw = String(p.tipo || '');
                        const tipo = tipoRaw.trim().toLowerCase();
                        const statusRaw = String(p.status || '');
                        const status = statusRaw.trim().toLowerCase();
                        // Order of checks: FAIL first, then exact delivered/concluded, then pending/em_rota color by type
                        let color = '#a855f7'; // default lilás (Outros)
                        if (status === 'falha') {
                            // Always red on failure, regardless of type
                            color = '#ef4444';
                        } else if (status === 'entregue' || status === 'concluido') {
                            // Only green for explicit delivered/concluded
                            color = '#22c55e';
                        } else if (status === 'pendente' || status === 'em_rota') {
                            // Pending/in-route: color by tipo
                            if (tipo === 'entrega') color = '#2563eb';
                            else if (tipo === 'recolha') color = '#f97316';
                            else color = '#a855f7';
                        } else {
                            // any other status: keep neutral lilac
                            color = '#a855f7';
                        }
                        const numero = (p.ordem_logistica != null && p.ordem_logistica !== '') ? p.ordem_logistica : (idx + 1);
                        return (
                            <Marker key={`entrega-${p.id || idx}`} position={[Number(p.lat), Number(p.lng)]} icon={createCustomPinIcon(color, numero, p.status)}>
                                <Popup>
                                    <div style={{ fontWeight: 800 }}>{p.cliente || 'Sem cliente'}</div>
                                    <div style={{ marginTop: 6 }}><strong>Status:</strong> {
                                        (status === 'pendente' || status === 'em_rota') ? '🕒 Em progresso' :
                                            (status === 'entregue' || status === 'concluido') ? '✅ Concluído com êxito' :
                                                (status === 'falha') ? '❌ Falha na operação' : status
                                    }</div>
                                    {status === 'falha' && (
                                        <div style={{ marginTop: 6 }}><strong>Motivo:</strong> {p.motivo_nao_entrega || p.motivo || 'Não informado'}</div>
                                    )}
                                    <div style={{ marginTop: 6 }}><strong>Tipo:</strong> {p.tipo || 'Entrega'}</div>
                                    <div style={{ marginTop: 6 }}><strong>Obs:</strong> {p.obs || ''}</div>
                                </Popup>
                            </Marker>
                        );
                    })}

                    {/* Frota (drivers) markers */}
                    {frotaMarkers.map(m => {
                        const pos = lastCoordsRef.current.get(m.id) || { lat: m.lat, lng: m.lng };
                        return (
                            <Marker
                                key={'v10-marker-' + m.id}
                                position={[Number(pos.lat), Number(pos.lng)]}
                                icon={getV10MotoIcon(true, lastAnglesRef.current.get(m.id) || 0, m.title)}
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
    }, [mapStyle, computedCenter, frotaMarkers]);

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