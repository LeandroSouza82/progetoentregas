import React, { useEffect, useRef } from 'react';
import useGoogleMapsLoader from './useGoogleMapsLoader';

// Componente reutilizável que monta um mapa Google Maps JS puro
export default function MapComponent({
    center = { lat: -28.2634, lng: -48.8428 }, // Palhoça, SC
    zoom = 13,
    style = { width: '100%', height: '100%' },
    onLoad = () => { },
    onError = () => { }
}) {
    const containerRef = useRef(null);
    const mapRef = useRef(null);
    const { loaded, error } = useGoogleMapsLoader({ apiKey: '' });

    useEffect(() => {
        if (error) {
            try { onError(error); } catch (e) { /* swallow */ }
        }
    }, [error]);

    useEffect(() => {
        if (!loaded) return;
        if (!containerRef.current) return;
        if (mapRef.current) return; // já inicializado

        try {
            const map = new window.google.maps.Map(containerRef.current, {
                center: { lat: Number(center.lat), lng: Number(center.lng) },
                zoom: Number(zoom),
                mapTypeControl: false,
                streetViewControl: false
            });
            mapRef.current = map;
            try { onLoad(map); } catch (e) { /* swallow */ }
        } catch (e) {
            try { onError(e); } catch (ee) { }
        }

        return () => {
            // Não destruímos o script globalmente — apenas liberamos a referência
            mapRef.current = null;
        };
    }, [loaded, containerRef.current]);

    if (!loaded) {
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', ...style }}>
                <div>Carregando mapa...</div>
            </div>
        );
    }

    return (
        <div ref={containerRef} style={style} />
    );
}
