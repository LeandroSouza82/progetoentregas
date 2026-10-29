// Serviço modular de cálculo de rota (OSRM + Fallback Haversine 1.3x / 35 km/h)

const FATOR_CORRECAO_VIARIA = 1.3;
const VELOCIDADE_MEDIA_URBANA_KMH = 35;

/**
 * Calcula a distância em linha reta (Haversine) em quilômetros entre dois pontos { lat, lng }.
 */
export function calcularHaversineKm(a, b) {
    if (!a || !b || a.lat == null || a.lng == null || b.lat == null || b.lng == null) return 0;
    const toRad = (deg) => (Number(deg) * Math.PI) / 180;
    const R = 6371;
    const dLat = toRad(Number(b.lat) - Number(a.lat));
    const dLng = toRad(Number(b.lng) - Number(a.lng));
    const lat1 = toRad(Number(a.lat));
    const lat2 = toRad(Number(b.lat));
    const sinLat = Math.sin(dLat / 2);
    const sinLng = Math.sin(dLng / 2);
    const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
    return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

/**
 * Formata a distância (km) e o tempo estimado (min) no padrão:
 * "24.8 km (~42 min)" ou "38.5 km (~1 h 12 min)" ou "0 km (0 min)".
 */
export function formatarResumoRota(distanceKm, durationMin) {
    const distNum = Number(distanceKm);
    const minNum = Math.round(Number(durationMin) || 0);
    if (!Number.isFinite(distNum) || distNum <= 0 || minNum <= 0) {
        return '0 km (0 min)';
    }
    const distStr = `${distNum.toFixed(1)} km`;
    if (minNum >= 60) {
        const horas = Math.floor(minNum / 60);
        const restoMin = minNum % 60;
        const tempoStr = restoMin > 0 ? `~${horas} h ${restoMin} min` : `~${horas} h`;
        return `${distStr} (${tempoStr})`;
    }
    return `${distStr} (~${minNum} min)`;
}

/**
 * Resolve a coordenada de origem do motorista:
 * 1) Motorista selecionado manualmente no dropdown (motoristaSelecionadoId) ou motoristaDaRota
 * 2) Caso haja 1 motorista online (ou o primeiro motorista online com GPS válido), usa automaticamente sua posição
 * 3) Qualquer motorista da frota com coordenada válida
 */
export function obterOrigemMotorista(frota = [], motoristaSelecionadoId = null, motoristaDaRota = null, entregas = []) {
    const lista = Array.isArray(frota) ? frota : [];
    const coordValida = (m) => {
        if (!m) return false;
        const lat = Number(m.lat ?? m.latitude);
        const lng = Number(m.lng ?? m.longitude);
        return Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0;
    };

    const extrairPonto = (m) => ({
        lat: Number(m.lat ?? m.latitude),
        lng: Number(m.lng ?? m.longitude),
        nome: m.nome || m.title || 'Motorista'
    });

    const idAlvo = motoristaSelecionadoId || (motoristaDaRota && (motoristaDaRota.uuid || motoristaDaRota.id)) || null;
    if (idAlvo) {
        const escolhido = lista.find((m) =>
            coordValida(m) && (String(m.id) === String(idAlvo) || String(m.uuid) === String(idAlvo))
        );
        if (escolhido) return extrairPonto(escolhido);
    }

    if (motoristaDaRota && coordValida(motoristaDaRota)) {
        return extrairPonto(motoristaDaRota);
    }

    const onlineComGps = lista.filter(
        (m) => coordValida(m) && (m.esta_online === true || String(m.esta_online) === 'true')
    );
    if (onlineComGps.length >= 1) {
        return extrairPonto(onlineComGps[0]);
    }

    const qualquerComGps = lista.find(coordValida);
    if (qualquerComGps) {
        return extrairPonto(qualquerComGps);
    }

    // Fallback para coordenada de coleta salva nos pedidos caso a tabela motoristas ainda esteja carregando
    const listaEntregas = Array.isArray(entregas) ? entregas : [];
    const entregaComColeta = listaEntregas.find((e) =>
        e && Number.isFinite(Number(e.lat_coleta)) && Number.isFinite(Number(e.lng_coleta)) && Number(e.lat_coleta) !== 0 && Number(e.lng_coleta) !== 0
    );
    if (entregaComColeta) {
        return {
            lat: Number(entregaComColeta.lat_coleta),
            lng: Number(entregaComColeta.lng_coleta),
            nome: 'Origem'
        };
    }

    return null;
}

/**
 * Filtra e ordena as paradas na ordem exata da fila (ordem_logistica 1 -> 2 -> 3...).
 */
export function ordenarParadasRota(entregas = []) {
    const lista = Array.isArray(entregas) ? entregas : [];
    return lista
        .filter((e) => {
            if (!e || e.lat == null || e.lng == null) return false;
            const lat = Number(e.lat);
            const lng = Number(e.lng);
            if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0 || lng === 0) return false;
            const status = String(e.status || 'pendente').trim().toLowerCase();
            return status === 'pendente' || status === 'adicionado' || status === 'em_rota';
        })
        .sort((a, b) => {
            const oa = Number(a.ordem_logistica) > 0 ? Number(a.ordem_logistica) : Number.MAX_SAFE_INTEGER;
            const ob = Number(b.ordem_logistica) > 0 ? Number(b.ordem_logistica) : Number.MAX_SAFE_INTEGER;
            if (oa !== ob) return oa - ob;
            return (Number(a.id) || 0) - (Number(b.id) || 0);
        })
        .map((e) => ({
            id: e.id,
            lat: Number(e.lat),
            lng: Number(e.lng),
            cliente: e.cliente || ''
        }));
}

/**
 * Calcula fallback via Haversine * 1.3x e velocidade média urbana de 35 km/h.
 */
export function calcularFallbackHaversine(waypoints = []) {
    if (!Array.isArray(waypoints) || waypoints.length < 2) {
        return {
            coordinates: [],
            distanceKm: 0,
            durationMin: 0,
            formattedSummary: '0 km (0 min)',
            source: 'empty'
        };
    }

    let somaHaversineKm = 0;
    for (let i = 0; i < waypoints.length - 1; i++) {
        somaHaversineKm += calcularHaversineKm(waypoints[i], waypoints[i + 1]);
    }

    const distanciaCorrigidaKm = Number((somaHaversineKm * FATOR_CORRECAO_VIARIA).toFixed(1));
    const durationMin = distanciaCorrigidaKm > 0
        ? Math.max(1, Math.round((distanciaCorrigidaKm / VELOCIDADE_MEDIA_URBANA_KMH) * 60))
        : 0;

    return {
        coordinates: waypoints.map((p) => [Number(p.lat), Number(p.lng)]),
        distanceKm: distanciaCorrigidaKm,
        durationMin,
        formattedSummary: formatarResumoRota(distanciaCorrigidaKm, durationMin),
        source: 'fallback-haversine'
    };
}

/**
 * Busca a geometria real pelas ruas e rodovias usando OSRM, partindo da posição do motorista
 * e percorrendo todas as paradas na ordem exata da fila. Cai para Haversine (1.3x / 35 km/h) se o OSRM oscilar.
 */
export async function calcularRotaCompletaOSRM(origemMotorista, paradas = []) {
    const paradasValidas = Array.isArray(paradas) ? paradas.filter((p) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng))) : [];

    if (paradasValidas.length === 0) {
        return {
            coordinates: [],
            distanceKm: 0,
            durationMin: 0,
            formattedSummary: '0 km (0 min)',
            source: 'empty'
        };
    }

    const waypoints = origemMotorista && Number.isFinite(Number(origemMotorista.lat)) && Number.isFinite(Number(origemMotorista.lng))
        ? [{ lat: Number(origemMotorista.lat), lng: Number(origemMotorista.lng) }, ...paradasValidas]
        : [...paradasValidas];

    if (waypoints.length < 2) {
        return {
            coordinates: waypoints.map((p) => [Number(p.lat), Number(p.lng)]),
            distanceKm: 0,
            durationMin: 0,
            formattedSummary: '0 km (0 min)',
            source: 'single-point'
        };
    }

    const coordsParam = waypoints
        .map((p) => `${Number(p.lng).toFixed(6)},${Number(p.lat).toFixed(6)}`)
        .join(';');

    const url = `https://router.project-osrm.org/route/v1/driving/${coordsParam}?overview=full&geometries=geojson`;

    try {
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), 7000) : null;

        const resp = await fetch(url, {
            signal: controller ? controller.signal : undefined,
            headers: { 'Accept': 'application/json' }
        });
        if (timer) clearTimeout(timer);

        if (resp && resp.ok) {
            const data = await resp.json();
            const route = data && Array.isArray(data.routes) && data.routes[0] ? data.routes[0] : null;
            const geoCoords = route && route.geometry && Array.isArray(route.geometry.coordinates)
                ? route.geometry.coordinates
                : null;

            if (route && geoCoords && geoCoords.length >= 2) {
                const coordinates = geoCoords.map(([lng, lat]) => [Number(lat), Number(lng)]);
                const distanceKm = Number(((Number(route.distance) || 0) / 1000).toFixed(1));
                const durationMin = distanceKm > 0
                    ? Math.max(1, Math.round((Number(route.duration) || 0) / 60))
                    : 0;

                return {
                    coordinates,
                    distanceKm,
                    durationMin,
                    formattedSummary: formatarResumoRota(distanceKm, durationMin),
                    source: 'osrm'
                };
            }
        }
    } catch (err) {
        console.warn('⚠️ [OSRM] Oscilação ao traçar rota, acionando fallback Haversine (1.3x / 35 km/h):', err);
    }

    return calcularFallbackHaversine(waypoints);
}

