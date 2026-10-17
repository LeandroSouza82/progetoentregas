export const TEST_PREFIX = 'TESTE V10 - ';
export const isTestCard = row => String(row?.cliente || '').toUpperCase().startsWith(TEST_PREFIX);
export const testCardName = value => {
    const text = String(value || '').trim();
    return text.toUpperCase().startsWith(TEST_PREFIX) ? text : TEST_PREFIX + (text || 'Teste');
};

// Proteção deste cliente de teste; não altera políticas ou clientes de produção.
export function createSharedTestFetch(environment, fetcher = globalThis.fetch.bind(globalThis)) {
    return async (input, init) => {
        const request = new Request(input, init);
        const url = new URL(request.url);
        if (url.origin !== environment.url) throw new Error('Projeto inesperado no modo TESTE.');
        const table = /^\/rest\/v1\/([^/]+)$/.exec(url.pathname)?.[1];
        const write = !['GET', 'HEAD'].includes(request.method);
        if (!table) {
            if (write && url.pathname.startsWith('/rest/v1/')) throw new Error('RPC indisponível no modo TESTE.');
            if (write && url.pathname.startsWith('/storage/v1/') && !['entregas','avatars'].some(bucket => url.pathname.startsWith(`/storage/v1/object/${bucket}/${environment.testDriverId}/`))) throw new Error('Use somente arquivos do motorista TESTE.');
            return fetcher(input, init);
        }
        let body = write ? await request.text() : undefined;
        let payload = body ? JSON.parse(body) : null;
        if (table === 'entregas') {
            url.searchParams.append('cliente', 'ilike.TESTE V10 - *');
            if (request.method === 'POST') {
                if (request.headers.get('prefer')?.includes('resolution=')) throw new Error('Upsert indisponível no modo TESTE.');
                const rows = Array.isArray(payload) ? payload : [payload];
                rows.forEach(row => {
                    if (!row || row.id != null) throw new Error('Crie um novo card TESTE sem ID existente.');
                    if (row.motorista_id != null && row.motorista_id !== environment.testDriverId) throw new Error('Selecione o motorista TESTE.');
                    row.cliente = testCardName(row.cliente);
                    row.obs = 'REGISTRO DE TESTE — NÃO REALIZAR ENTREGA. ' + (row.obs || '');
                });
                payload = Array.isArray(payload) ? rows : rows[0];
            } else if (write) {
                if (!url.searchParams.has('id')) throw new Error('No modo TESTE, informe os IDs exatos dos cards.');
                if (payload?.cliente != null) payload.cliente = testCardName(payload.cliente);
                if (payload?.motorista_id != null && payload.motorista_id !== environment.testDriverId) throw new Error('Selecione o motorista TESTE.');
            }
        } else if (table === 'motoristas') {
            url.searchParams.append('id', 'eq.' + environment.testDriverId);
            url.searchParams.append('nome', 'ilike.TESTE V10 - *');
            if (write && request.method !== 'PATCH') throw new Error('Cadastro/exclusão de motorista indisponível neste teste.');
            if (payload?.nome && !payload.nome.toUpperCase().startsWith(TEST_PREFIX)) throw new Error('Preserve o nome do motorista TESTE.');
        } else if (write) {
            throw new Error('Esta ação não faz parte do teste de envio de rotas.');
        }
        if (write && payload != null) body = JSON.stringify(payload);
        return fetcher(new Request(url, {method:request.method, headers:request.headers, body, signal:request.signal}));
    };
}

export function scopedRealtimeClient(client, environment) {
    if (!environment?.isSharedTest) return client;
    return new Proxy(client, {get(target, property) {
        if (property !== 'channel') {
            const value = Reflect.get(target, property, target);
            return typeof value === 'function' ? value.bind(target) : value;
        }
        return (...args) => {
            const channel = target.channel(...args);
            const proxy = new Proxy(channel, {get(current, method) {
                if (method === 'on') return (type, filter, callback) => {
                    current.on(type, filter, payload => {
                        const row = payload.new || payload.record;
                        if (filter.table === 'entregas' && payload.eventType !== 'DELETE' && !isTestCard(row)) return;
                        if (filter.table === 'motoristas' && String(row?.id) !== environment.testDriverId) return;
                        callback(payload);
                    });
                    return proxy;
                };
                const value = Reflect.get(current, method, current);
                return typeof value === 'function' ? (...values) => {const result=value.apply(current,values);return result === current ? proxy : result;} : value;
            }});
            return proxy;
        };
    }});
}
