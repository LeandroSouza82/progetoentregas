import React, { useEffect, useRef, useMemo } from 'react';
import useGoogleMapsLoader from './useGoogleMapsLoader';

// Singleton map holder (keeps the Google Map instance alive across mounts)
let GLOBAL_GOOGLE_MAP = null;

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
    // capture API key explicitly so we can avoid loading when missing
    const apiKey = (typeof import.meta !== 'undefined' && import.meta.env) ? (import.meta.env.VITE_GOOGLE_MAPS_KEY || '') : '';
    const { loaded, error } = useGoogleMapsLoader({ apiKey });

    // memoized options to avoid re-creating on simple prop changes
    const mapOptions = useMemo(() => ({
        center: { lat: Number(center.lat), lng: Number(center.lng) },
        zoom: Number(zoom),
        mapTypeControl: false,
        streetViewControl: false
    }), [center.lat, center.lng, zoom]);

    useEffect(() => {
        if (error) {
            try { onError(error); } catch (e) { /* swallow */ }
        }
    }, [error]);

    useEffect(() => {
        // Only proceed when loader is ready and container exists
        if (!loaded) return;
        if (!containerRef.current) return;

        // If a global map exists, reattach it to current container (avoid re-creating)
        if (GLOBAL_GOOGLE_MAP) {
            try {
                const existingDiv = GLOBAL_GOOGLE_MAP.getDiv && GLOBAL_GOOGLE_MAP.getDiv();
                if (existingDiv && existingDiv !== containerRef.current) {
                    // move the map DOM node into the new container (cheap)
                    try { containerRef.current.appendChild(existingDiv); } catch (e) { }
                }
                mapRef.current = GLOBAL_GOOGLE_MAP;
                try { onLoad(GLOBAL_GOOGLE_MAP); } catch (e) { }
                return; // reuse existing map
            } catch (e) {
                // If reattach fails, fall through to create a fresh one
            }
        }

        // If no global map exists, create it once and cache globally
        try {
            const map = new window.google.maps.Map(containerRef.current, mapOptions);
            GLOBAL_GOOGLE_MAP = map;
            mapRef.current = map;
            try { onLoad(map); } catch (e) { /* swallow */ }
        } catch (e) {
            try { onError(e); } catch (ee) { }
        }

        // Intentionally do not destroy GLOBAL_GOOGLE_MAP on unmount to keep instance alive
        return () => {
            mapRef.current = null;
        };
    }, [loaded, mapOptions, apiKey]);

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
