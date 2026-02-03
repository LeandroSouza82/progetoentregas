import React, { useEffect, useRef, useMemo } from 'react';
// Singleton map holder (keeps the Google Map instance alive across mounts)
let GLOBAL_GOOGLE_MAP = null;

// Componente reutilizável que monta um mapa Google Maps JS puro
export default function MapComponent({
    center = { lat: -27.2423, lng: -50.2188 }, // Default to Santa Catarina center
    zoom = 13,
    style = { width: '100%', height: '100%' },
    onLoad = () => { },
    onError = () => { }
}) {
    const containerRef = useRef(null);
    const mapRef = useRef(null);
    // Passive check for Google Maps availability (APIProvider should load it)
    const [loaded, setLoaded] = React.useState(typeof window !== 'undefined' && window.google && window.google.maps ? true : false);
    const [error, setError] = React.useState(null);

    React.useEffect(() => {
        if (typeof window === 'undefined') return;
        const check = () => {
            if (window.google && window.google.maps) {
                setLoaded(true);
                setError(null);
                return true;
            }
            return false;
        };
        if (check()) return;
        const interval = setInterval(() => { if (check()) clearInterval(interval); }, 300);
        const timeout = setTimeout(() => { clearInterval(interval); setError(new Error('Google Maps did not become available in time')); }, 10000);
        return () => { clearInterval(interval); clearTimeout(timeout); };
    }, []);

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
            // Ensure map is plain 2D road map with no tilt / 3D params
            const opts = Object.assign({}, mapOptions);
            try { opts.tilt = 0; } catch (e) { }
            try { opts.mapTypeId = window.google && window.google.maps && window.google.maps.MapTypeId ? window.google.maps.MapTypeId.ROADMAP : opts.mapTypeId; } catch (e) { }

            const map = new window.google.maps.Map(containerRef.current, opts);
            // Force tilt to 0 to avoid any 3D perspective on some mapIds
            try { if (typeof map.setTilt === 'function') map.setTilt(0); } catch (e) { }

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
