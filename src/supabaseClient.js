// Unified Supabase client (real or node-friendly mock)
// - In browser: uses real @supabase/supabase-js client (env),
// - In Node (when `localStorage` is polyfilled), uses an in-memory mock compatible with tests.

let supabase = null;
let HAS_SUPABASE_CREDENTIALS = false;
let subscribeToTable = null;

// Connection state and diagnostics
let SUPABASE_CONNECTED = false;
let lastSupabaseError = null;
const supabaseConnectedHandlers = [];
function onSupabaseConnected(cb) {
    if (typeof cb !== 'function') return;
    if (SUPABASE_CONNECTED) {
        try { setTimeout(cb, 0); } catch (e) { /* swallow */ }
    } else {
        supabaseConnectedHandlers.push(cb);
    }
}
function _notifySupabaseConnected() {
    SUPABASE_CONNECTED = true;
    try { supabaseConnectedHandlers.forEach(fn => { try { fn(); } catch (e) { /* swallow */ } }); } catch (e) { }
    supabaseConnectedHandlers.length = 0;
}

async function checkSupabaseConnection() {
    // Returns { connected: boolean, error: any }
    lastSupabaseError = null;
    if (!supabase || typeof supabase.from !== 'function') {
        lastSupabaseError = new Error('Supabase client is not initialized');
        SUPABASE_CONNECTED = false;
        return { connected: false, error: lastSupabaseError };
    }
    try {
        const res = await supabase.from('entregas').select('id').limit(1);
        if (res && res.error) {
            lastSupabaseError = res.error;
            SUPABASE_CONNECTED = false;
            console.error('[supabaseClient] healthcheck error fetching entregas:', res.error);
            return { connected: false, error: res.error };
        }
        // success
        SUPABASE_CONNECTED = true;
        lastSupabaseError = null;
        console.info('[supabaseClient] healthcheck OK. entregas sample count:', Array.isArray(res.data) ? res.data.length : 0);
        try { _notifySupabaseConnected(); } catch (e) { }
        return { connected: true, error: null };
    } catch (e) {
        lastSupabaseError = e;
        SUPABASE_CONNECTED = false;
        console.error('[supabaseClient] healthcheck failed with exception:', e);
        return { connected: false, error: e };
    }
}
function getLastSupabaseError() { return lastSupabaseError; }

// Ready hook: callers can register to be notified when the Supabase client finishes initialization.
let SUPABASE_READY = false;
const supabaseReadyHandlers = [];
function onSupabaseReady(cb) {
    if (typeof cb !== 'function') return;
    // Only invoke immediately when we truly have a ready supabase client
    if (SUPABASE_READY && supabase && typeof supabase.from === 'function') {
        try { setTimeout(() => cb(supabase), 0); } catch (e) { /* swallow */ }
    } else {
        supabaseReadyHandlers.push(cb);
    }
}

function _notifySupabaseReady() {
    SUPABASE_READY = true;
    try { supabaseReadyHandlers.forEach(fn => { try { fn(supabase); } catch (e) { /* swallow */ } }); } catch (e) { }
    supabaseReadyHandlers.length = 0;
}

// Node/mock path when running without window (test scripts set global.localStorage)
if (typeof window === 'undefined') {
    // minimal mock similar to motorista/src/supabaseClient.js
    function storageKey(table) { return `mock_${table}`; }
    function readTable(table) {
        try { const raw = localStorage.getItem(storageKey(table)); if (!raw) return []; return JSON.parse(raw); } catch (e) { return []; }
    }
    function writeTable(table, data) { localStorage.setItem(storageKey(table), JSON.stringify(data)); }
    function applyFilters(items, filters) { if (!filters || filters.length === 0) return items; return items.filter(item => filters.every(([field, value]) => String(item[field]) === String(value))); }

    function createQuery(table) {
        let op = null; let updateObj = null; const filters = []; let orderSpec = null; let limitCount = null;
        return {
            select(cols) { return this; },
            insert: async (rows) => { const all = readTable(table); const toInsert = rows.map(r => ({ id: Date.now() + Math.floor(Math.random() * 1000), ...r })); const next = all.concat(toInsert); writeTable(table, next); return { data: toInsert, error: null }; },
            delete() { op = 'delete'; return this; },
            update(obj) { op = 'update'; updateObj = obj; return this; },
            eq(field, value) { filters.push([field, value]); return this; },
            order(field, opts) { orderSpec = { field, opts }; return this; },
            limit(n) { limitCount = Number(n); return this; },
            async _exec() {
                const all = readTable(table);
                let matched = applyFilters(all, filters);
                if (orderSpec) {
                    const { field, opts } = orderSpec;
                    matched = matched.slice().sort((a, b) => {
                        if (a[field] < b[field]) return opts && opts.ascending ? -1 : 1;
                        if (a[field] > b[field]) return opts && opts.ascending ? 1 : -1;
                        return 0;
                    });
                }
                if (limitCount != null) matched = matched.slice(0, limitCount);
                if (op === 'delete') { const remaining = all.filter(i => !matched.includes(i)); writeTable(table, remaining); return { data: matched, error: null }; }
                if (op === 'update') { const updated = all.map(i => matched.includes(i) ? { ...i, ...updateObj } : i); writeTable(table, updated); const returned = updated.filter(i => matched.some(m => m.id === i.id)); return { data: returned, error: null }; }
                return { data: matched, error: null };
            },
            then(resolve, reject) { this._exec().then(resolve, reject); }
        };
    }

    // seed defaults for tests
    if (!localStorage.getItem(storageKey('frota'))) {
        writeTable('frota', [{ id: 1, nome: 'Carlos Oliveira', status: 'Online', veiculo: 'Fiorino', placa: 'ABC-1234', fone: '5511999990000' }]);
    }
    if (!localStorage.getItem(storageKey('entregas'))) { writeTable('entregas', []); }
    if (!localStorage.getItem(storageKey('logs_roteirizacao'))) { writeTable('logs_roteirizacao', []); }

    supabase = { from(table) { return createQuery(table); } };
    HAS_SUPABASE_CREDENTIALS = false;

    // Mark ready in the mock path so any registered handlers run in tests
    try { _notifySupabaseReady(); } catch (e) { }

    subscribeToTable = function (table, handler, opts = {}) {
        const pollMs = typeof opts.pollMs === 'number' ? opts.pollMs : 200;
        let last = JSON.stringify(readTable(table));
        const interval = setInterval(() => {
            const curr = JSON.stringify(readTable(table));
            if (curr !== last) {
                last = curr;
                try { handler({ data: JSON.parse(curr) }); } catch (e) { /* swallow */ }
            }
        }, pollMs);
        return () => clearInterval(interval);
    };

} else {
    // Browser / real Supabase path
    // Use dynamic import without top-level await to stay compatible with build targets.
    import('@supabase/supabase-js').then(({ createClient }) => {
        try {
            // 🎯 VITE: Usar APENAS import.meta.env (process.env NÃO funciona na Vercel/Vite)
            const supabaseUrl = import.meta?.env?.VITE_SUPABASE_URL;
            const supabaseAnonKey = import.meta?.env?.VITE_SUPABASE_ANON_KEY;

            // 🔍 DIAGNÓSTICO: Verificar quais variáveis estão disponíveis
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log('🔧 SUPABASE CLIENT - Verificando credenciais...');
            console.log('📋 Runtime:', typeof import.meta !== 'undefined' ? 'Vite/Browser' : 'Node');
            console.log('📋 import.meta.env disponível:', import.meta?.env ? 'SIM' : 'NÃO');
            console.log('📋 VITE_SUPABASE_URL:', supabaseUrl ? `✅ ${supabaseUrl.substring(0, 30)}...` : '❌ AUSENTE');
            console.log('📋 VITE_SUPABASE_ANON_KEY:', supabaseAnonKey ? `✅ ${supabaseAnonKey.substring(0, 20)}...` : '❌ AUSENTE');

            // ⚠️ VALIDAÇÃO RIGOROSA
            if (!supabaseUrl) {
                console.error('❌ ERRO CRÍTICO: VITE_SUPABASE_URL não está definido!');
                console.error('📋 Na Vercel: Vá em Settings → Environment Variables → Adicione VITE_SUPABASE_URL');
                console.error('📋 Localmente: Verifique se .env.local existe e contém: VITE_SUPABASE_URL=sua_url_aqui');
                console.error('📋 IMPORTANTE: A variável DEVE começar com VITE_ para ser exposta ao cliente!');
            }

            if (!supabaseAnonKey) {
                console.error('❌ ERRO CRÍTICO: VITE_SUPABASE_ANON_KEY não está definido!');
                console.error('📋 Na Vercel: Vá em Settings → Environment Variables → Adicione VITE_SUPABASE_ANON_KEY');
                console.error('📋 Localmente: Verifique se .env.local existe e contém: VITE_SUPABASE_ANON_KEY=sua_chave_aqui');
                console.error('📋 IMPORTANTE: A variável DEVE começar com VITE_ para ser exposta ao cliente!');
            }

            // 🚨 NÃO CRIAR CLIENTE SE FALTAR CREDENCIAIS
            if (!supabaseUrl || !supabaseAnonKey) {
                console.error('🚨 IMPOSSÍVEL CRIAR CLIENTE SUPABASE - Credenciais ausentes!');
                console.error('🚨 O sistema funcionará em modo OFFLINE (sem dados do banco)');
                HAS_SUPABASE_CREDENTIALS = false;
                supabase = null;
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                return;
            }

            console.log('✅ Credenciais OK - Criando cliente Supabase...');
            
            // 🎯 CRIAR CLIENTE
            supabase = createClient(supabaseUrl, supabaseAnonKey);
            HAS_SUPABASE_CREDENTIALS = true;

            // ✅ VERIFICAR SE CLIENTE FOI CRIADO CORRETAMENTE
            if (!supabase) {
                console.error('❌ FALHA: createClient retornou null/undefined');
                HAS_SUPABASE_CREDENTIALS = false;
            } else if (typeof supabase.from !== 'function') {
                console.error('❌ FALHA: Cliente Supabase criado mas sem método .from()');
                console.error('📋 Tipo do cliente:', typeof supabase);
                console.error('📋 Métodos disponíveis:', Object.keys(supabase || {}));
                HAS_SUPABASE_CREDENTIALS = false;
            } else {
                console.log('✅ Cliente Supabase criado com sucesso!');
                console.log('✅ Método .from() disponível');
                console.log('✅ Sistema ONLINE - Conectado ao banco de dados');
            }
            
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

            // Notify that a client object exists (handlers may want to keep it)
            try { _notifySupabaseReady(); } catch (e) { }

            // subscribeToTable can use Supabase Realtime when available
            subscribeToTable = function (table, handler, opts = {}) {
                // Minimal fallback: polling using the REST endpoint when real realtime unavailable
                const pollMs = typeof opts.pollMs === 'number' ? opts.pollMs : 1000;
                let last = null;
                let stopped = false;
                (async () => {
                    while (!stopped) {
                        try {
                            const res = await supabase.from(table).select('*');
                            if (res && res.error) {
                                console.error('[supabaseClient] Error fetching table', table, res.error);
                            }
                            const curr = JSON.stringify(res && res.data ? res.data : []);
                            if (curr !== last) {
                                last = curr;
                                handler({ data: res.data, error: res && res.error ? res.error : null });
                            }
                        } catch (e) { console.error('[supabaseClient] subscribeToTable polling error for', table, e); }
                        await new Promise(r => setTimeout(r, pollMs));
                    }
                })();
                return () => { stopped = true; };
            };

            // Immediately run a detailed healthcheck and surface meaningful logs/errors
            try {
                (async () => {
                    try {
                        // Validate the env variables explicitly (helps diagnosing missing/misnamed keys)
                        const okUrl = !!supabaseUrl; const okKey = !!supabaseAnonKey;
                        if (!okUrl || !okKey) {
                            const msg = `[supabaseClient] Missing Supabase env variables. VITE_SUPABASE_URL:${okUrl ? 'SET' : 'MISSING'} VITE_SUPABASE_ANON_KEY:${okKey ? 'SET' : 'MISSING'}`;
                            console.error(msg);
                            lastSupabaseError = new Error(msg);
                            SUPABASE_CONNECTED = false;
                            try { _notifySupabaseReady(); } catch (e) { }
                            return;
                        }

                        // Run the canonical check and set connection status
                        const res = await checkSupabaseConnection();
                        if (!res.connected) {
                            // If the check failed, log extra context (could be RLS/permission or network issue)
                            console.error('[supabaseClient] supabase health check failed:', res.error);
                        }
                    } catch (e) {
                        console.error('[supabaseClient] healthcheck threw', e);
                    } finally {
                        try { _notifySupabaseReady(); } catch (e) { }
                    }
                })();
            } catch (e) { /* ignore healthcheck errors */ }

            // Notify any registered handlers that supabase client object is ready (may still be unconnected)
            try { _notifySupabaseReady(); } catch (e) { }
        } catch (e) {
            console.warn('Failed to initialize supabase client', e);
            lastSupabaseError = e;
            SUPABASE_CONNECTED = false;
            try { _notifySupabaseReady(); } catch (err) { }
        }
    }).catch(e => {
        // If import fails, leave supabase as null and log warning but do not throw — callers should guard with HAS_SUPABASE_CREDENTIALS
        console.warn('Supabase package failed to load dynamically:', e);
    });
}

async function buscarTodasEntregas() {
    try {
        // wait for client if needed
        if (!supabase || typeof supabase.from !== 'function') {
            await new Promise((resolve) => {
                try { onSupabaseReady(() => resolve()); } catch (e) { setTimeout(resolve, 500); }
            });
        }
        if (!supabase || typeof supabase.from !== 'function') throw new Error('Supabase client unavailable');
        const res = await supabase.from('entregas').select('*');
        if (res && res.error) throw res.error;
        return Array.isArray(res.data) ? res.data : [];
    } catch (error) {
        console.error('Erro ao buscar entregas:', error);
        return [];
    }
}

export default supabase;
export { supabase, HAS_SUPABASE_CREDENTIALS, subscribeToTable, onSupabaseReady, SUPABASE_READY, SUPABASE_CONNECTED, onSupabaseConnected, checkSupabaseConnection, getLastSupabaseError, lastSupabaseError, buscarTodasEntregas };

