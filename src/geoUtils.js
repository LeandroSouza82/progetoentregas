// ===== UTILIDADES GEOGRÁFICAS (SEM APIS EXTERNAS) =====
// Funções matemáticas para cálculo de distância e otimização de rotas

/**
 * Calcula a distância entre dois pontos usando a fórmula de Haversine
 * @param {number} lat1 - Latitude do ponto 1
 * @param {number} lng1 - Longitude do ponto 1
 * @param {number} lat2 - Latitude do ponto 2
 * @param {number} lng2 - Longitude do ponto 2
 * @returns {number} Distância em quilômetros
 */
export function haversineDistance(lat1, lng1, lat2, lng2) {
    const R = 6371; // Raio da Terra em km
    const toRad = (deg) => (deg * Math.PI) / 180;

    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);

    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;

    return distance;
}

/**
 * Algoritmo do Vizinho Mais Próximo (Nearest Neighbor) para otimização de rotas
 * @param {object} origin - Ponto de partida { lat, lng }
 * @param {array} points - Array de pontos a visitar [{ id, lat, lng, ... }]
 * @param {object} destination - Ponto de retorno (opcional) { lat, lng }
 * @returns {array} Array ordenado de pontos otimizado
 */
export function nearestNeighborRoute(origin, points, destination = null) {
    if (!points || points.length === 0) return [];
    if (points.length === 1) return points;

    const optimized = [];
    const remaining = [...points];
    let current = origin;

    // Enquanto houver pontos não visitados
    while (remaining.length > 0) {
        let nearestIndex = 0;
        let minDistance = Infinity;

        // Encontrar o ponto mais próximo do atual
        for (let i = 0; i < remaining.length; i++) {
            const point = remaining[i];
            const dist = haversineDistance(
                current.lat, current.lng,
                point.lat, point.lng
            );

            if (dist < minDistance) {
                minDistance = dist;
                nearestIndex = i;
            }
        }

        // Adicionar o mais próximo à rota otimizada
        const nearest = remaining.splice(nearestIndex, 1)[0];
        optimized.push(nearest);
        current = nearest;
    }

    return optimized;
}

/**
 * Calcula a distância total de uma rota
 * @param {object} origin - Ponto de partida { lat, lng }
 * @param {array} route - Array de pontos ordenados
 * @param {object} destination - Ponto de retorno (opcional)
 * @returns {number} Distância total em km
 */
export function calculateTotalDistance(origin, route, destination = null) {
    if (!route || route.length === 0) return 0;

    let total = 0;
    let current = origin;

    // Distância do origin até primeiro ponto
    total += haversineDistance(current.lat, current.lng, route[0].lat, route[0].lng);

    // Distâncias entre pontos consecutivos
    for (let i = 0; i < route.length - 1; i++) {
        total += haversineDistance(
            route[i].lat, route[i].lng,
            route[i + 1].lat, route[i + 1].lng
        );
    }

    // Distância do último ponto até o destino (se fornecido)
    if (destination) {
        const last = route[route.length - 1];
        total += haversineDistance(last.lat, last.lng, destination.lat, destination.lng);
    }

    return total;
}

/**
 * Busca de coordenadas usando Nominatim (OpenStreetMap)
 * IMPORTANTE: Fallback gracioso - retorna null se não encontrar, não dá erro
 * @param {string} address - Endereço para buscar
 * @param {object} bounds - Bounds de busca (opcional) { south, north, west, east }
 * @returns {Promise<object|null>} { lat, lng, display_name } ou null
 */
export async function geocodeNominatim(address, bounds = null) {
    if (!address || address.trim().length < 3) return null;

    try {
        // Bounds padrão: Santa Catarina
        const defaultBounds = {
            south: -30.0,
            north: -25.0,
            west: -54.0,
            east: -48.0
        };

        const b = bounds || defaultBounds;
        const viewbox = `${b.west},${b.south},${b.east},${b.north}`;

        const url = `https://nominatim.openstreetmap.org/search?` +
            `q=${encodeURIComponent(address)}` +
            `&format=json` +
            `&viewbox=${viewbox}` +
            `&bounded=1` +
            `&limit=1` +
            `&addressdetails=1`;

        const response = await fetch(url, {
            headers: {
                'User-Agent': 'ProjetoEntregas/1.0' // Nominatim requer User-Agent
            }
        });

        if (!response.ok) return null;

        const data = await response.json();

        if (!data || data.length === 0) return null;

        const result = data[0];
        return {
            lat: parseFloat(result.lat),
            lng: parseFloat(result.lon),
            display_name: result.display_name
        };

    } catch (error) {
        console.warn('Geocoding falhou (não é erro crítico):', error);
        return null; // Falha silenciosa
    }
}

/**
 * Busca de sugestões de endereço usando Nominatim Autocomplete
 * @param {string} query - Texto de busca
 * @param {object} bounds - Bounds de busca (opcional)
 * @returns {Promise<array>} Array de sugestões [{ display_name, lat, lng, place_id }]
 */
export async function searchNominatim(query, bounds = null) {
    if (!query || query.trim().length < 3) return [];

    try {
        // VIEWBOX FOCADO: Grande Florianópolis (Florianópolis, São José, Palhoça, Biguaçu)
        const defaultBounds = {
            south: -27.85,  // Limite sul (Palhoça)
            north: -27.35,  // Limite norte (Biguaçu)
            west: -48.70,   // Limite oeste
            east: -48.40    // Limite leste
        };

        const b = bounds || defaultBounds;
        const viewbox = `${b.west},${b.south},${b.east},${b.north}`;

        // ADICIONAR SUFIXO: força busca em Santa Catarina, Brasil
        const searchQuery = query.toLowerCase().includes('santa catarina') || query.toLowerCase().includes('brasil')
            ? query
            : `${query}, Santa Catarina, Brasil`;

        const url = `https://nominatim.openstreetmap.org/search?` +
            `q=${encodeURIComponent(searchQuery)}` +
            `&format=json` +
            `&viewbox=${viewbox}` +
            `&bounded=1` +
            `&limit=10` +  // Aumentado para permitir priorização
            `&addressdetails=1`;

        const response = await fetch(url, {
            headers: {
                'User-Agent': 'ProjetoEntregas/1.0'
            }
        });

        if (!response.ok) return [];

        const data = await response.json();

        // PRIORIZAÇÃO: se busca contém "Feiticeira", priorizar Ingleses ou Rio Vermelho
        const results = data.map(item => ({
            place_id: item.place_id,
            display_name: item.display_name,
            lat: parseFloat(item.lat),
            lng: parseFloat(item.lon),
            address: item.address || {},
            priority: 0
        }));

        // Sistema de priorização por bairro
        if (query.toLowerCase().includes('feiticeira')) {
            results.forEach(r => {
                const displayLower = r.display_name.toLowerCase();
                if (displayLower.includes('ingleses') || displayLower.includes('rio vermelho')) {
                    r.priority = 10;
                } else if (displayLower.includes('florianópolis')) {
                    r.priority = 5;
                }
            });
        } else {
            // Prioridade geral: Florianópolis > São José > Palhoça > Biguaçu
            results.forEach(r => {
                const displayLower = r.display_name.toLowerCase();
                if (displayLower.includes('florianópolis')) r.priority = 10;
                else if (displayLower.includes('são josé')) r.priority = 8;
                else if (displayLower.includes('palhoça')) r.priority = 6;
                else if (displayLower.includes('biguaçu')) r.priority = 4;
            });
        }

        // Ordenar por prioridade e retornar top 5
        return results
            .sort((a, b) => b.priority - a.priority)
            .slice(0, 5)
            .map(({ place_id, display_name, lat, lng }) => ({
                place_id,
                display_name,
                lat,
                lng
            }));

    } catch (error) {
        console.warn('Busca de endereço falhou:', error);
        return [];
    }
}

/**
 * Busca uma rota otimizada usando OSRM (Open Source Routing Machine)
 * @param {array} coordinates - Array de coordenadas [[lng, lat], [lng, lat], ...]
 * @returns {Promise<object|null>} Objeto com geometry (array de [lat, lng]) e distance (km)
 */
export async function getOSRMRoute(coordinates) {
    if (!coordinates || coordinates.length < 2) return null;

    try {
        // OSRM usa formato: lng,lat;lng,lat;...
        const coords = coordinates.map(c => `${c[0]},${c[1]}`).join(';');
        const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;

        const response = await fetch(url);
        if (!response.ok) {
            console.warn('OSRM retornou status:', response.status);
            return null;
        }

        const data = await response.json();
        if (!data.routes || data.routes.length === 0) {
            console.warn('OSRM não retornou rotas');
            return null;
        }

        const route = data.routes[0];
        // Converter coordenadas de [lng, lat] para [lat, lng] (formato Leaflet)
        const geometry = route.geometry.coordinates.map(c => [c[1], c[0]]);
        const distanceKm = (route.distance / 1000).toFixed(2);

        return {
            geometry,
            distance: parseFloat(distanceKm)
        };
    } catch (error) {
        console.warn('Erro ao buscar rota no OSRM:', error);
        return null;
    }
}

