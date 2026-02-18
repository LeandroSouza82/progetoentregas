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

// ===== Helpers para detecção e validação de cidade =====
function normalizeText(t) {
    if (!t) return '';
    try { return String(t).toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, ''); } catch (e) { return String(t).toLowerCase(); }
}

function detectCityStrict(address) {
    if (!address || !address.trim()) return null;
    const s = normalizeText(address).trim();
    // verifica fim da string após possíveis vírgulas/traços
    const endings = s.split(/[,\-]+/).map(p => p.trim()).filter(Boolean);
    const last = endings.length ? endings[endings.length - 1] : s;

    // Mapeamento das cidades esperadas
    const cityMap = {
        palhoca: 'Palhoça',
        'palhoca': 'Palhoça',
        'sao jose': 'São José',
        'são jose': 'São José',
        'florianopolis': 'Florianópolis',
        'florianópolis': 'Florianópolis',
        'ingleses': 'Florianópolis',
        biguacu: 'Biguaçu',
        'biguaçu': 'Biguaçu',
        sorocaba: 'Biguaçu'
    };

    // comparar final da string com chaves sem acento
    for (const k of Object.keys(cityMap)) {
        if (last.endsWith(k)) return cityMap[k];
    }
    return null;
}

function getCityCenter(cityName) {
    if (!cityName) return null;
    const map = {
        'Palhoça': { lat: -27.64, lng: -48.67 },
        'São José': { lat: -27.59, lng: -48.61 },
        'Biguaçu': { lat: -27.49, lng: -48.65 },
        'Florianópolis': { lat: -27.59, lng: -48.54 }
    };
    return map[cityName] || null;
}

function resultBelongsToCity(result, cityName) {
    if (!result || !cityName) return false;
    const cityNorm = normalizeText(cityName);
    const name = normalizeText(result.place_name || result.text || '');
    if (name.indexOf(cityNorm) !== -1) return true;
    // checar contexto (ex: context array do Mapbox)
    const ctx = result.context || [];
    for (const c of ctx) {
        const txt = normalizeText(c.text || c.id || '');
        if (txt.indexOf(cityNorm) !== -1) return true;
    }
    return false;
}

function cleanAndAssembleAddressForCity(rawAddress, cityName) {
    if (!rawAddress) return null;
    // remover símbolos como n°, nº, N°, # e parênteses vazios; normalizar espaços
    let s = String(rawAddress || '')
        .replace(/n\s*[º°]?/ig, '')
        .replace(/\bno\.\b/ig, '')
        .replace(/#/g, '')
        .replace(/\(\s*\)/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    // Remover tokens de unidade/prédio como 'unidade', 'apt', 'apto', 'bloco', 'torre', 'condominio', 'andar'
    s = s.replace(/\b(unidade|apt[o]?|apto|bloco|torre|condom[ií]nio|cond\.?|andar|apartamento|ap)\b/ig, '').replace(/\s{2,}/g, ' ').trim();

    // tentar extrair número (primeiro token que é número ou começa com número)
    let number = '';
    const parts = s.split(',').map(p => p.trim()).filter(Boolean);
    // procurar por último token contendo número
    for (let i = 0; i < parts.length; i++) {
        const tok = parts[i];
        const m = tok.match(/(\d+[A-Za-z0-9\/-]*)/);
        if (m) { number = m[1]; break; }
    }

    // Se ainda não achou, buscar no fim da string
    if (!number) {
        const m2 = s.match(/(\d+[A-Za-z0-9\/-]*)\s*$/);
        if (m2) number = m2[1];
    }

    // Extrair logradouro removendo número
    let street = s;
    if (number) {
        // remover ocorrência do número
        street = street.replace(new RegExp(number.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), '').replace(/,\s*,/g, ',').trim();
        // remover vírgula terminal
        street = street.replace(/,\s*$/, '').trim();
    }

    const assembled = number ? `${street}, ${number} - ${cityName}, SC, Brasil` : `${street} - ${cityName}, SC, Brasil`;
    return assembled;
}

// Gera variações simplificadas do endereço para tentativa fuzzy
function createFuzzyCandidates(raw, cityName) {
    const out = [];
    if (!raw) return out;
    const base = String(raw).trim();
    // 1) original
    out.push(base);
    // 2) remove caracteres não alfanuméricos (exceto vírgula e espaço)
    out.push(base.replace(/[^0-9a-zA-Z\s,À-ÿ]/g, '').replace(/\s{2,}/g, ' ').trim());
    // 3) tokens sem palavras curtas (<=2 chars)
    const tokens = base.split(/\s+/).filter(Boolean);
    const longTokens = tokens.filter(t => t.length > 2);
    if (longTokens.length >= 1) out.push(longTokens.join(' '));
    // 4) keep last 3 tokens (useful when street name has multiple words)
    if (tokens.length >= 1) out.push(tokens.slice(-3).join(' '));
    // 5) if cityName provided, append it to strengthen query
    if (cityName) {
        const cn = cityName;
        out.push((longTokens.join(' ') + ' ' + cn).trim());
        out.push((tokens.slice(-3).join(' ') + ' ' + cn).trim());
    }
    // dedupe and return
    return Array.from(new Set(out)).filter(s => s && s.length > 2);
}

async function tryCandidatesWithMapbox(candidates, bbox, proximityParam, MAPBOX_TOKEN, preferTypes = ['address', 'street']) {
    if (!Array.isArray(candidates) || candidates.length === 0) return null;
    for (const cand of candidates) {
        try {
            for (const t of preferTypes) {
                const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(cand)}.json?access_token=${MAPBOX_TOKEN}&proximity=${proximityParam}&bbox=${bbox}&types=${t}&language=pt&limit=1`;
                console.log('[GEO fuzzy] tentando:', url);
                const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
                if (!resp || !resp.ok) continue;
                const jd = await resp.json();
                if (jd && jd.features && jd.features.length > 0) {
                    const r = jd.features[0];
                    if (r && r.center && r.center.length >= 2) return r;
                }
            }
        } catch (e) { /* ignore per-candidate */ }
    }
    return null;
}


/**
 * Busca de coordenadas usando Mapbox Geocoding API - Motor OFICIAL
 * Tolerante a erros de digitação, extremamente preciso e rápido
 * @param {string} address - Endereço para buscar
 * @param {object} bounds - Bounds de busca (opcional) { south, north, west, east }
 * @returns {Promise<object|null>} { lat, lng, display_name } ou null
 */
export async function geocodeMapbox(address, bounds = null, proximity = null) {
    if (!address || address.trim().length < 3) return null;

    try {
        const MAPBOX_TOKEN = 'pk.eyJ1IjoibGVhbmRyb2RpdGFtYXI4MiIsImEiOiJjbWpid2NsZDYwbDN4M2ZweWZsbTBvamV4In0.cmNRPggP9Y_zkZZ1Yq-_4w';

        // Default operacional amplo
        const defaultBounds = {
            south: -27.900,
            north: -27.350,
            west: -48.900,
            east: -48.350
        };

        // Detectar se o usuário especificou uma cidade ao final do endereço
        const strictCity = detectCityStrict(address);

        // Se detectamos cidade estrita, montamos input rígido e usamos centro + bbox da cidade
        if (strictCity) {
            const cityCenter = getCityCenter(strictCity);
            if (!cityCenter) return null; // sem coordenada de centro conhecida

            // montar string: {Logradouro}, {Número} - {Cidade}, SC, Brasil
            const input = cleanAndAssembleAddressForCity(address, strictCity);
            if (!input) return null;

            // usar proximity central da cidade (lng,lat)
            const proximityParam = `${Number(cityCenter.lng)},${Number(cityCenter.lat)}`;

            // bbox restrito em torno do centro da cidade (aprox. ~6km raio)
            const d = 0.06;
            const cityBounds = { west: cityCenter.lng - d, south: cityCenter.lat - d, east: cityCenter.lng + d, north: cityCenter.lat + d };
            const bbox = `${cityBounds.west},${cityBounds.south},${cityBounds.east},${cityBounds.north}`;

            console.log('[GEO v33] Cidade detectada (FORÇADA):', strictCity, 'input:', input, 'proximity:', proximityParam, 'bbox:', bbox);

            // 1) Tentar types=address
            const urlAddr = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(input)}.json?access_token=${MAPBOX_TOKEN}&proximity=${proximityParam}&bbox=${bbox}&types=address&language=pt&limit=3`;
            console.log('[GEO v33] URL (address):', urlAddr);
            const resp1 = await fetch(urlAddr, { headers: { 'Accept': 'application/json' } });
            if (resp1 && resp1.ok) {
                const d1 = await resp1.json();
                const feats = (d1 && d1.features) ? d1.features : [];
                // procurar primeiro resultado que pertença à cidade
                for (const r of feats) {
                    if (resultBelongsToCity(r, strictCity)) {
                        const lng = r.center[0], lat = r.center[1];
                        console.log('[GEO v33] Encontrado endereço em cidade correta (address):', { lat, lng });
                        return { lat, lng, display_name: r.place_name || input };
                    }
                }
            }

            // 2) tentar tipos=street (centro da via) dentro da mesma bbox
            const urlStreet = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(input)}.json?access_token=${MAPBOX_TOKEN}&proximity=${proximityParam}&bbox=${bbox}&types=street&language=pt&limit=5`;
            console.log('[GEO v33] URL (street):', urlStreet);
            const resp2 = await fetch(urlStreet, { headers: { 'Accept': 'application/json' } });
            if (resp2 && resp2.ok) {
                const d2 = await resp2.json();
                const feats2 = (d2 && d2.features) ? d2.features : [];
                for (const r of feats2) {
                    if (resultBelongsToCity(r, strictCity)) {
                        const lng = r.center[0], lat = r.center[1];
                        console.log('[GEO v33] Encontrado street em cidade correta:', { lat, lng });
                        return { lat, lng, display_name: r.place_name || input };
                    }
                }
            }

            // Se não encontramos nada dentro da cidade, tentar variações fuzzy antes de desistir
            console.warn('[GEO v33] Nenhum resultado válido dentro da cidade especificada:', strictCity, 'tentando fallback fuzzy');
            try {
                const candidates = createFuzzyCandidates(input, strictCity);
                if (candidates && candidates.length > 0) {
                    const fuzzy = await tryCandidatesWithMapbox(candidates, bbox, proximityParam, MAPBOX_TOKEN, ['address', 'street']);
                    if (fuzzy && resultBelongsToCity(fuzzy, strictCity)) {
                        const lng = fuzzy.center[0], lat = fuzzy.center[1];
                        return { lat, lng, display_name: fuzzy.place_name || input };
                    }
                }
            } catch (e) { /* ignore fuzzy errors */ }
            return null;
        }

        // --- Fluxo anterior (sem cidade estrita) ---
        const b = bounds || defaultBounds;
        const bbox = `${b.west},${b.south},${b.east},${b.north}`;

        // Mantém comportamento anterior de anexar contexto quando cidade ausente
        const knownCities = ['biguaçu', 'biguacu', 'florianópolis', 'florianopolis', 'são josé', 'sao jose', 'palhoça', 'palhoca', 'ingleses', 'santo amaro', 'campinas', 'kobrasol', 'pagani', 'pagãni', 'ponte do imaruí', 'ponte do imarui', 'bela vista', 'serraria'];
        const lowerAddr = String(address || '').toLowerCase();
        let addressWithCity = address;
        const hasKnownCity = knownCities.some(c => lowerAddr.indexOf(c) !== -1) || /,\s*[a-zA-Z]/.test(address);
        if (!hasKnownCity) {
            addressWithCity = `${addressWithCity.trim()}, SC, Brasil`;
        }

        let addressClean = (addressWithCity || address)
            .replace(/,\s*,+/g, ',')
            .replace(/\s*,\s*/g, ', ')
            .replace(/,\s*$/g, '')
            .replace(/\s+/g, ' ')
            .trim();

        // Remover tokens de unidade/prédio e normalizar espaços triplos antes de enviar ao Mapbox
        addressClean = addressClean.replace(/\b(n[º°]?|n\.?|unidade|apt[o]?|apto|bloco|torre|condom[ií]nio|cond\.?|andar|apartamento|ap|#)\b/ig, '').replace(/\s{2,}/g, ' ').trim();

        console.log('🧹 Mapbox - Endereço limpo:', addressClean);

        // proximity: usar proximity param se fornecido, senão central Florianópolis
        let proximityParam = '-48.54,-27.59';
        try {
            if (proximity && typeof proximity === 'object' && proximity.lat != null && proximity.lng != null) {
                proximityParam = `${Number(proximity.lng)},${Number(proximity.lat)}`;
            } else if (Array.isArray(proximity) && proximity.length === 2) {
                proximityParam = `${proximity[0]},${proximity[1]}`;
            }
        } catch (e) { }

        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(addressClean)}.json?` +
            `access_token=${MAPBOX_TOKEN}` +
            `&proximity=${proximityParam}` +
            `&bbox=${bbox}` +
            `&types=address` +
            `&language=pt` +
            `&limit=1`;

        console.log('[GEO] Input original:', address);
        console.log('[GEO] URL enviada ao Mapbox:', url);

        const response = await fetch(url, { headers: { 'Accept': 'application/json' } });
        if (!response.ok) {
            console.warn('⚠️ Mapbox resposta não-OK:', response.status);
            // Se Mapbox rejeitou a requisição por erro de payload (422), tentar variações simplificadas (fuzzy)
            if (response.status === 422) {
                try {
                    const candidates = createFuzzyCandidates(addressClean, null);
                    const fuzzy = await tryCandidatesWithMapbox(candidates, bbox, proximityParam, MAPBOX_TOKEN, ['address', 'street']);
                    if (fuzzy && fuzzy.center && fuzzy.center.length >= 2) {
                        const lng = fuzzy.center[0], lat = fuzzy.center[1];
                        if (lat <= b.north && lat >= b.south && lng >= b.west && lng <= b.east) {
                            return { lat, lng, display_name: fuzzy.place_name || addressClean };
                        }
                    }
                } catch (e) { /* ignore fuzzy errors */ }
            }
            return null;
        }
        const data = await response.json();
        let result = data && data.features && data.features.length > 0 ? data.features[0] : null;

        const isUnwantedPlaceType = (r) => {
            if (!r || !r.place_type) return false;
            const pt = r.place_type || [];
            const unwanted = pt.includes('place') || pt.includes('locality') || pt.includes('region');
            const wanted = pt.includes('address') || pt.includes('street');
            return unwanted && !wanted;
        };

        if (result && isUnwantedPlaceType(result)) result = null;

        // fallback street
        if (!result) {
            const urlStreet = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(addressClean)}.json?` +
                `access_token=${MAPBOX_TOKEN}` +
                `&proximity=${proximityParam}` +
                `&bbox=${bbox}` +
                `&types=street` +
                `&language=pt` +
                `&limit=1`;
            const resp2 = await fetch(urlStreet, { headers: { 'Accept': 'application/json' } });
            if (resp2 && resp2.ok) {
                const data2 = await resp2.json();
                if (data2 && data2.features && data2.features.length > 0) result = data2.features[0];
            }
            // Se ainda não encontramos resultado, tentar fuzzy candidates (relaxado)
            if (!result) {
                try {
                    const candidates = createFuzzyCandidates(addressClean, null);
                    const fuzzy = await tryCandidatesWithMapbox(candidates, bbox, proximityParam, MAPBOX_TOKEN, ['address', 'street']);
                    if (fuzzy && fuzzy.center && fuzzy.center.length >= 2) result = fuzzy;
                } catch (e) { /* ignore */ }
            }
        }

        if (!result) return null;

        const coords = result.center; // [lng, lat]
        const lng = coords[0], lat = coords[1];

        // Validação: dentro do bbox operacional
        const inBounds = (lat <= (b.north) && lat >= (b.south) && lng >= (b.west) && lng <= (b.east));
        if (!inBounds) { console.warn('⚠️ Mapbox retornou coordenadas fora do bbox operacional:', { lat, lng, bbox }); return null; }

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

        // VIEWBOX expandido: Grande Florianópolis (Ingleses, Florianópolis, São José, Palhoça, Biguaçu, Santo Amaro)
        const defaultBounds = {
            south: -27.900,
            north: -27.350,
            west: -48.900,
            east: -48.350
        };

        const b = bounds || defaultBounds;
        const bbox = `${b.west},${b.south},${b.east},${b.north}`;
        const proximity = '-48.54,-27.59'; // Centro de Florianópolis

        // Limpeza do query
        // Não forçar sufixo. Se o query não mencionar cidade, anexa 'SC, Brasil' para contexto.
        const knownCities = ['biguaçu', 'biguacu', 'florianópolis', 'florianopolis', 'são josé', 'sao jose', 'palhoça', 'palhoca', 'ingleses', 'santo amaro', 'palhoça'];
        const lowerQuery = String(query || '').toLowerCase();
        let queryWithCity = query;
        const hasKnownCity = knownCities.some(c => lowerQuery.indexOf(c) !== -1) || /,\s*[a-zA-Z]/.test(query);
        if (!hasKnownCity) queryWithCity = `${queryWithCity.trim()}, SC, Brasil`;

        const queryClean = (queryWithCity || query)
            .replace(/,\s*,+/g, ',')
            .replace(/\s*,\s*/g, ', ')
            .replace(/,\s*$/g, '')
            .replace(/\s+/g, ' ')
            .trim();

        // Permitir street também para garantir centro da via quando número não existir
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(queryClean)}.json?` +
            `access_token=${MAPBOX_TOKEN}` +
            `&proximity=${proximity}` +
            `&bbox=${bbox}` +
            `&types=address,street,poi` +
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
 * Obtém geometria de rota (seguindo ruas) usando Mapbox Directions API
 * @param {object} origin - { lat, lng }
 * @param {array} orderedPoints - array de pontos [{ lat, lng }, ...] na ordem desejada
 * @param {object} options - { includeReturnTo?: {lat,lng} }
 * @returns {Promise<{ coordsLatLng: Array, distanceMeters: number, durationSec: number, geometry: object }|null>}
 */
export async function getRouteGeometry(origin, orderedPoints = [], options = {}) {
    try {
        const MAPBOX_TOKEN = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_MAPBOX_TOKEN) ? import.meta.env.VITE_MAPBOX_TOKEN : null;
        if (!MAPBOX_TOKEN) return null;
        if (!origin || !Array.isArray(orderedPoints) || orderedPoints.length === 0) return null;

        // Build coordinate string: origin -> waypoints -> optional return
        const coordsArr = [];
        coordsArr.push(`${Number(origin.lng)},${Number(origin.lat)}`);
        for (const p of orderedPoints) {
            if (!p || p.lat == null || p.lng == null) continue;
            coordsArr.push(`${Number(p.lng)},${Number(p.lat)}`);
        }
        if (options && options.includeReturnTo && options.includeReturnTo.lat != null && options.includeReturnTo.lng != null) {
            coordsArr.push(`${Number(options.includeReturnTo.lng)},${Number(options.includeReturnTo.lat)}`);
        }

        const coordsStr = coordsArr.join(';');
        const base = `https://api.mapbox.com/directions/v5/mapbox/driving/${coordsStr}`;
        const params = `?geometries=geojson&overview=full&annotations=distance,duration&access_token=${MAPBOX_TOKEN}`;
        const url = base + params;
        const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
        if (!resp || !resp.ok) return null;
        const jd = await resp.json();
        if (!jd || !jd.routes || jd.routes.length === 0) return null;
        const route = jd.routes[0];
        const geometry = route.geometry || null; // geojson LineString
        const distanceMeters = typeof route.distance === 'number' ? route.distance : null;
        const durationSec = typeof route.duration === 'number' ? route.duration : null;
        // geometry.coordinates are [lng,lat], convert to [lat,lng]
        const coordsLatLng = (geometry && Array.isArray(geometry.coordinates)) ? geometry.coordinates.map(c => [Number(c[1]), Number(c[0])]) : [];
        return { coordsLatLng, distanceMeters, durationSec, geometry };
    } catch (e) {
        console.error('getRouteGeometry failed:', e);
        return null;
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

