// ===== UTILIDADES GEOGRÁFICAS (SEM APIS EXTERNAS) =====
// Funções matemáticas para cálculo de distância e otimização de rotas

export const limparEnderecoParaMapbox = (enderecoBruto) => {
    if (!enderecoBruto) return '';

    // 1. Remove termos que confundem o Mapbox
    let texto = String(enderecoBruto)
        .replace(/ - Palhoça.*/gi, '')
        .replace(/Palhoça, SC, Brasil/gi, '')
        .replace(/Florianópolis, SC, Brasil/gi, '')
        .replace(/São José, SC, Brasil/gi, '');

    // 2. Limpa espaços extras, vírgulas duplicadas e retorna
    return texto
        .replace(/, ,/g, ',')
        .replace(/,,/g, ',')
        .replace(/\s+/g, ' ')
        .replace(/,$/, '')
        .trim();
};

// Exportada: monta a query curta/limpa enviada ao Mapbox (evita repetir bairro)
export const montarQueryMapbox = (enderecoBruto) => {
    if (!enderecoBruto) return '';

    // 1. Limpeza inicial
    let d = enderecoBruto.replace(/Rua Avenida/gi, 'Avenida').trim();
    let textoMinusculo = d.toLowerCase();

    // 2. DETECTOR DE CIDADES (A Peneira de Região)
    let cidadeDetectada = 'Palhoça'; // Cidade padrão

    if (textoMinusculo.includes('fpolis') || textoMinusculo.includes('florianopolis') || textoMinusculo.includes('florianópolis')) {
        cidadeDetectada = 'Florianópolis';
    } else if (textoMinusculo.includes('sao jose') || textoMinusculo.includes('são josé')) {
        cidadeDetectada = 'São José';
    } else if (textoMinusculo.includes('biguacu') || textoMinusculo.includes('biguaçu')) {
        cidadeDetectada = 'Biguaçu';
    } else if (textoMinusculo.includes('santo amaro')) {
        cidadeDetectada = 'Santo Amaro da Imperatriz';
    }

    // 3. SEPARAÇÃO DE RUA E NÚMERO
    let partes = d.split(/[,\-]/).map(p => p.trim());
    const rua = partes[0] || '';
    let numero = '';

    if (partes[1] && /\d/.test(partes[1])) {
        numero = partes[1].split(' ')[0];
    }

    // 4. MONTAGEM DA QUERY (Sempre com o estado SC e Brasil para não ter erro)
    const queryFinal = `${rua}, ${numero}, ${cidadeDetectada}, SC, Brasil`
        .replace(/ ,/g, ',')
        .replace(/,,/g, ',')
        .replace(/\s+/g, ' ')
        .trim();

    console.log(`🎯 [GEO REGIONAL] Cidade: ${cidadeDetectada} | Query: ${queryFinal}`);
    return queryFinal;
};

// Formata um endereço para busca estrita no Mapbox: Rua+Número, Cidade, Estado, Brasil
export const formatarEnderecoParaBusca = (enderecoBruto) => {
    if (!enderecoBruto) return '';

    // 1. Remove "Rua Avenida" (deixa só um ou outro se vierem juntos)
    let d = enderecoBruto.replace(/Rua Avenida/gi, 'Avenida');

    // 2. Divide pelas vírgulas ou traços
    let partes = d.split(/[,\-]/).map(p => p.trim()).filter(Boolean);

    // 3. Pegamos a PRIMEIRA parte (Rua + Número) e ignoramos o resto (Bairro)
    // Se o endereço for "Avenida Pedra Branca, 95, Pedra Branca",
    // partes[0] será "Avenida Pedra Branca" e partes[1] será "95".
    const rua = partes[0] || '';
    const numero = partes[1] || '';

    const ruaComNumero = `${rua} ${numero}`.trim();
    const cidade = "Palhoça";
    const estado = "SC";

    // A query enviada tem que ser SÓ isso:
    const queryFinal = `${ruaComNumero}, ${cidade}, ${estado}, Brasil`.replace(/\s+,/g, ',').replace(/\s+/g, ' ').trim();

    return queryFinal;
};

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

    // Remover possíveis segmentos de bairro que possam ter vindo junto ao logradouro
    try { street = removeNeighborhoodSegments(street); } catch (e) { /* ignore */ }

    const assembled = number ? `${street}, ${number} - ${cityName}, SC, Brasil` : `${street} - ${cityName}, SC, Brasil`;
    return assembled;
}

// Remove segmentos que claramente se referem a bairro/condomínio para evitar ambiguidade
function removeNeighborhoodSegments(raw) {
    if (!raw) return raw;
    const parts = raw.split(',').map(p => p.trim()).filter(Boolean);
    const blacklist = /\b(bairro|bairro de|jd|jardim|vil(a)?|loteamento|condom[ií]nio|conjunto|setor|quadra)\b/i;
    const filtered = parts.filter(p => !blacklist.test(p));
    return filtered.join(', ');
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
                const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(limparEnderecoParaMapbox(cand))}.json?access_token=${MAPBOX_TOKEN}&proximity=${proximityParam}&bbox=${bbox}&types=${t}&language=pt&limit=1`;
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
    // 🛑 Aplicar filtro logo na porta de entrada para evitar 422 e requisições desnecessárias
    try {
        const addressEntryClean = limparEnderecoParaMapbox(address);
        console.log(`🚀 [GEO] Iniciando busca com endereço limpo: ${addressEntryClean}`);
        address = addressEntryClean;
    } catch (e) {
        // se a limpeza falhar por algum motivo, continuar com o valor original
        console.warn('[GEO] limpeza inicial falhou, usando endereço original', e);
    }

    if (!address || address.trim().length < 3) return null;

    try {
        const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || '';

        // v45/v48: regras agressivas para casos conhecidos
        try {
            // LIMPEZA INICIAL REFORÇADA: remover símbolos comuns que atrapalham o geocoding
            let raw = String(address || '');
            // remover travessões, # e colapsar espaços (remoção de 'nº' delegada à função de limpeza central)
            raw = raw.replace(/[–—−]/g, ' ')
                .replace(/#/g, ' ')
                .replace(/\s{2,}/g, ' ')
                .trim();
            const lower = raw.toLowerCase();

            // Fix para erros de digitação/variações 'ajla' / 'najla' -> RUa Najla Carone Guedert
            if (lower.indexOf('ajla') !== -1 || lower.indexOf('najla') !== -1) {
                const fixedNj = 'Rua Najla Carone Guedert, 821, Pagani, Palhoça, SC';
                try {
                    const cityCenter = getCityCenter('Palhoça') || { lat: -27.64, lng: -48.67 };
                    const d = 0.03;
                    const cityBounds = { west: cityCenter.lng - d, south: cityCenter.lat - d, east: cityCenter.lng + d, north: cityCenter.lat + d };
                    const bbox = `${cityBounds.west},${cityBounds.south},${cityBounds.east},${cityBounds.north}`;
                    const proximityParam = `${Number(cityCenter.lng)},${Number(cityCenter.lat)}`;
                    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(limparEnderecoParaMapbox(fixedNj))}.json?access_token=${MAPBOX_TOKEN}&proximity=${proximityParam}&bbox=${bbox}&types=address&language=pt&limit=1`;
                    const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
                    if (resp && resp.ok) {
                        const jd = await resp.json();
                        if (jd && jd.features && jd.features.length > 0) {
                            const r = jd.features[0];
                            if (r && r.center && r.center.length >= 2) {
                                const lng = r.center[0], lat = r.center[1];
                                return { lat, lng, display_name: r.place_name || fixedNj };
                            }
                        }
                    }
                } catch (e) { /* fallthrough */ }
            }

            // Regra agressiva para Ponte do Imaruí (usa CEP e endereço fixo)
            // Regra agressiva para Morro das Feiticeiras (forçar Florianópolis + CEP)
            if (lower.indexOf('morro das feiticeiras') !== -1 || lower.indexOf('feiticeiras') !== -1) {
                // Forçar busca para Ingleses Norte quando aparecer Feiticeiras
                const fixedMorro = 'Rua Morro das Feiticeiras, Ingleses Norte, Florianópolis, SC, 88058-583, Brasil';
                try {
                    const cityCenter = getCityCenter('Florianópolis') || { lat: -27.59, lng: -48.54 };
                    const d = 0.03;
                    const cityBounds = { west: cityCenter.lng - d, south: cityCenter.lat - d, east: cityCenter.lng + d, north: cityCenter.lat + d };
                    const bbox = `${cityBounds.west},${cityBounds.south},${cityBounds.east},${cityBounds.north}`;
                    const proximityParam = `${Number(cityCenter.lng)},${Number(cityCenter.lat)}`;
                    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(limparEnderecoParaMapbox(fixedMorro))}.json?access_token=${MAPBOX_TOKEN}&proximity=${proximityParam}&bbox=${bbox}&types=address&language=pt&limit=1`;
                    const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
                    if (resp && resp.ok) {
                        const jd = await resp.json();
                        if (jd && jd.features && jd.features.length > 0) {
                            const r = jd.features[0];
                            if (r && r.center && r.center.length >= 2) {
                                const lng = r.center[0], lat = r.center[1];
                                return { lat, lng, display_name: r.place_name || fixedMorro };
                            }
                        }
                    }
                } catch (e) { /* fallthrough */ }
            }
            if (lower.indexOf('ponte imaruim') !== -1 || lower.indexOf('ponte do imarui') !== -1 || lower.indexOf('ponte do imaruí') !== -1) {
                // endereço fixo com CEP para evitar ambiguidade do Mapbox
                const fixed = 'Rua Graciliano Ramos, 177, Ponte do Imaruí, Palhoça, SC, 88130-490';
                try {
                    const cityCenter = getCityCenter('Palhoça') || { lat: -27.64, lng: -48.67 };
                    const d = 0.03;
                    const cityBounds = { west: cityCenter.lng - d, south: cityCenter.lat - d, east: cityCenter.lng + d, north: cityCenter.lat + d };
                    const bbox = `${cityBounds.west},${cityBounds.south},${cityBounds.east},${cityBounds.north}`;
                    const proximityParam = `${Number(cityCenter.lng)},${Number(cityCenter.lat)}`;
                    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(limparEnderecoParaMapbox(fixed))}.json?access_token=${MAPBOX_TOKEN}&proximity=${proximityParam}&bbox=${bbox}&types=address&language=pt&limit=1`;
                    const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
                    if (resp && resp.ok) {
                        const jd = await resp.json();
                        if (jd && jd.features && jd.features.length > 0) {
                            const r = jd.features[0];
                            if (r && r.center && r.center.length >= 2) {
                                const lng = r.center[0], lat = r.center[1];
                                return { lat, lng, display_name: r.place_name || fixed };
                            }
                        }
                    }
                } catch (e) { /* fallthrough to normal flow if fixed search fails */ }
            }
        } catch (e) { /* ignore aggressive rule errors */ }

        // Usamos a função exportada `montarQueryMapbox` definida no escopo global acima

        // BBox restrito à Grande Florianópolis (SW: -28.0,-48.9 | NE: -27.3,-48.3)
        const defaultBounds = {
            south: -28.0,
            north: -27.3,
            west: -48.9,
            east: -48.3
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

            // 🧹 1. Limpar e encodar o endereço UMA VEZ com segurança
            // Usar montarQueryMapbox para evitar repetir bairro e montar query concisa
            const queryLimpa = montarQueryMapbox(address);

            // 🛡️ Trava de segurança contra Erro 422: se sobrar vazio, nem envia
            if (!queryLimpa || queryLimpa.trim() === "") {
                console.warn(`[GEO v33] ❌ Busca abortada: Endereço vazio após a limpeza (original: "${input}")`);
                return null;
            }

            const encodedQuery = encodeURIComponent(queryLimpa);

            // bbox restrito em torno do centro da cidade (aprox. ~6km raio)
            const d = 0.06;
            const cityBounds = { west: cityCenter.lng - d, south: cityCenter.lat - d, east: cityCenter.lng + d, north: cityCenter.lat + d };
            const bbox = `${cityBounds.west},${cityBounds.south},${cityBounds.east},${cityBounds.north}`;

            console.log('[GEO v33] Cidade detectada (FORÇADA):', strictCity, '| Query Limpa:', queryLimpa, '| bbox:', bbox);

            // 1) Tentar types=address
            // Use limit=1 to return the single most probable result (address precision)
            const urlAddr = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodedQuery}.json?access_token=${MAPBOX_TOKEN}&proximity=${proximityParam}&bbox=${bbox}&types=address&language=pt&limit=1`;
            console.log('[GEO v33] URL (address):', urlAddr);
            const resp1 = await fetch(urlAddr, { headers: { 'Accept': 'application/json' } });
            if (resp1 && resp1.ok) {
                const d1 = await resp1.json();
                const feats = (d1 && d1.features) ? d1.features : [];
                // procurar primeiro resultado que pertença à cidade
                for (const r of feats) {
                    if (resultBelongsToCity(r, strictCity)) {
                        const lng = r.center[0], lat = r.center[1];
                        console.log('[GEO v33] ✅ Encontrado endereço em cidade correta (address):', { lat, lng });
                        return { lat, lng, display_name: r.place_name || input };
                    }
                }
            }

            // 2) tentar tipos=street (centro da via) dentro da mesma bbox
            // O Mapbox rejeita números quando a busca é estritamente types=street.
            // Vamos remover os dígitos da query limpa apenas para essa URL.
            const querySemNumerosParaRua = queryLimpa.replace(/\d+/g, '').replace(/,\s*,/g, ',').replace(/^\s*,\s*/, '').trim();
            const encodedStreetQuery = encodeURIComponent(querySemNumerosParaRua);

            const urlStreet = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodedStreetQuery}.json?access_token=${MAPBOX_TOKEN}&proximity=${proximityParam}&bbox=${bbox}&types=street&language=pt&limit=5`;
            console.log('[GEO v33] URL (street sem números):', urlStreet);
            const resp2 = await fetch(urlStreet, { headers: { 'Accept': 'application/json' } });
            if (resp2 && resp2.ok) {
                const d2 = await resp2.json();
                const feats2 = (d2 && d2.features) ? d2.features : [];
                for (const r of feats2) {
                    if (resultBelongsToCity(r, strictCity)) {
                        const lng = r.center[0], lat = r.center[1];
                        console.log('[GEO v33] ✅ Encontrado street em cidade correta:', { lat, lng });
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
        const b = Object.assign({}, bounds || defaultBounds);
        // Se detectamos Ingleses no texto original, expandir levemente o bbox para cobrir o Norte da Ilha
        try {
            const lowerAddr = String(address || '').toLowerCase();
            if (lowerAddr.indexOf('ingleses') !== -1 || lowerAddr.indexOf('feiticeiras') !== -1) {
                // Move limite norte para cobrir Ingleses/Norte da Ilha e afrouxa limites laterais
                b.north = Math.max(b.north || -27.35, -27.20);
                b.west = Math.min(b.west || -48.9, -48.95);
                b.east = Math.max(b.east || -48.35, -48.25);
                console.log('[GEO v51] Ajustado bbox para Ingleses/Feiticeiras:', b);
            }
        } catch (e) { /* ignore bbox adjust errors */ }
        const bbox = `${b.west},${b.south},${b.east},${b.north}`;

        // Mantém comportamento anterior de anexar contexto quando cidade ausente
        const knownCities = ['biguaçu', 'biguacu', 'florianópolis', 'florianopolis', 'são josé', 'sao jose', 'palhoça', 'palhoca', 'ingleses', 'santo amaro', 'campinas', 'kobrasol', 'pagani', 'pagãni', 'ponte do imaruí', 'ponte do imarui', 'bela vista', 'serraria'];
        const lowerAddr = String(address || '').toLowerCase();
        let addressWithCity = address;
        const hasKnownCity = knownCities.some(c => lowerAddr.indexOf(c) !== -1) || /,\s*[a-zA-Z]/.test(address);

        // v44/v46: regras rígidas de sufixo para evitar geocoding incorreto
        // Se o gestor NÃO indicar cidade, anexamos explicitamente 'Palhoça, SC, Brasil'
        try {
            if (lowerAddr.indexOf('ponte imaruim') !== -1 || lowerAddr.indexOf('ponte do imarui') !== -1 || lowerAddr.indexOf('pagani') !== -1 || lowerAddr.indexOf('nova palhoca') !== -1) {
                addressWithCity = `${addressWithCity.trim()}, Palhoça, SC, Brasil`;
            } else if (lowerAddr.indexOf('campinas') !== -1) {
                addressWithCity = `${addressWithCity.trim()}, São José, SC, Brasil`;
            } else if (lowerAddr.indexOf('ingleses') !== -1 || lowerAddr.indexOf('feiticeiras') !== -1) {
                // Regra rígida v51: quando detectamos Ingleses ou Feiticeiras, anexa sufixo específico para Ingleses Norte
                addressWithCity = `${addressWithCity.trim()}, Ingleses Norte, Florianópolis, SC, 88058-583, Brasil`;
            } else if (!hasKnownCity) {
                // Default para a Grande Florianópolis: assumir Palhoça quando cidade não foi informada
                addressWithCity = `${addressWithCity.trim()}, Palhoça, SC, Brasil`;
            }
        } catch (e) {
            addressWithCity = `${addressWithCity.trim()}, Palhoça, SC, Brasil`;
        }

        let addressClean = (addressWithCity || address)
            .replace(/,\s*,+/g, ',')
            .replace(/\s*,\s*/g, ', ')
            .replace(/,\s*$/g, '')
            .replace(/\s+/g, ' ')
            .trim();

        // Remover segmentos de bairro/condomínio da query para evitar ambiguidade
        try {
            addressClean = removeNeighborhoodSegments(addressClean);
        } catch (e) { /* ignore */ }

        // Garantir formato: logradouro + número + cidade + estado + Brasil
        try {
            if (!strictCity) {
                const assembled = cleanAndAssembleAddressForCity(addressClean, 'Palhoça');
                if (assembled) addressClean = assembled;
            }
        } catch (e) { /* ignore */ }

        // Remover tokens de unidade/prédio e normalizar espaços antes de enviar ao Mapbox
        addressClean = addressClean.replace(/\b(n[º°]?|n\.?|unidade|apt[o]?|apto|bloco|torre|condom[ií]nio|cond\.?|andar|apartamento|ap)\b/ig, '').replace(/\s{2,}/g, ' ').trim();

        // Remover parênteses e caracteres especiais desnecessários, manter apenas letras, números, vírgulas, espaços e hífens
        addressClean = addressClean.replace(/\(.*?\)/g, '').replace(/[^0-9A-Za-zÀ-ÿ, \-]/g, ' ').replace(/\s{2,}/g, ' ').trim();

        // Aplicar limpeza adicional centralizada antes de enviar ao Mapbox
        const enderecoFiltrado = limparEnderecoParaMapbox(addressClean);
        console.log(`🧹 Endereço limpo: de "${addressClean}" para "${enderecoFiltrado}"`);
        addressClean = enderecoFiltrado;

        // v54: PRÉ-BUSCA DE CEP (se o gestor não informou um CEP, tentar obter postcode via Mapbox)
        let foundPostcode = null;
        try {
            const cepRegex = /(\d{5}-\d{3}|\d{8})/;
            if (!cepRegex.test(addressClean)) {
                // tentar buscar postcode por types=postcode usando o termo limpo
                const postcodeUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(limparEnderecoParaMapbox(addressClean))}.json?access_token=${MAPBOX_TOKEN}&bbox=${bbox}&proximity=${proximityParam}&types=postcode&language=pt&limit=1`;
                console.log('[GEO v54] Tentando obter CEP via Mapbox (postcode lookup):', postcodeUrl);
                try {
                    const respPc = await fetch(postcodeUrl, { headers: { 'Accept': 'application/json' } });
                    if (respPc && respPc.ok) {
                        const jdpc = await respPc.json();
                        if (jdpc && jdpc.features && jdpc.features.length > 0) {
                            const pc = jdpc.features[0];
                            // Mapbox retorna o texto do feature como postcode em muitos casos
                            const pcText = (pc && pc.text) ? String(pc.text).trim() : (pc && pc.place_name ? String(pc.place_name).trim() : null);
                            if (pcText && /\d{5}/.test(pcText)) {
                                // normalizar para 5-3 quando possível
                                const digits = pcText.replace(/[^0-9]/g, '');
                                if (digits.length === 8) foundPostcode = digits.slice(0, 5) + '-' + digits.slice(5);
                                else if (digits.length === 7) foundPostcode = digits; else foundPostcode = pcText;
                                console.log('[GEO v54] CEP encontrado via postcode lookup:', foundPostcode);
                            }
                        }
                    }
                } catch (e) { console.warn('[GEO v54] postcode lookup falhou:', e); }
            } else {
                // extrair CEP diretamente se já fornecido
                const m = addressClean.match(/(\d{5}-\d{3}|\d{8})/);
                if (m) {
                    const d = m[1].replace(/[^0-9]/g, '');
                    foundPostcode = (d.length === 8) ? (d.slice(0, 5) + '-' + d.slice(5)) : m[1];
                }
            }
        } catch (e) { /* ignore postcode errors */ }

        // Se encontramos um CEP, refazer a busca usando [CEP], [Número], [Cidade] para máxima precisão
        if (foundPostcode) {
            try {
                // extrair número se presente
                const numMatch = String(address || '').match(/(\d+[A-Za-z0-9\/\-]*)/);
                const numberToken = numMatch ? numMatch[1] : '';
                // extrair parte de logradouro (antes da vírgula)
                const streetOnly = (addressClean && addressClean.split(',') && addressClean.split(',').length > 0) ? addressClean.split(',')[0].trim() : addressClean;
                // priorizar cidade detectada ou forçar Florianópolis para Ingleses/Feiticeiras
                let cityForSearch = detectCityStrict(address) || null;
                const lowerAddrLocal = String(address || '').toLowerCase();
                if (!cityForSearch && (lowerAddrLocal.indexOf('ingleses') !== -1 || lowerAddrLocal.indexOf('feiticeiras') !== -1)) cityForSearch = 'Florianópolis';

                const searchWithCep = `${streetOnly}${numberToken ? (', ' + numberToken) : ''}, ${foundPostcode}${cityForSearch ? (', ' + cityForSearch + ', SC, Brasil') : ''}`;
                const urlCep = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(limparEnderecoParaMapbox(searchWithCep))}.json?access_token=${MAPBOX_TOKEN}&proximity=${proximityParam}&bbox=${bbox}&types=address&language=pt&limit=1`;
                console.log('[GEO v54] Reconsultando com CEP para precisão:', searchWithCep, urlCep);
                try {
                    const respCep = await fetch(urlCep, { headers: { 'Accept': 'application/json' } });
                    if (respCep && respCep.ok) {
                        const datacep = await respCep.json();
                        if (datacep && datacep.features && datacep.features.length > 0) {
                            const r = datacep.features[0];
                            if (r && r.center && r.center.length >= 2) {
                                const lng = r.center[0], lat = r.center[1];
                                console.log('[GEO v54] Resultado via CEP (preciso):', { lat, lng, postcode: foundPostcode });
                                return { lat, lng, display_name: r.place_name || searchWithCep, postcode: foundPostcode };
                            }
                        }
                    }
                } catch (e) { /* fallthrough to normal flow if CEP-based search fails */ }
            } catch (e) { /* ignore cep requery issues */ }
        }

        // proximity: usar proximity param se fornecido, senão centralizar em Palhoça (prioridade local)
        let proximityParam = '-48.67,-27.64';
        try {
            if (proximity && typeof proximity === 'object' && proximity.lat != null && proximity.lng != null) {
                proximityParam = `${Number(proximity.lng)},${Number(proximity.lat)}`;
            } else if (Array.isArray(proximity) && proximity.length === 2) {
                proximityParam = `${proximity[0]},${proximity[1]}`;
            }
        } catch (e) { }

        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(limparEnderecoParaMapbox(addressClean))}.json?` +
            `access_token=${MAPBOX_TOKEN}` +
            `&proximity=${proximityParam}` +
            `&bbox=${bbox}` +
            `&types=address` +
            `&language=pt` +
            `&limit=1`;

        console.log('[GEO] Input original:', address);
        console.log('[GEO] URL enviada ao Mapbox:', url);

        const response = await fetch(url, { headers: { 'Accept': 'application/json' } });
        
        // 🛑 Fallback para Nominatim se Mapbox falhar (401/403 ou limite atingido)
        if (!response.ok && (response.status === 401 || response.status === 403)) {
            console.warn(`⚠️ Mapbox retornou ${response.status}. Tentando fallback Nominatim para: ${addressClean}`);
            const nomUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(addressClean)}&limit=1`;
            try {
                const nomResp = await fetch(nomUrl, { headers: { 'User-Agent': 'V10-Logistica-Dashboard' } });
                if (nomResp.ok) {
                    const nomData = await nomResp.json();
                    if (nomData && nomData.length > 0) {
                        const first = nomData[0];
                        console.log('✅ Fallback Nominatim funcionou!');
                        return { 
                            lat: parseFloat(first.lat), 
                            lng: parseFloat(first.lon), 
                            display_name: first.display_name,
                            source: 'nominatim'
                        };
                    }
                }
            } catch (nomErr) {
                console.error('❌ Fallback Nominatim também falhou:', nomErr);
            }
        }

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
            // Para buscas estritas por rua, remover números para evitar Erro 422
            const queryStreetFallback = limparEnderecoParaMapbox(addressClean).replace(/\d+/g, '').replace(/,\s*,/g, ',').replace(/^\s*,\s*/, '').trim();
            if (queryStreetFallback && queryStreetFallback.length > 0) {
                const encodedStreetFallback = encodeURIComponent(queryStreetFallback);
                const urlStreet = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodedStreetFallback}.json?` +
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
            } else {
                console.warn('[GEO] fallback street abortado: query vazia após remoção de números');
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

        if (!result) {
            // Tentativa extra (fallback específico v162):
            // Se o endereço mencionar 'Morro das Feiticeiras' OU se não houve resultados,
            // tentar uma busca simplificada: Rua + Numero + Cidade.
            try {
                const lowerAddrFull = String(address || '').toLowerCase();
                const shouldTryFallback = lowerAddrFull.indexOf('morro das feiticeiras') !== -1 || lowerAddrFull.indexOf('feiticeiras') !== -1 || true;
                // NOTE: o `|| true` acima garante que este bloco rode quando "não houve resultado" (estamos aqui).
                if (shouldTryFallback) {
                    // Extrair número se presente
                    const numMatch = String(address || '').match(/(\d+[A-Za-z0-9\/\-]*)/);
                    const numberToken = numMatch ? numMatch[1] : '';

                    // Preparar streetOnly: remover nomes de condomínio e o bairro longo 'Ingleses do Rio Vermelho'
                    let streetOnly = String(address || '')
                        .replace(/Ingleses do Rio Vermelho/ig, '')
                        .replace(/condom[ií]nio[^,]*/ig, '')
                        .replace(/cond\.\s*[^,]*/ig, '')
                        .replace(/torre[^,]*/ig, '')
                        .replace(/bloco[^,]*/ig, '')
                        .replace(/apartamento[^,]*/ig, '')
                        .replace(/apto[^,]*/ig, '')
                        .replace(/unidade[^,]*/ig, '')
                        .replace(/\(.*?\)/g, '')
                        .replace(/,\s*,+/g, ',')
                        .trim();

                    // Remover qualquer vírgula final e tokens de bairro grandes que possam confundir
                    streetOnly = streetOnly.split(',').map(s => s.trim()).filter(Boolean).slice(0, 2).join(', ');

                    // Determinar cidade: preferir cidade detectada, senão usar Florianópolis quando 'ingleses' detectado
                    let cityForSearch = detectCityStrict(address) || null;
                    if (!cityForSearch) {
                        if (lowerAddrFull.indexOf('ingleses') !== -1 || lowerAddrFull.indexOf('feiticeiras') !== -1) cityForSearch = 'Florianópolis';
                    }
                    // Montar query simplificada (Rua, Número, Cidade)
                    const simpleQuery = `${streetOnly}${numberToken ? (', ' + numberToken) : ''}${cityForSearch ? (', ' + cityForSearch + ', SC, Brasil') : ''}`.replace(/\s{2,}/g, ' ').trim();

                    if (simpleQuery && simpleQuery.length > 5) {
                        try {
                            const urlSimple = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(limparEnderecoParaMapbox(simpleQuery))}.json?access_token=${MAPBOX_TOKEN}&proximity=${proximityParam}&bbox=${bbox}&types=address&language=pt&limit=1`;
                            console.log('[GEO v162-fallback] Tentando busca simplificada:', simpleQuery, urlSimple);
                            const respSimple = await fetch(urlSimple, { headers: { 'Accept': 'application/json' } });
                            if (respSimple && respSimple.ok) {
                                const jdSimple = await respSimple.json();
                                if (jdSimple && jdSimple.features && jdSimple.features.length > 0) {
                                    const r = jdSimple.features[0];
                                    if (r && r.center && r.center.length >= 2) {
                                        const lng = r.center[0], lat = r.center[1];
                                        // Validação de bbox operacional
                                        if (lat <= (b.north) && lat >= (b.south) && lng >= (b.west) && lng <= (b.east)) {
                                            console.log('[GEO v162-fallback] Sucesso na busca simplificada:', { lat, lng, simpleQuery });
                                            return { lat, lng, display_name: r.place_name || simpleQuery };
                                        }
                                    }
                                }
                            }
                        } catch (e) { /* fallthrough to null */ }
                    }
                }
            } catch (e) { /* ignore fallback errors */ }
            return null;
        }

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

// Busca simplificada e robusta conforme solicitado pelo time — utilidade geral
export const buscarCoordenadasMelhoradas = async (enderecoBruto) => {
    try {
        if (!enderecoBruto || !String(enderecoBruto).trim()) return null;

        // 1. Limpeza: Remove complementos, mas preserva números de endereço
        let query = String(enderecoBruto)
            .replace(/\b(casa|fundos|apto|apartamento|bloco|ao lado de|n°|num|numero)\b/gi, '')
            .replace(/\s{2,}/g, ' ')
            .trim();

        // 2. Inteligência de Localidade: Evita duplicar a cidade
        const defaultCity = 'São José, SC, Brasil';
        if (!query.toLowerCase().includes('são josé') && !query.toLowerCase().includes('sao jose')) {
            query = `${query}, ${defaultCity}`;
        }

        const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || '';
        if (!MAPBOX_TOKEN) {
            console.warn('buscarCoordenadasMelhoradas: VITE_MAPBOX_TOKEN não está definido');
            return null;
        }

        // Aplicar limpeza centralizada antes de enviar ao Mapbox (mesma função usada no fluxo principal)
        const enderecoFiltradoMelhorado = limparEnderecoParaMapbox(query);
        console.log(`🧹 Endereço limpo (melhoradas): de "${query}" para "${enderecoFiltradoMelhorado}"`);
        query = enderecoFiltradoMelhorado;

        // 3. Parâmetros de Alta Precisão
        const url = new URL(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(limparEnderecoParaMapbox(query))}.json`);
        url.searchParams.append('access_token', MAPBOX_TOKEN);
        url.searchParams.append('proximity', '-48.67,-27.64'); // Foco na sua região (Palhoça)
        url.searchParams.append('country', 'br');
        url.searchParams.append('types', 'address,poi');
        url.searchParams.append('language', 'pt');
        url.searchParams.append('autocomplete', 'true'); // Ajuda com erros de digitação
        url.searchParams.append('fuzzyMatch', 'true');   // CORRIGE: "Aveida" -> "Avenida"
        url.searchParams.append('limit', '1');

        const resp = await fetch(url.toString());
        if (!resp || !resp.ok) return null;
        const data = await resp.json();

        if (data && data.features && data.features.length > 0) {
            const feat = data.features[0];
            const [lng, lat] = feat.center || [];
            const precisao = typeof feat.relevance === 'number' ? feat.relevance : (feat.properties && feat.properties.accuracy) || 0;

            if (precisao < 0.8) {
                console.warn('⚠️ Endereço com baixa precisão:', query, 'precisão:', precisao);
            }

            return {
                lat,
                lng,
                precisao,
                place_name: feat.place_name,
                context: feat.context || null
            };
        }

        return null;
    } catch (error) {
        console.error('Erro na geocodificação buscarCoordenadasMelhoradas:', error);
        return null;
    }
};

/**
 * Wrapper que tenta `geocodeMapbox` primeiro e cai para `buscarCoordenadasMelhoradas` como fallback.
 * @param {string} endereco - Endereço bruto
 * @param {object} opts - Opcional: { bounds, proximity }
 * @returns {Promise<object|null>} Objeto unificado: { lat, lng, display_name, precisao, context }
 */
export async function buscarCoordenadasComFallback(endereco, opts = {}) {
    try {
        if (!endereco || !String(endereco).trim()) return null;

        // 1) Primeiro tentar o fluxo completo e agressivo do geocodeMapbox (ele já aplica heurísticas)
        try {
            const gm = await geocodeMapbox(endereco, opts.bounds || null, opts.proximity || null);
            if (gm && (gm.lat != null && gm.lng != null)) {
                // Normalizar retorno para incluir 'precisao' e 'display_name' quando possível
                return {
                    lat: gm.lat,
                    lng: gm.lng,
                    display_name: gm.display_name || gm.place_name || null,
                    precisao: gm.precisao || gm.precision || null,
                    context: gm.context || null
                };
            }
        } catch (e) {
            console.warn('buscarCoordenadasComFallback: geocodeMapbox falhou, tentando fallback otimizado', e);
        }

        // 2) Fallback para a versão otimizada e tolerante
        try {
            const fb = await buscarCoordenadasMelhoradas(endereco);
            if (fb && (fb.lat != null && fb.lng != null)) {
                return {
                    lat: fb.lat,
                    lng: fb.lng,
                    display_name: fb.place_name || null,
                    precisao: fb.precisao || null,
                    context: fb.context || null
                };
            }
        } catch (e) {
            console.warn('buscarCoordenadasComFallback: buscarCoordenadasMelhoradas falhou', e);
        }

        return null;
    } catch (err) {
        console.error('Erro em buscarCoordenadasComFallback:', err);
        return null;
    }
}

// Wrapper consolidado para uso no App.jsx: tenta a versão estrita e cai para a versão melhorada
export const obterCoordenadasSeguras = async (endereco) => {
    try {
        if (!endereco || !String(endereco).trim()) return null;

        // Tentativa 1: Função original/estrita
        let resultado = null;
        try {
            resultado = await geocodeMapbox(endereco);
        } catch (e) {
            console.warn('obterCoordenadasSeguras: geocodeMapbox lançou erro', e);
            resultado = null;
        }

        // Se falhou ou a precisão for ruim (ex: menor que 0.8), aciona a "equipe de resgate"
        const precisao = resultado && (resultado.precisao || resultado.precision || resultado.relevance || null);
        const precisaFallback = !resultado || !(resultado.lat != null && resultado.lng != null) || (typeof precisao === 'number' && precisao < 0.8);

        if (precisaFallback) {
            console.log(`🔄 [GEO] Busca exata falhou ou imprecisa para "${endereco}". Acionando busca melhorada (Fuzzy)...`);
            try {
                const resultadoMelhorado = await buscarCoordenadasMelhoradas(endereco);
                if (resultadoMelhorado && resultadoMelhorado.lat != null && resultadoMelhorado.lng != null) {
                    resultado = resultadoMelhorado;
                }
            } catch (e) {
                console.warn('obterCoordenadasSeguras: buscarCoordenadasMelhoradas lançou erro', e);
            }
        }

        return resultado;
    } catch (error) {
        console.error('❌ Erro no wrapper de coordenadas:', error);
        return null;
    }
};

// Compatibilidade: wrapper simples com nome solicitado "buscarCoordenadas"
export const buscarCoordenadas = async (endereco) => {
    return await obterCoordenadasSeguras(endereco);
};

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

        // BBox restrito à Grande Florianópolis (SW: -28.0,-48.9 | NE: -27.3,-48.3)
        const defaultBounds = {
            south: -28.0,
            north: -27.3,
            west: -48.9,
            east: -48.3
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
        // Sufixo automático: âncora regional para evitar geocoding em outra cidade (ex: Curitiba)
        if (!hasKnownCity) queryWithCity = `${queryWithCity.trim()}, Grande Florianópolis, SC, Brasil`;

        const queryClean = (queryWithCity || query)
            .replace(/,\s*,+/g, ',')
            .replace(/\s*,\s*/g, ', ')
            .replace(/,\s*$/g, '')
            .replace(/\s+/g, ' ')
            .trim();

        // Permitir street também para garantir centro da via quando número não existir
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(limparEnderecoParaMapbox(queryClean))}.json?` +
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

        // Validação de município: filtrar apenas resultados da área de atuação
        const _AREAS_VALIDAS_SEARCH = ['palhoca', 'sao jose', 'florianopolis', 'biguacu', 'ingleses'];
        const _normSearch = (s) => { try { return String(s || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, ''); } catch (e) { return String(s || '').toLowerCase(); } };
        const resultsFiltrados = results.filter(r => _AREAS_VALIDAS_SEARCH.some(a => _normSearch(r.place_name).includes(a)));
        console.log('🔍 Mapbox Autosuggest:', results.length, 'sugestões →', resultsFiltrados.length, 'dentro da área de atuação');
        return resultsFiltrados.length > 0 ? resultsFiltrados : results;

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
// Versão otimizada conforme solicitado: aceita `heading` e usa `driving-traffic`.
export const getRouteGeometry = async (origin, destination, heading = null) => {
    const MAPBOX_TOKEN = process.env.VITE_MAPBOX_TOKEN;
    if (!MAPBOX_TOKEN) return null;
    if (!origin || !destination) return null;

    // Coordenadas no formato lng,lat
    const coords = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;

    // Bearings: primeiro valor é o ângulo da moto, segundo valor é margem de erro
    const bearingsParam = heading !== null ? `&bearings=${Math.round(heading)},45;` : '';

    // Usar driving-traffic para tempos mais realistas
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${coords}?alternatives=false&geometries=geojson&overview=full${bearingsParam}&access_token=${MAPBOX_TOKEN}`;

    try {
        const response = await fetch(url);
        if (!response || !response.ok) {
            console.warn(`⚠️ Mapbox Directions falhou (${response?.status}). Tentando fallback OSRM...`);
            return await getOSRMRoute([{ lng: origin.lng, lat: origin.lat }, { lng: destination.lng, lat: destination.lat }]);
        }
        const data = await response.json();

        if (!data.routes || data.routes.length === 0) {
             console.warn('⚠️ Mapbox não retornou rotas. Tentando fallback OSRM...');
             return await getOSRMRoute([{ lng: origin.lng, lat: origin.lat }, { lng: destination.lng, lat: destination.lat }]);
        }

        const route = data.routes[0];
        return {
            coordsLatLng: (route.geometry && Array.isArray(route.geometry.coordinates)) ? route.geometry.coordinates.map(c => [c[1], c[0]]) : [],
            distanceMeters: route.distance,
            durationSec: route.duration,
            geometry: route.geometry
        };
    } catch (error) {
        console.error('Erro na rota Mapbox, tentando fallback OSRM:', error);
        return await getOSRMRoute([{ lng: origin.lng, lat: origin.lat }, { lng: destination.lng, lat: destination.lat }]);
    }
};

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

