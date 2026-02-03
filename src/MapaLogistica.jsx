import React, { useEffect, useRef } from 'react';
import { GoogleMap, AdvancedMarker } from '@vis.gl/react-google-maps';

// Safety helper: Santa Catarina bounds (manager requested)
const isValidSC = (lat, lng) => {
    if (lat == null || lng == null) return false;
    const latN = Number(lat); const lngN = Number(lng);
    if (!Number.isFinite(latN) || !Number.isFinite(lngN)) return false;
    return (latN < -25.0 && latN > -30.0 && lngN < -54.0 && lngN > -48.0);
};

export default function MapaLogistica({ entregas = [], frota = [], height = 500, mobile = false }) {
    const mapRef = useRef(null);

    // build marker lists
    const entregaMarkers = (entregas || []).filter(e => e && e.lat != null && e.lng != null && isValidSC(Number(e.lat), Number(e.lng))).map(e => ({ id: e.id, lat: Number(e.lat), lng: Number(e.lng), label: (e.ordem_logistica && Number(e.ordem_logistica) > 0) ? String(Number(e.ordem_logistica)) : null, title: e.cliente || e.endereco }));
    // Show any passed fleet items that have valid SC coords — do not hide the moto if offline; ensures a stable, fixed icon
    const frotaMarkers = (frota || []).filter(m => m && m.lat != null && m.lng != null && isValidSC(Number(m.lat), Number(m.lng))).map(m => ({ id: m.id, lat: Number(m.lat), lng: Number(m.lng), title: m.nome || 'Motorista' }));

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

    return (
        <div style={{ width: '100%', height: mobile ? 250 : height }}>
            <GoogleMap mapContainerStyle={mapStyle} center={{ lat: -27.5969, lng: -48.5495 }} zoom={12} onLoad={handleLoad}>
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

            </GoogleMap>
        </div>
    );
}
