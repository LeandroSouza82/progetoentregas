import { useEffect, useState } from 'react';

// Hook para carregar/verificar Google Maps JS API uma vez
export default function useGoogleMapsLoader({ apiKey } = {}) {
    const [loaded, setLoaded] = useState(typeof window !== 'undefined' && window.google && window.google.maps ? true : false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (window.google && window.google.maps) {
            setLoaded(true);
            return;
        }

        // Reuse global promise to avoid duplicate script insertion
        if (window.__gmapsLoaderPromise) {
            window.__gmapsLoaderPromise.then(() => setLoaded(true)).catch(e => setError(e));
            return;
        }

        const existing = document.querySelector('script[data-google-maps-api]');
        if (existing) {
            // If there's an existing tag, hook to its load/error
            const onLoad = () => setLoaded(true);
            const onError = (e) => setError(e || new Error('Google Maps failed to load'));
            existing.addEventListener('load', onLoad);
            existing.addEventListener('error', onError);
            // mark a promise so other instances reuse
            window.__gmapsLoaderPromise = new Promise((resolve, reject) => {
                existing.addEventListener('load', () => resolve(window.google && window.google.maps ? window.google.maps : null));
                existing.addEventListener('error', (err) => reject(err || new Error('Failed to load Google Maps')));
            });
            window.__gmapsLoaderPromise.catch(() => { });
            return () => {
                existing.removeEventListener('load', onLoad);
                existing.removeEventListener('error', onError);
            };
        }

        // If no existing script, inject one (rare if index.html already contains it)
        const src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey || '')}`;
        const s = document.createElement('script');
        s.setAttribute('data-google-maps-api', '1');
        s.setAttribute('loading', 'async');
        s.async = true;
        s.defer = true;
        s.src = src;

        const onLoad = () => setLoaded(true);
        const onErr = (e) => setError(e || new Error('Google Maps failed to load'));

        s.addEventListener('load', onLoad);
        s.addEventListener('error', onErr);

        document.head.appendChild(s);

        window.__gmapsLoaderPromise = new Promise((resolve, reject) => {
            s.addEventListener('load', () => resolve(window.google && window.google.maps ? window.google.maps : null));
            s.addEventListener('error', (err) => reject(err || new Error('Failed to load Google Maps')));
        });

        // cleanup: do not remove the script tag (we want it persistent), but remove listeners
        return () => {
            s.removeEventListener('load', onLoad);
            s.removeEventListener('error', onErr);
        };
    }, [apiKey]);

    return { loaded, error };
}
