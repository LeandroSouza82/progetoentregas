export function normalizeAddressQuery(address) {
    // Preserva número, bairro, município, CEP e nomes com hífen.
    return String(address || '').replace(/\s+/g, ' ').trim();
}

export function houseNumber(query) {
    const segments = query.split(',');
    const separate = segments[1]?.trim().match(/^(\d+[a-z]?)\b/i);
    return separate?.[1] || segments[0].trim().match(/(?:^|\s)(\d+[a-z]?)\s*(?:-|$)/i)?.[1] || null;
}

export function validCoordinates(lat, lng) {
    return typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)
        && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}

export async function geocodeExactAddress(address, token, fetcher = fetch) {
    const query = normalizeAddressQuery(address);
    if (!query || !token) return null;
    const url = new URL(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json`);
    Object.entries({ access_token: token, country: 'br', language: 'pt', types: 'address', limit: '1', autocomplete: 'false', fuzzyMatch: 'false' })
        .forEach(([key, value]) => url.searchParams.set(key, value));
    const response = await fetcher(url);
    if (!response.ok) throw new Error('Não foi possível localizar o endereço. Confira o município e tente novamente.');
    const feature = (await response.json()).features?.[0];
    const [lng, lat] = feature?.center || [];
    if (!validCoordinates(lat, lng) || !(feature?.relevance >= 0.9) || !feature?.address) return null;
    // Não aceita outro número (inclusive números existentes no nome da rua).
    if (houseNumber(query)?.toLowerCase() !== String(feature.address).toLowerCase()) return null;
    return { lat, lng, display_name: feature.place_name, precisao: feature.relevance };
}
