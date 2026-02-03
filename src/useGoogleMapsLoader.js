import { useEffect, useState } from 'react';

// Passive Hook: does NOT inject or modify script tags. It only detects when Google Maps is available.
export default function useGoogleMapsLoader() {
    const [loaded, setLoaded] = useState(typeof window !== 'undefined' && window.google && window.google.maps ? true : false);
    const [error, setError] = useState(null);

    useEffect(() => {
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
        const interval = setInterval(() => {
            if (check()) clearInterval(interval);
        }, 300);
        const timeout = setTimeout(() => { clearInterval(interval); setError(new Error('Google Maps did not become available in time')); }, 10000);
        return () => { clearInterval(interval); clearTimeout(timeout); };
    }, []);

    return { loaded, error };
}
