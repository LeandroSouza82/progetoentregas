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
 * Busca de coordenadas usando Mapbox Geocoding API - Motor OFICIAL
 * Tolerante a erros de digitação, extremamente preciso e rápido
 * @param {string} address - Endereço para buscar
 * @param {object} bounds - Bounds de busca (opcional) { south, north, west, east }
 * @returns {Promise<object|null>} { lat, lng, display_name } ou null
 */
export async function geocodeMapbox(address, bounds = null) {
    if (!address || address.trim().length < 3) return null;

    try {
        // TOKEN OFICIAL MAPBOX
        const MAPBOX_TOKEN = 'pk.eyJ1IjoibGVhbmRyb2RpdGFtYXI4MiIsImEiOiJjbWpid2NsZDYwbDN4M2ZweWZsbTBvamV4In0.cmNRPggP9Y_zkZZ1Yq-_4w';

        // VIEWBOX CIRÚRGICO: Grande Florianópolis COMPLETA + Santo Amaro da Imperatriz
        // Inclui: Biguaçu, São José, Florianópolis, Palhoça, Santo Amaro da Imperatriz
        const defaultBounds = {
            south: -27.90,  // Expandido para cobrir Santo Amaro da Imperatriz (sul)
            north: -27.35,  // Limite norte (Biguaçu)
            west: -48.90,   // Expandido para cobrir Santo Amaro da Imperatriz (oeste)
            east: -48.35    // Limite leste (Florianópolis/litoral)
        };

        const b = bounds || defaultBounds;
        const bbox = `${b.west},${b.south},${b.east},${b.north}`;

        // LIMPEZA RIGOROSA: Remover vírgulas duplas, espaços extras e vírgulas vazias
        const addressClean = address
            .replace(/,\s*,+/g, ',')        // Remove vírgulas múltiplas (, , ou , , ,)
            .replace(/\s*,\s*/g, ', ')      // Normaliza espaços ao redor de vírgulas
            .replace(/,\s*$/g, '')          // Remove vírgula final
            .replace(/\s+/g, ' ')           // Múltiplos espaços -> espaço único
            .trim();

        console.log('🧹 Mapbox - Endereço limpo:', addressClean);

        // Mapbox Geocoding API - Centro em Florianópolis para proximity
        const proximity = '-48.54,-27.59'; // Centro de Florianópolis
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(addressClean)}.json?` +
            `access_token=${MAPBOX_TOKEN}` +
            `&proximity=${proximity}` +
            `&bbox=${bbox}` +
            `&types=address,poi` +
            `&language=pt` +
            `&limit=1`;

        console.log('🗺️ Mapbox URL:', url);

        const response = await fetch(url, {
            headers: {
                'Accept': 'application/json'
            }
        });

        console.log('📡 Mapbox Status:', response.status, response.statusText);

        if (!response.ok) {
            console.warn('⚠️ Mapbox resposta não-OK:', response.status);
            return null;
        }

        const data = await response.json();
        console.log('📊 Mapbox Resposta:', data);

        if (!data || !data.features || data.features.length === 0) {
            console.warn('❌ Mapbox não encontrou resultados');
            return null;
        }

        const result = data.features[0];
        const coords = result.center; // [lng, lat] no Mapbox
        const lng = coords[0];
        const lat = coords[1];

        // Validação SC
        if (lat < -25.0 || lat > -30.0 || lng > -48.0 || lng < -54.0) {
            console.warn('⚠️ Mapbox retornou coordenadas fora de SC:', { lat, lng });
            return null;
        }

        const display_name = result.place_name || result.text || address;

        console.log('✅ Mapbox sucesso:', { lat, lng, display_name });
        return { lat, lng, display_name };

    } catch (err) {
        console.error('❌ Erro Mapbox:', err);
        return null;
    }
}

/**
 * Mapbox Search Box / Autosuggest API - Retorna sugestões de endereços conforme o usuário digita
 * @param {string} query - Texto digitado pelo usuário (mínimo 3 caracteres)
 * @param {object} bounds - Bounds de busca (opcional) { south, north, west, east }
 * @returns {Promise<Array>} Array de sugestões com { place_name, center: [lng, lat], ... }
 */
export async function searchMapbox(query, bounds = null) {
    if (!query || query.trim().length < 3) return [];

    try {
        // TOKEN OFICIAL MAPBOX
        const MAPBOX_TOKEN = 'pk.eyJ1IjoibGVhbmRyb2RpdGFtYXI4MiIsImEiOiJjbWpid2NsZDYwbDN4M2ZweWZsbTBvamV4In0.cmNRPggP9Y_zkZZ1Yq-_4w';

        // VIEWBOX: Grande Florianópolis + Santo Amaro da Imperatriz
        const defaultBounds = {
            south: -27.90,
            north: -27.35,
            west: -48.90,
            east: -48.35
        };

        const b = bounds || defaultBounds;
        const bbox = `${b.west},${b.south},${b.east},${b.north}`;
        const proximity = '-48.54,-27.59'; // Centro de Florianópolis

        // Limpeza do query
        const queryClean = query
            .replace(/,\s*,+/g, ',')
            .replace(/\s*,\s*/g, ', ')
            .replace(/,\s*$/g, '')
            .replace(/\s+/g, ' ')
            .trim();

        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(queryClean)}.json?` +
            `access_token=${MAPBOX_TOKEN}` +
            `&proximity=${proximity}` +
            `&bbox=${bbox}` +
            `&types=address,poi` +
            `&language=pt` +
            `&limit=10`;

        const response = await fetch(url, {
            headers: {
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            console.warn('⚠️ Mapbox Autosuggest falhou:', response.status);
            return [];
        }

        const data = await response.json();

        if (!data || !data.features || data.features.length === 0) {
            return [];
        }

        // Formatar resultados para o formato esperado pelo componente
        const results = data.features.map(item => ({
            id: item.id,
            place_id: item.id,
            place_name: item.place_name,
            display_name: item.place_name,
            text: item.text,
            lat: item.center[1], // Mapbox retorna [lng, lat]
            lng: item.center[0],
            context: item.context || []
        }));

        console.log('🔍 Mapbox Autosuggest:', results.length, 'sugestões');
        return results;

    } catch (err) {
        console.error('❌ Erro Mapbox Autosuggest:', err);
        return [];
    }
}

/**
 * Busca de coordenadas usando Photon API (Komoot) - FALLBACK 1
 * Tolerante a erros de digitação e mais flexível que Nominatim
 * @param {string} address - Endereço para buscar
 * @param {object} bounds - Bounds de busca (opcional) { south, north, west, east }
 * @returns {Promise<object|null>} { lat, lng, display_name } ou null
 */
export async function geocodePhoton(address, bounds = null) {
    if (!address || address.trim().length < 3) return null;

    try {
        // VIEWBOX CIRÚRGICO: Grande Florianópolis COMPLETA + Santo Amaro da Imperatriz
        // Inclui: Biguaçu, São José, Florianópolis, Palhoça, Santo Amaro da Imperatriz
        const defaultBounds = {
            south: -27.90,  // Expandido para cobrir Santo Amaro da Imperatriz (sul)
            north: -27.35,  // Limite norte (Biguaçu)
            west: -48.90,   // Expandido para cobrir Santo Amaro da Imperatriz (oeste)
            east: -48.35    // Limite leste (Florianópolis/litoral)
        };

        const b = bounds || defaultBounds;
        const bbox = `${b.west},${b.south},${b.east},${b.north}`;

        // LIMPEZA RIGOROSA: Remover vírgulas duplas, espaços extras e vírgulas vazias
        const addressClean = address
            .replace(/,\s*,+/g, ',')        // Remove vírgulas múltiplas (, , ou , , ,)
            .replace(/\s*,\s*/g, ', ')      // Normaliza espaços ao redor de vírgulas
            .replace(/,\s*$/g, '')          // Remove vírgula final
            .replace(/\s+/g, ' ')           // Múltiplos espaços -> espaço único
            .trim();

        console.log('🧹 Endereço limpo:', addressClean);

        // Simplificar query: apenas endereço + Santa Catarina
        const searchQuery = addressClean.toLowerCase().includes('santa catarina') || addressClean.toLowerCase().includes('brasil')
            ? addressClean
            : `${addressClean} Santa Catarina`;

        // Photon API - Aceita erros de digitação automaticamente
        const url = `https://photon.komoot.io/api/?` +
            `q=${encodeURIComponent(searchQuery)}` +
            `&bbox=${bbox}` +
            `&limit=1` +
            `&lang=pt`;

        console.log('🔍 Photon URL:', url);

        const response = await fetch(url, {
            headers: {
                'Accept': 'application/json'
            }
        });

        console.log('📡 Photon Status:', response.status, response.statusText);

        if (!response.ok) {
            console.warn('⚠️ Photon resposta não-OK:', response.status);
            return null;
        }

        const data = await response.json();
        console.log('📊 Photon Resposta:', data);

        if (!data || !data.features || data.features.length === 0) {
            console.warn('❌ Photon não encontrou resultados');
            return null;
        }

        const result = data.features[0];
        const coords = result.geometry.coordinates; // [lng, lat] no GeoJSON
        const lat = coords[1];
        const lng = coords[0];

        // Validação SC
        if (lat < -25.0 || lat > -30.0 || lng > -48.0 || lng < -54.0) {
            console.warn('⚠️ Photon retornou coordenadas fora de SC:', { lat, lng });
            return null;
        }

        const display_name = result.properties.name ||
            result.properties.street ||
            address;

        console.log('✅ Photon sucesso:', { lat, lng, display_name });
        return { lat, lng, display_name };

    } catch (err) {
        console.error('❌ Erro Photon:', err);
        return null;
    }
}

/**
 * Busca de coordenadas usando Nominatim (OpenStreetMap) - FALLBACK
 * IMPORTANTE: Fallback gracioso - retorna null se não encontrar, não dá erro
 * @param {string} address - Endereço para buscar
 * @param {object} bounds - Bounds de busca (opcional) { south, north, west, east }
 * @returns {Promise<object|null>} { lat, lng, display_name } ou null
 */
export async function geocodeNominatim(address, bounds = null) {
    if (!address || address.trim().length < 3) return null;

    try {
        // VIEWBOX CIRÚRGICO: Grande Florianópolis COMPLETA
        // Inclui: Biguaçu, São José, Florianópolis, Palhoça, Santo Amaro da Imperatriz
        const defaultBounds = {
            south: -27.85,  // Limite sul (Palhoça/Santo Amaro)
            north: -27.35,  // Limite norte (Biguaçu)
            west: -48.85,   // Limite oeste (Santo Amaro da Imperatriz)
            east: -48.35    // Limite leste (Florianópolis/litoral)
        };

        const b = bounds || defaultBounds;
        const viewbox = `${b.west},${b.south},${b.east},${b.north}`;

        // LIMPEZA RIGOROSA: Remover vírgulas duplas e espaços extras
        const addressClean = address
            .replace(/,\s*,+/g, ',')        // Remove vírgulas múltiplas
            .replace(/\s*,\s*/g, ', ')      // Normaliza espaços
            .replace(/,\s*$/g, '')          // Remove vírgula final
            .replace(/\s+/g, ' ')           // Múltiplos espaços -> único
            .trim();

        console.log('🧹 Nominatim - Endereço limpo:', addressClean);

        // Adicionar "Santa Catarina, Brasil" se não estiver presente
        const searchQuery = addressClean.toLowerCase().includes('santa catarina') || addressClean.toLowerCase().includes('brasil')
            ? addressClean
            : `${addressClean}, Grande Florianópolis, Santa Catarina, Brasil`;

        // TENTATIVA 1: Busca restrita ao viewbox (cirúrgica)
        let url = `https://nominatim.openstreetmap.org/search?` +
            `q=${encodeURIComponent(searchQuery)}` +
            `&format=json` +
            `&viewbox=${viewbox}` +
            `&bounded=1` +
            `&limit=1` +
            `&addressdetails=1`;

        console.log('🌍 Nominatim URL (restrito):', url);

        let response = await fetch(url, {
            headers: {
                'User-Agent': 'Adecell_Logistica_v2', // USER-AGENT CRÍTICO (Nominatim bloqueia sem)
                'Accept-Language': 'pt-BR,pt;q=0.9'
            }
        });

        console.log('📡 Nominatim Status:', response.status, response.statusText);

        if (!response.ok) {
            if (response.status === 403) {
                console.error('❌ Nominatim bloqueou a requisição (403 Forbidden) - User-Agent inválido?');
            }
            console.warn('⚠️ Resposta não-OK do Nominatim:', response.status);
            return null;
        }

        let data = await response.json();
        console.log('📊 Nominatim Resposta (restrito):', data);

        // PLANO B: Se viewbox restrito retornar vazio, tentar sem bounded=1
        if (!data || data.length === 0) {
            console.warn('⚠️ Busca restrita retornou vazio. Tentando sem bounded=1...');

            const queryFallback = address.toLowerCase().includes('santa catarina') || address.toLowerCase().includes('brasil')
                ? address
                : `${address}, Santa Catarina, Brasil`;

            url = `https://nominatim.openstreetmap.org/search?` +
                `q=${encodeURIComponent(queryFallback)}` +
                `&format=json` +
                `&viewbox=${viewbox}` +
                `&limit=5` +
                `&addressdetails=1`;

            console.log('🔄 Nominatim URL (fallback):', url);

            response = await fetch(url, {
                headers: {
                    'User-Agent': 'Adecell_Logistica_v2',
                    'Accept-Language': 'pt-BR,pt;q=0.9'
                }
            });

            if (!response.ok) return null;

            data = await response.json();
            console.log('📊 Nominatim Resposta (fallback):', data);
        }

        if (!data || data.length === 0) {
            console.warn('❌ Nominatim não encontrou resultados mesmo com fallback');
            return null;
        }

        const result = data[0];
        const lat = parseFloat(result.lat);
        const lng = parseFloat(result.lon);

        // VALIDAÇÃO: verificar se coordenadas estão em Santa Catarina
        const isInSC = (lat < -25.0 && lat > -30.0 && lng > -54.0 && lng < -48.0);

        if (!isInSC) {
            console.warn('⚠️ Coordenadas fora de SC:', { lat, lng, address });
            return null; // Rejeitar coordenadas fora de SC
        }

        console.log('✅ Geocodificação bem-sucedida:', { lat, lng, display_name: result.display_name });

        return {
            lat: lat,
            lng: lng,
            display_name: result.display_name
        };

    } catch (error) {
        console.error('❌ Geocoding falhou (ERRO CRÍTICO):', error);
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
        // VIEWBOX CIRÚRGICO: Grande Florianópolis COMPLETA
        // Inclui: Biguaçu, São José, Florianópolis, Palhoça, Santo Amaro da Imperatriz
        const defaultBounds = {
            south: -27.85,  // Limite sul (Palhoça/Santo Amaro)
            north: -27.35,  // Limite norte (Biguaçu)
            west: -48.85,   // Limite oeste (Santo Amaro da Imperatriz)
            east: -48.35    // Limite leste (Florianópolis/litoral)
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

        console.log('🔍 Nominatim Search URL:', url);

        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Adecell_Logistica_v2', // USER-AGENT CRÍTICO
                'Accept-Language': 'pt-BR,pt;q=0.9'
            }
        });

        console.log('📡 Nominatim Search Status:', response.status);

        if (!response.ok) return [];

        const data = await response.json();
        console.log('📊 Nominatim Search Resultados:', data.length, 'encontrados');

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

