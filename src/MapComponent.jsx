import React from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';

// Minimal MapComponent using Leaflet/Mapbox tiles. Replaces Google Map implementation.
export default function MapComponent({
    center = { lat: -27.2423, lng: -50.2188 },
    zoom = 13,
    style = { width: '100%', height: '100%' },
    onLoad = () => { },
    onError = () => { }
}) {
    try {
        const token = import.meta.env.VITE_MAPBOX_TOKEN || '';
        const url = token && token.length > 0
            ? `https://api.mapbox.com/styles/v1/mapbox/streets-v11/tiles/{z}/{x}/{y}?access_token=${token}`
            : `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`;

        return (
            <MapContainer center={[Number(center.lat), Number(center.lng)]} zoom={Number(zoom)} style={style} whenCreated={map => { try { onLoad(map); } catch (e) { onError(e); } }}>
                <TileLayer url={url} attribution={token ? '© Mapbox' : '© OpenStreetMap contributors'} />
            </MapContainer>
        );
    } catch (e) {
        try { onError(e); } catch (err) { }
        return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', ...style }}>Carregando mapa...</div>;
    }
}
