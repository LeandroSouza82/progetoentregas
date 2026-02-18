// Google Maps loader and hooks disabled — project is Mapbox/Leaflet only.
export function loadGoogleMaps(apiKey) {
    return Promise.reject(new Error('Google Maps disabled in this project'));
}

export function GoogleMapsProvider({ apiKey, children }) {
    return children || null;
}

export function useGoogleMaps() {
    return { loaded: false, maps: null };
}
