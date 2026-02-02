// Unified Supabase client (real or node-friendly mock)
// - In browser: uses real @supabase/supabase-js client (env),
// - In Node (when `localStorage` is polyfilled), uses an in-memory mock compatible with tests.

let supabase = null;
let HAS_SUPABASE_CREDENTIALS = false;
let subscribeToTable = null;

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

    supabase = { from(table) { return createQuery(table); } };
    HAS_SUPABASE_CREDENTIALS = false;

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
    const { createClient } = await import('@supabase/supabase-js');
    const supabaseUrl = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SUPABASE_URL) ? import.meta.env.VITE_SUPABASE_URL : process.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SUPABASE_ANON_KEY) ? import.meta.env.VITE_SUPABASE_ANON_KEY : process.env.VITE_SUPABASE_ANON_KEY;
    supabase = createClient(supabaseUrl, supabaseAnonKey);
    HAS_SUPABASE_CREDENTIALS = Boolean(supabaseUrl && supabaseAnonKey);
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
                    const curr = JSON.stringify(res && res.data ? res.data : []);
                    if (curr !== last) {
                        last = curr;
                        handler({ data: res.data });
                    }
                } catch (e) { /* ignore */ }
                await new Promise(r => setTimeout(r, pollMs));
            }
        })();
        return () => { stopped = true; };
    };
}

export default supabase;
export { supabase, HAS_SUPABASE_CREDENTIALS, subscribeToTable };

