import { useEffect, useState } from 'react';

// Hook para carregar/verificar Google Maps JS API uma vez
export default function useGoogleMapsLoader({ apiKey } = {}) {
    const [loaded, setLoaded] = useState(typeof window !== 'undefined' && window.google && window.google.maps ? true : false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        // Do not attempt to load Google Maps if API key is missing or empty
        if (!apiKey || String(apiKey).trim().length === 0) {
            setLoaded(false);
            setError(new Error('Google Maps API key missing')); // explicit error for caller
            return;
        }
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

            // If existing script is not async/defer, inject an async replacement to avoid blocking render
            const needsAsyncFix = !(existing.async || existing.defer || existing.getAttribute('loading') === 'async');
            if (needsAsyncFix) {
                try { console.info('Existing Google Maps script found without async/defer. Injecting async replacement for stability.'); } catch (e) { }
                const srcFix = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey || '')}&libraries=places,geometry&language=pt-BR&region=BR`;
                const sFix = document.createElement('script');
                sFix.setAttribute('data-google-maps-api-async-fix', '1');
                sFix.async = true;
                sFix.defer = true;
                sFix.src = srcFix;
                const onLoadFix = () => setLoaded(true);
                const onErrFix = (e) => setError(e || new Error('Google Maps (async fix) failed to load'));
                sFix.addEventListener('load', onLoadFix);
                sFix.addEventListener('error', onErrFix);
                document.head.appendChild(sFix);

                window.__gmapsLoaderPromise = new Promise((resolve, reject) => {
                    sFix.addEventListener('load', () => resolve(window.google && window.google.maps ? window.google.maps : null));
                    sFix.addEventListener('error', (err) => reject(err || new Error('Failed to load Google Maps (async fix)')));
                });
                window.__gmapsLoaderPromise.catch(() => { });

                return () => {
                    existing.removeEventListener('load', onLoad);
                    existing.removeEventListener('error', onError);
                    sFix.removeEventListener('load', onLoadFix);
                    sFix.removeEventListener('error', onErrFix);
                };
            }

            // If the existing script didn't include the Places library, inject a lightweight supplemental script that includes only the needed libraries (places,geometry)
            const hasPlaces = (typeof window !== 'undefined' && window.google && window.google.maps && window.google.maps.places) ? true : false;
            if (!hasPlaces) {
                // do not spam console in production — log once
                try { console.info('Existing Google Maps script found but Places library not available. Injecting supplemental script with &libraries=places,geometry'); } catch (e) { }
                const src2 = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey || '')}&libraries=places,geometry&language=pt-BR&region=BR`;
                const s2 = document.createElement('script');
                s2.setAttribute('data-google-maps-api-places', '1');
                s2.setAttribute('loading', 'async');
                s2.async = true;
                s2.defer = true;
                s2.src = src2;

                const onLoad2 = () => setLoaded(true);
                const onErr2 = (e) => setError(e || new Error('Google Maps (Places) failed to load'));

                s2.addEventListener('load', onLoad2);
                s2.addEventListener('error', onErr2);
                document.head.appendChild(s2);

                window.__gmapsLoaderPromise = new Promise((resolve, reject) => {
                    s2.addEventListener('load', () => resolve(window.google && window.google.maps ? window.google.maps : null));
                    s2.addEventListener('error', (err) => reject(err || new Error('Failed to load Google Maps (Places)')));
                });
                window.__gmapsLoaderPromise.catch(() => { });

                return () => {
                    existing.removeEventListener('load', onLoad);
                    existing.removeEventListener('error', onError);
                    s2.removeEventListener('load', onLoad2);
                    s2.removeEventListener('error', onErr2);
                };
            }

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
        // Ensure we explicitly load the Places library and set language/region for consistent behavior
        const src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey || '')}&libraries=places,geometry&language=pt-BR&region=BR`;
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
