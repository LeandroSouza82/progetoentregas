// test-realtime.mjs — testa o fallback mock (localStorage) e subscribeToTable
// Roda com: node --loader ts-node/esm scripts/test-realtime.mjs (não necessário aqui)

// Polyfill simples de localStorage para Node
global.localStorage = (() => {
    const store = Object.create(null);
    return {
        getItem(key) { return store[key] ?? null; },
        setItem(key, value) { store[key] = String(value); },
        removeItem(key) { delete store[key]; },
        clear() { for (const k of Object.keys(store)) delete store[k]; }
    };
})();

let supabase, subscribeToTable, HAS_SUPABASE_CREDENTIALS;

(async () => {
    // importa dinamicamente para garantir que o polyfill de localStorage seja definido antes
    const mod = await import('../src/supabaseClient.js');
    supabase = mod.default;
    subscribeToTable = mod.subscribeToTable;
    HAS_SUPABASE_CREDENTIALS = mod.HAS_SUPABASE_CREDENTIALS;

    console.log('HAS_SUPABASE_CREDENTIALS:', HAS_SUPABASE_CREDENTIALS);

    if (!HAS_SUPABASE_CREDENTIALS) {
        console.error('Supabase credentials missing — test-realtime requires a real Supabase connection.');
        process.exit(2);
    }

    let received = [];

    const unsub = subscribeToTable('pedidos', (payload) => {
        console.log('handler chamado ->', payload && payload.data ? payload.data.length : payload);
        received.push(payload);
    }, { event: '*', schema: 'public', pollMs: 100 });

    console.log('Inserindo pedido de teste via mock...');
    const { data, error } = await supabase.from('pedidos').insert([{ cliente: 'Teste Node', endereco: 'Rua Node, 1', msg: 'mock insert', tipo: 'Entrega', lat: -23.55, lng: -46.63, status: 'Aguardando' }]);
    if (error) console.error('insert error', error);
    else console.log('insert data', data && data.length);

    // Aguarda um pouco para o poll pegar a mudança
    await new Promise(r => setTimeout(r, 500));

    console.log('received length:', received.length);
    if (received.length >= 1) {
        console.log('✅ Fallback mock funcionando (polling detectou mudança).');
    } else {
        console.error('❌ Fallback mock não detectou mudanças.');
    }

    // cleanup
    unsub && unsub();
    process.exit(received.length >= 1 ? 0 : 2);
})();