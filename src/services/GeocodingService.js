/**
 * SERVIÇO DE GEOCODIFICAÇÃO CIRÚRGICA - ADECELL LOGÍSTICA
 * Concentra toda a inteligência de localização e integração com Mapbox API
 */

// TOKEN OFICIAL MAPBOX - Mantenha este token seguro
export const MAPBOX_TOKEN = 'pk.eyJ1IjoibGVhbmRyb2RpdGFtYXI4MiIsImEiOiJjbWpid2NsZDYwbDN4M2ZweWZsbTBvamV4In0.cmNRPggP9Y_zkZZ1Yq-_4w';

// VIEWBOX CIRÚRGICO: Grande Florianópolis COMPLETA + Santo Amaro da Imperatriz
// Biguaçu, São José, Florianópolis, Palhoça, Santo Amaro da Imperatriz
export const DEFAULT_BOUNDS = {
    south: -27.90,  // Sul (Santo Amaro / Palhoça Sul)
    north: -27.35,  // Norte (Biguaçu)
    west: -48.90,   // Oeste (Santo Amaro / Palhoça Oeste)
    east: -48.35    // Leste (Florianópolis / Litoral)
};

/**
 * Filtro geográfico rígido para Santa Catarina / Grande Floripa
 */
export const isValidSC = (lat, lng) => {
    // Latitude: entre -27.90 e -27.30 (Grande Floripa)
    // Longitude: entre -48.90 e -48.30
    // Aceita Santo Amaro da Imperatriz (lat -27.68, lng -48.82)
    const isLatOk = lat <= -27.30 && lat >= -28.20; // Expandido para garantir Santo Amaro
    const isLngOk = lng >= -49.00 && lng <= -48.20;
    return isLatOk && isLngOk;
};

/**
 * Mapbox Search Box / Autosuggest - Busca sugestões conforme digita
 */
export async function fetchPredictions(query) {
    if (!query || query.trim().length < 3) return [];

    try {
        const b = DEFAULT_BOUNDS;
        const bbox = `${b.west},${b.south},${b.east},${b.north}`;
        const proximity = '-48.54,-27.59'; // Centro de Florianópolis

        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?` +
            `access_token=${MAPBOX_TOKEN}` +
            `&proximity=${proximity}` +
            `&bbox=${bbox}` +
            `&types=address,poi` +
            `&language=pt` +
            `&limit=10`;

        const response = await fetch(url);
        if (!response.ok) return [];

        const data = await response.json();
        if (!data || !data.features) return [];

        return data.features.map(item => ({
            id: item.id,
            place_name: item.place_name,
            lat: item.center[1], // Mapbox: [lng, lat]
            lng: item.center[0]
        }));
    } catch (err) {
        console.error('❌ Erro fetchPredictions:', err);
        return [];
    }
}

/**
 * Geocodificação completa (Endereço -> Coordenadas) usando Mapbox
 */
export async function geocodeMapbox(address) {
    if (!address || address.trim().length < 3) return null;

    try {
        const b = DEFAULT_BOUNDS;
        const bbox = `${b.west},${b.south},${b.east},${b.north}`;
        const proximity = '-48.54,-27.59';

        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json?` +
            `access_token=${MAPBOX_TOKEN}` +
            `&proximity=${proximity}` +
            `&bbox=${bbox}` +
            `&types=address,poi` +
            `&language=pt` +
            `&limit=1`;

        const response = await fetch(url);
        if (!response.ok) return null;

        const data = await response.json();
        if (!data || !data.features || data.features.length === 0) return null;

        const result = data.features[0];
        const lat = result.center[1];
        const lng = result.center[0];

        if (!isValidSC(lat, lng)) return null;

        return {
            lat,
            lng,
            display_name: result.place_name
        };
    } catch (err) {
        console.error('❌ Erro geocodeMapbox:', err);
        return null;
    }
}

/**
 * Fallback 1: Photon (Komoot)
 */
export async function geocodePhoton(address) {
    try {
        const b = DEFAULT_BOUNDS;
        const bbox = `${b.west},${b.south},${b.east},${b.north}`;
        const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(address)}&bbox=${bbox}&limit=1&lang=pt`;

        const response = await fetch(url);
        if (!response.ok) return null;

        const data = await response.json();
        if (!data || !data.features || data.features.length === 0) return null;

        const result = data.features[0];
        const lat = result.geometry.coordinates[1];
        const lng = result.geometry.coordinates[0];

        if (!isValidSC(lat, lng)) return null;

        return { lat, lng, display_name: result.properties.name || address };
    } catch (e) { return null; }
}

/**
 * Fallback 2: Nominatim (OSM)
 */
export async function geocodeNominatim(address) {
    try {
        const b = DEFAULT_BOUNDS;
        const viewbox = `${b.west},${b.south},${b.east},${b.north}`;
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&viewbox=${viewbox}&bounded=1&limit=1`;

        const response = await fetch(url, { headers: { 'User-Agent': 'Adecell_Logistica_v2' } });
        if (!response.ok) return null;

        const data = await response.json();
        if (!data || data.length === 0) return null;

        const lat = parseFloat(data[0].lat);
        const lng = parseFloat(data[0].lon);

        if (!isValidSC(lat, lng)) return null;

        return { lat, lng, display_name: data[0].display_name };
    } catch (e) { return null; }
}

/**
 * UTILIDADES GEOGR�FICAS
 */

export function haversineKm(a, b) {
    if (!a || !b) return 0;
    const toRad = (deg) => deg * Math.PI / 180;
    const R = 6371; // Earth radius in km
    const dLat = toRad(Number(b.lat || 0) - Number(a.lat || 0));
    const dLon = toRad(Number(b.lng || 0) - Number(a.lng || 0));
    const lat1 = toRad(Number(a.lat || 0));
    const lat2 = toRad(Number(b.lat || 0));
    const sinHalf = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(sinHalf), Math.sqrt(1 - sinHalf));
    return R * c;
}

export function computeRouteDistanceKm(origin, list = [], base = null) {
    try {
        const pts = [];
        if (origin && origin.lat != null && origin.lng != null) pts.push({ lat: Number(origin.lat), lng: Number(origin.lng) });
        (list || []).forEach(p => { if (p && p.lat != null && p.lng != null) pts.push({ lat: Number(p.lat), lng: Number(p.lng) }); });
        if (base && base.lat != null && base.lng != null) pts.push({ lat: Number(base.lat), lng: Number(base.lng) });
        if (pts.length < 2) return 0;
        let sum = 0;
        for (let i = 1; i < pts.length; i++) sum += haversineKm(pts[i - 1], pts[i]);
        return sum;
    } catch (e) { return 0; }
}

/**
 * LIMPEZA LOCAL: Funcionalidade migrada para o estado interno do Dashboard
 */
export async function arquivarEntregasConcluidas(supabaseClient, ids = []) {
    return { success: true, count: ids.length };
}
