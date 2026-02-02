import React, { createContext, useContext, useEffect, useState } from 'react';

const GoogleMapsContext = createContext({ loaded: false, maps: null });

// Singleton loader stored on window to avoid multiple injections
export function loadGoogleMaps(apiKey) {
    if (typeof window === 'undefined') return Promise.reject(new Error('Not in browser'));
    if (window.google && window.google.maps) return Promise.resolve(window.google.maps);
    if (window.__googleMapsLoaderPromise) return window.__googleMapsLoaderPromise;

    window.__googleMapsLoaderPromise = new Promise((resolve, reject) => {
        try {
            // Check for existing script tag
            const existing = document.querySelector('script[data-google-maps-api]');
            if (existing) {
                // If google already present, resolve; otherwise wait for load
                if (window.google && window.google.maps) return resolve(window.google.maps);
                const onLoadExisting = () => {
                    existing.removeEventListener('load', onLoadExisting);
                    if (window.google && window.google.maps) resolve(window.google.maps);
                    else reject(new Error('Google Maps script loaded but window.google.maps missing'));
                };
                existing.addEventListener('load', onLoadExisting);
                existing.addEventListener('error', () => reject(new Error('Failed to load existing Google Maps script')));
                return;
            }

            const s = document.createElement('script');
            s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey || '')}`;
            s.async = true;
            s.defer = true;
            // Hint to browsers
            try { s.setAttribute('loading', 'async'); } catch (e) { /* ignore if unsupported */ }
            s.setAttribute('data-google-maps-api', '1');
            s.addEventListener('load', () => {
                if (window.google && window.google.maps) resolve(window.google.maps);
                else reject(new Error('Google Maps loaded but window.google.maps missing'));
            });
            s.addEventListener('error', (err) => reject(err || new Error('Failed to load Google Maps')));
            document.head.appendChild(s);
        } catch (e) {
            reject(e);
        }
    });

    return window.__googleMapsLoaderPromise;
}

export function GoogleMapsProvider({ apiKey, children }) {
    const [state, setState] = useState({ loaded: false, maps: null });

    useEffect(() => {
        let mounted = true;
        loadGoogleMaps(apiKey).then((maps) => {
            if (!mounted) return;
            setState({ loaded: true, maps });
        }).catch((e) => {
            console.warn('GoogleMapsProvider failed to load:', e && e.message ? e.message : e);
            if (!mounted) return;
            setState({ loaded: false, maps: null });
        });
        return () => { mounted = false; };
    }, [apiKey]);

    return (
        <GoogleMapsContext.Provider value={state}>{children}</GoogleMapsContext.Provider>
    );
}

export function useGoogleMaps() {
    return useContext(GoogleMapsContext);
}
