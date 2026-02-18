import React, { useEffect, useRef, useMemo, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import { MapContainer, TileLayer, Marker, Popup, Polyline, Tooltip, LayersControl, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import polyline from 'polyline';
import { supabase } from './supabaseClient';

const token = import.meta.env.VITE_MAPBOX_TOKEN || '';

// Safety helper: Santa Catarina bounds (manager requested)
const isValidSC = (lat, lng) => {
    if (lat == null || lng == null) return false;
    const latN = Number(lat); const lngN = Number(lng);
    if (!Number.isFinite(latN) || !Number.isFinite(lngN)) return false;
    // ✅ Santo Amaro da Imperatriz: Lat até -28.20
    return (latN < -25.0 && latN > -28.20 && lngN > -50.0 && lngN < -48.0);
};

function MapaLogistica({ entregas = [], frota = [], height = 500, mobile = false, focusCoords = null }) {
    const mapRef = useRef(null);
    // cache último posicionamento conhecido por motorista (id -> {lat,lng,ultima_atualizacao})
    const lastCoordsRef = useRef(new Map());
    // cache último ângulo de cada motorista (id -> angulo)
    const lastAnglesRef = useRef(new Map());
    const [dbEntregas, setDbEntregas] = useState([]);
    const [gestorPos, setGestorPos] = useState(null);
    const [focusMarker, setFocusMarker] = useState(null);

    // build marker lists
    // Memoize markers to avoid re-computation each render
    // ❌ TRAVA FÍSICA: Filtrar coordenadas inválidas (0,0) ou nulas
    const entregaMarkers = React.useMemo(() => (entregas || [])
        .filter(e => {
            if (!e || e.lat == null || e.lng == null) return false;
            const lat = Number(e.lat);
            const lng = Number(e.lng);
            // ❌ EXTERMINAR pinos em (0,0) ou coordenadas inválidas
            if (lat === 0 || lng === 0) return false;
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
            return isValidSC(lat, lng);
        })
        .map(e => ({
            id: e.id,
            lat: Number(e.lat),
            lng: Number(e.lng),
            label: (e.ordem_logistica && Number(e.ordem_logistica) > 0) ? String(Number(e.ordem_logistica)) : null,
            title: e.cliente || e.endereco
        })), [entregas]);

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
            const points = [...entregaMarkers.map(p => ({ lat: p.lat, lng: p.lng })), ...frotaMarkers.map(p => ({ lat: p.lat, lng: p.lng }))];
            if (!points || points.length === 0) {
                try { inst.setView([-27.5969, -48.5495], 12); } catch (e) { }
                return;
            }
            try {
                const bounds = L.latLngBounds(points.map(pt => L.latLng(Number(pt.lat), Number(pt.lng))));
                inst.fitBounds(bounds, { padding: [80, 80] });
            } catch (e) { /* ignore */ }
        } catch (e) { /* ignore */ }
    };

    // Quando `focusCoords` externo mudar, faz flyTo e marca temporariamente
    // (o App passa `enderecoCoords` como prop para solicitar o foco)

    const mapStyle = { width: '100%', height: mobile ? 250 : height };

    // Determine safe center: prefer fleet first, then entregas, fallback to Florianópolis
    const defaultCenter = { lat: -27.2423, lng: -50.2188 }; // Santa Catarina fixed default center
    const computedCenter = useMemo(() => {
        const firstFleet = (frotaMarkers && frotaMarkers.length > 0) ? frotaMarkers[0] : null;
        const firstEntrega = (!firstFleet && entregaMarkers && entregaMarkers.length > 0) ? entregaMarkers[0] : null;
        const candidate = firstFleet || firstEntrega || defaultCenter;
        const lat = Number(candidate.lat);
        const lng = Number(candidate.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return defaultCenter;
        return { lat, lng };
    }, [frotaMarkers, entregaMarkers]);

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
            // APENAS ajustar bounds na primeira renderização, nunca mais (evita re-centralização quando motoristas piscam)
            if (hasInitializedBoundsRef.current) return;

            const key = JSON.stringify({ e: entregaMarkers.map(p => ({ id: p.id, lat: p.lat, lng: p.lng })), f: frotaMarkers.map(p => ({ id: p.id, lat: p.lat, lng: p.lng })) });
            if (key === lastPointsKeyRef.current) return; // nothing changed
            lastPointsKeyRef.current = key;
            if (!mapRef.current) return;
            const inst = mapRef.current;
            const points = [...entregaMarkers.map(p => ({ lat: p.lat, lng: p.lng })), ...frotaMarkers.map(p => ({ lat: p.lat, lng: p.lng }))];
            if (!points || points.length === 0) {
                try { inst.setView([defaultCenter.lat, defaultCenter.lng], 12); } catch (e) { }
                hasInitializedBoundsRef.current = true;
                return;
            }
            try {
                const bounds = L.latLngBounds(points.map(pt => L.latLng(Number(pt.lat), Number(pt.lng))));
                inst.fitBounds(bounds, { padding: [80, 80] });
                hasInitializedBoundsRef.current = true;
            } catch (e) { /* ignore */ }
        } catch (e) { /* ignore */ }
    }, [entregaMarkers, frotaMarkers]);

    // Helper: create pin icon for entregas (blue circle with white number)
    function createPinIcon(tipo, status, num = null) {
        const bg = '#2563eb'; // blue
        const html = `
            <div style="width:38px;height:38px;border-radius:50%;background:${bg};display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900;font-size:14px;box-shadow:0 2px 4px rgba(0,0,0,0.4);">
                ${num || ''}
            </div>
        `;
        return L.divIcon({ html, className: 'custom-pin-point', iconSize: [38, 38], iconAnchor: [19, 38], popupAnchor: [0, -38] });
    }

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
        const html = `
<div style="position: relative; width: 60px; height: 60px; display: flex; justify-content: center; align-items: center;">
  <div style="position: absolute; width: 45px; height: 45px; background: rgba(255, 0, 0, 0.4); border-radius: 50%; filter: blur(4px); z-index: 1;"></div>
  <img src="/moto.png" style="position: absolute; width: 50px; height: 50px; transform: rotate(${angulo}deg); z-index: 2; opacity: 1;" />
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

    // Fetch persisted rota_polyline entries and subscribe to realtime updates
    useEffect(() => {
        // 1. Busca inicial
        const fetchRotas = async () => {
            try {
                const { data } = await supabase
                    .from('entregas')
                    .select('id, motorista_id, rota_polyline, status')
                    .eq('status', 'em_rota');
                if (data) setDbEntregas(data);
            } catch (e) {
                console.warn('Erro ao buscar rota_polyline (inicial):', e);
            }
        };

        fetchRotas();

        // 2. ⚡ VIGÍLIA EM TEMPO REAL (o pulo do gato)
        const subscription = supabase
            .channel('mapa-rotas')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'entregas' }, () => {
                fetchRotas();
                // Limpeza de IDs de motoristas que sumiram do realtime
                const idsAtuais = new Set((frota || []).map(m => m && m.id));
                Array.from(lastCoordsRef.current.keys()).forEach(id => {
                    if (!idsAtuais.has(id)) {
                        lastCoordsRef.current.delete(id);
                        lastAnglesRef.current && lastAnglesRef.current.delete(id);
                    }
                });
            })
            .subscribe();

        return () => { try { subscription.unsubscribe(); } catch (e) { /* ignore */ } };
    }, [frota]);

    // Build polylines per motorista from entregas (only 'em_rota' and with rota_polyline)
    const polylinesByMotorista = useMemo(() => {
        const map = new Map();
        const source = (dbEntregas && dbEntregas.length > 0) ? dbEntregas : (entregas || []);
        source.forEach(e => {
            try {
                const status = String(e.status || '').toLowerCase().trim();
                if (status !== 'em_rota') return;
                if (!e.rota_polyline) return;
                const mid = e.motorista_id != null ? String(e.motorista_id) : '_unassigned';
                const coords = decodePolyline(e.rota_polyline);
                if (!coords || coords.length === 0) return;
                // Normalize [lng,lat] -> [lat,lng] if necessary
                const first = coords[0];
                if (Array.isArray(first) && first.length >= 2) {
                    const a = Number(first[0]), b = Number(first[1]);
                    if (Math.abs(a) > 90 && Math.abs(b) <= 90) {
                        coords.forEach((c, idx) => coords[idx] = [Number(c[1]), Number(c[0])]);
                    } else {
                        coords.forEach((c, idx) => coords[idx] = [Number(c[0]), Number(c[1])]);
                    }
                }
                // Keep only one poly per motorista (first wins)
                if (!map.has(mid)) map.set(mid, coords);
            } catch (e) { /* ignore per-entry */ }
        });
        return map; // Map motoristId -> coords
    }, [entregas, dbEntregas]);

    // Focus on Leandro's route when available (executa apenas uma vez)
    const hasFocusedLeandroRef = useRef(false);
    useEffect(() => {
        try {
            if (hasFocusedLeandroRef.current) return;
            const leandro = (frota || []).find(m => m && m.nome && String(m.nome).toLowerCase().includes('leandro'));
            if (!leandro || !leandro.id) return;
            const mid = String(leandro.id);
            const coords = polylinesByMotorista.get(mid);
            if (coords && coords.length > 0 && mapRef.current) {
                try {
                    const bounds = L.latLngBounds(coords.map(c => L.latLng(Number(c[0]), Number(c[1]))));
                    mapRef.current.fitBounds(bounds, { padding: [60, 60] });
                    hasFocusedLeandroRef.current = true;
                } catch (e) { /* ignore fit errors */ }
            }
        } catch (e) { /* ignore */ }
    }, [polylinesByMotorista, frota]);

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

    const mapInner = useMemo(() => {
        try {
            const mapboxUrl = token && token.length > 0
                ? `https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/{z}/{x}/{y}?access_token=${token}`
                : `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`;
            // center on motorista Leandro if available
            const leandro = (frota || []).find(m => m && m.nome && String(m.nome).toLowerCase().includes('leandro') && m.lat != null && m.lng != null);
            const initialCenter = leandro && Number(leandro.lat) && Number(leandro.lng) ? [Number(leandro.lat), Number(leandro.lng)] : [computedCenter.lat, computedCenter.lng];

            return (
                <MapContainer center={initialCenter} zoom={12} style={mapStyle} whenCreated={handleLoad}>
                    {/* Geolocation: locate user and set marker */}
                    <Geolocate />
                    {/* SearchBox was moved to the Nova Carga form; no floating search here */}
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

                    {/* Frota (drivers) markers */}
                    {frotaMarkers.map(m => {
                        if (!(m.online === true || String(m.esta_online) === 'true')) return null;
                        // Recupera última posição conhecida
                        const cache = lastCoordsRef.current.get(m.id);
                        let angulo = 0;
                        let lastAngle = lastAnglesRef.current.get(m.id) || 0;
                        if (cache && (cache.lat !== m.lat || cache.lng !== m.lng)) {
                            angulo = calcularAngulo(cache.lat, cache.lng, m.lat, m.lng);
                            lastAnglesRef.current.set(m.id, angulo);
                        } else {
                            angulo = lastAngle;
                        }
                        if (!m.lat || !m.lng) return null;
                            // Use posição mais recente do cache quando disponível para vincular ao estado real-time
                            const pos = lastCoordsRef.current.get(m.id) || { lat: m.lat, lng: m.lng };
                            return (
                                <Marker
                                    key={'v10-marker-' + m.id}
                                    position={[Number(pos.lat), Number(pos.lng)]}
                                    icon={getV10MotoIcon(m.online, angulo, m.title)}
                                />
                            );
                    })}

                    {/* Entrega markers */}
                    {entregaMarkers.map((p, i) => (
                        <Marker key={`e-${p.id || i}`} position={[p.lat, p.lng]} icon={createPinIcon('entrega', 'em_rota', p.label || (i + 1))}>
                            <Tooltip permanent direction="top" offset={[0, -42]} className="pin-tooltip" opacity={0.98}>
                                <span style={{ fontWeight: '600', fontSize: '12px' }}>{p.title}</span>
                            </Tooltip>
                        </Marker>
                    ))}

                    {Array.from(polylinesByMotorista.entries()).map(([mid, coords], idx) => (
                        Array.isArray(coords) && coords.length > 0 ? (
                            <Polyline key={`poly-${idx}-${dbEntregas.length}`} positions={coords} pathOptions={{ color: '#2563eb', weight: 7, opacity: 1, lineJoin: 'round' }} />
                        ) : null
                    ))}
                    {/* Gestor (you) marker */}
                    {gestorPos && (
                        <Marker position={gestorPos} icon={getGestorIcon()}>
                            <Popup>Você está aqui</Popup>
                        </Marker>
                    )}
                    {/* Marcador temporário solicitado pelo formulário de Nova Carga */}
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
    }, [mapStyle, computedCenter, entregaMarkers, frotaMarkers, polylinesByMotorista, dbEntregas]);

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