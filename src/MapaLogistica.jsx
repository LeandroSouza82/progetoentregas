import React, { useEffect, useRef, useMemo } from 'react';
import { Map, AdvancedMarker, APIProvider } from '@vis.gl/react-google-maps';

const GOOGLE_MAPS_API_KEY = (typeof import.meta !== 'undefined' && import.meta.env) ? (import.meta.env.VITE_GOOGLE_MAPS_KEY || 'AIzaSyBeec8r4DWBdNIEFSEZg1CgRxIHjYMV9dM') : 'AIzaSyBeec8r4DWBdNIEFSEZg1CgRxIHjYMV9dM';

// Safety helper: Santa Catarina bounds (manager requested)
const isValidSC = (lat, lng) => {
    if (lat == null || lng == null) return false;
    const latN = Number(lat); const lngN = Number(lng);
    if (!Number.isFinite(latN) || !Number.isFinite(lngN)) return false;
    return (latN < -25.0 && latN > -30.0 && lngN < -54.0 && lngN > -48.0);
};

function MapaLogistica({ entregas = [], frota = [], height = 500, mobile = false }) {
    const mapRef = useRef(null);

    // build marker lists
    // Memoize markers to avoid re-computation each render
    const entregaMarkers = React.useMemo(() => (entregas || []).filter(e => e && e.lat != null && e.lng != null && isValidSC(Number(e.lat), Number(e.lng))).map(e => ({ id: e.id, lat: Number(e.lat), lng: Number(e.lng), label: (e.ordem_logistica && Number(e.ordem_logistica) > 0) ? String(Number(e.ordem_logistica)) : null, title: e.cliente || e.endereco })), [entregas]);

    // Show any passed fleet items that have valid SC coords — do not hide the moto if offline; ensures a stable, fixed icon
    const frotaMarkers = React.useMemo(() => (frota || []).filter(m => m && m.lat != null && m.lng != null && isValidSC(Number(m.lat), Number(m.lng))).map(m => ({ id: m.id, lat: Number(m.lat), lng: Number(m.lng), title: ((m && (m.nome || '') ? (String(m.nome).trim() + (m.sobrenome ? ' ' + String(m.sobrenome).trim() : '')).trim() : 'Motorista')) })), [frota]);

    // On load: center or fit bounds
    const handleLoad = (m) => {
        try {
            const inst = (m && (m.map || m.__map || m)) || m;
            mapRef.current = inst;
            const points = [...entregaMarkers.map(p => ({ lat: p.lat, lng: p.lng })), ...frotaMarkers.map(p => ({ lat: p.lat, lng: p.lng }))];
            if (!points || points.length === 0) {
                // center on Florianópolis
                try { inst.setCenter({ lat: -27.5969, lng: -48.5495 }); inst.setZoom && inst.setZoom(12); } catch (e) { }
                return;
            }
            // fit bounds
            try {
                const bounds = new window.google.maps.LatLngBounds();
                points.forEach(pt => bounds.extend({ lat: Number(pt.lat), lng: Number(pt.lng) }));
                inst.fitBounds(bounds, 80);
            } catch (e) { /* ignore */ }
        } catch (e) { /* ignore */ }
    };

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
    useEffect(() => {
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
                try { inst.setCenter(defaultCenter); inst.setZoom && inst.setZoom(12); } catch (e) { }
                hasInitializedBoundsRef.current = true;
                return;
            }
            try {
                const bounds = new window.google.maps.LatLngBounds();
                points.forEach(pt => bounds.extend({ lat: Number(pt.lat), lng: Number(pt.lng) }));
                inst.fitBounds(bounds, 80);
                hasInitializedBoundsRef.current = true;
            } catch (e) { /* ignore */ }
        } catch (e) { /* ignore */ }
    }, [entregaMarkers, frotaMarkers]);

    const mapInner = useMemo(() => {
        try {
            return (
                <Map mapContainerStyle={mapStyle} center={computedCenter} zoom={12} onLoad={handleLoad}>
                    {/* frota markers (drivers) */}
                    {frotaMarkers.map(m => (
                        <AdvancedMarker key={`m-${m.id}`} position={{ lat: m.lat, lng: m.lng }}>
                            <div style={{ transform: 'translate(-50%,-100%)', display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'pointer' }}>
                                <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700 }}>{'🚚'}</div>
                                <div style={{ marginTop: 4, background: 'rgba(0,0,0,0.7)', color: '#fff', padding: '4px 8px', borderRadius: 8, fontSize: 12 }}>{m.title}</div>
                            </div>
                        </AdvancedMarker>
                    ))}

                    {/* entrega markers */}
                    {entregaMarkers.map((p, i) => (
                        <AdvancedMarker key={`e-${p.id || i}`} position={{ lat: p.lat, lng: p.lng }}>
                            <div style={{ transform: 'translate(-50%,-110%)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                <div style={{ backgroundColor: 'rgba(0,0,0,0.75)', color: '#fff', padding: '4px 8px', borderRadius: 12, fontSize: 11, fontWeight: 700, marginBottom: 6 }}>{p.title}</div>
                                <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 14 }}>{p.label || String(i + 1)}</div>
                            </div>
                        </AdvancedMarker>
                    ))}
                </Map>
            );
        } catch (e) {
            console.warn('Google temporariamente indisponível (map render)', e);
            return <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af' }}>Carregando Mapa...</div>;
        }
    }, [mapStyle, computedCenter, entregaMarkers, frotaMarkers]);

    // If the global Google Maps object is already present, do not pass an apiKey to APIProvider
    if (typeof window !== 'undefined' && window.google && window.google.maps) {
        return (
            <div style={{ width: '100%', height: mobile ? 250 : height }}>
                {mapInner}
            </div>
        );
    }

    // If API is not yet available, show a fallback UI and avoid attempting to load scripts here.
    return (
        <div style={{ width: '100%', height: mobile ? 250 : height, background: '#071228', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
            {typeof window !== 'undefined' && window.google && window.google.maps ? mapInner : <div>Carregando Mapa...</div>}
        </div>
    );
}

// Custom comparison: shallow check of coords and lengths to avoid needless re-renders
function propsAreEqual(prev, next) {
    try {
        if ((prev.mobile || false) !== (next.mobile || false)) return false;
        if ((prev.height || 0) !== (next.height || 0)) return false;
        const plen = (prev.frota || []).length, nlen = (next.frota || []).length;
        if (plen !== nlen) return false;
        const elen = (prev.entregas || []).length, enlen = (next.entregas || []).length;
        if (elen !== enlen) return false;
        const pf = (prev.frota || []).map(m => ({ id: m.id, lat: Number(m.lat), lng: Number(m.lng) }));
        const nf = (next.frota || []).map(m => ({ id: m.id, lat: Number(m.lat), lng: Number(m.lng) }));
        if (JSON.stringify(pf) !== JSON.stringify(nf)) return false;
        const pe = (prev.entregas || []).filter(e => e && e.lat != null && e.lng != null).map(e => ({ id: e.id, lat: Number(e.lat), lng: Number(e.lng) }));
        const ne = (next.entregas || []).filter(e => e && e.lat != null && e.lng != null).map(e => ({ id: e.id, lat: Number(e.lat), lng: Number(e.lng) }));
        if (JSON.stringify(pe) !== JSON.stringify(ne)) return false;
        return true;
    } catch (e) { return false; }
}

export default React.memo(MapaLogistica, propsAreEqual);