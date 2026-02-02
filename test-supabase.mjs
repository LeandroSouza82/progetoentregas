global.localStorage = {
    _store: {},
    getItem(k) { return this._store[k] ?? null; },
    setItem(k, v) { this._store[k] = String(v); },
    removeItem(k) { delete this._store[k]; }
};

async function run() {
    // import dynamically after setting global.localStorage so module sees it
    const mod = await import('./src/supabaseClient.js');
    const { supabase } = mod;
    console.log('=== Supabase Mock Test ===');
    const f = await supabase.from('frota').select()._exec();
    console.log('Initial frota:', f.data);

    const p0 = await supabase.from('entregas').select()._exec();
    console.log('Initial entregas:', p0.data);

    const ins = await supabase.from('entregas').insert([{ cliente: 'Teste', endereco: 'Rua X', msg: 'OK', lat: -23.55, lng: -46.63, status: 'Aguardando' }]);
    console.log('Inserted:', ins.data);

    const entregasAguardando = await supabase.from('entregas').select().eq('status', 'Aguardando')._exec();
    console.log('Entregas Aguardando:', entregasAguardando.data);

    const upd = await supabase.from('entregas').update({ status: 'Em Rota' }).eq('id', ins.data[0].id);
    console.log('Updated:', upd.data);

    const final = await supabase.from('entregas').select().eq('status', 'Em Rota')._exec();
    console.log('Final Em Rota:', final.data);
}

run().catch(e => { console.error('Error:', e); process.exit(1); });
