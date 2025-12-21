import { createClient } from '@supabase/supabase-js';

// Detect env vars (safe for both browser Vite and Node)
const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : process.env;
const SUPABASE_URL = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const SUPABASE_KEY = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY;

let isMock = false;
let supabase;

// --- Mock implementation (fallback) ---
function storageKey(table) {
    return `mock_${table}`;
}

// Fallback storage for environments without localStorage (e.g., Node tests)
const _inMemoryMockStorage = {};
const hasLocalStorage = typeof localStorage !== 'undefined' && localStorage && typeof localStorage.getItem === 'function' && typeof localStorage.setItem === 'function';

function readTable(table) {
    try {
        if (hasLocalStorage) {
            const raw = localStorage.getItem(storageKey(table));
            if (!raw) return [];
            return JSON.parse(raw);
        }
        const raw = _inMemoryMockStorage[storageKey(table)];
        if (!raw) return [];
        return JSON.parse(raw);
    } catch (e) {
        return [];
    }
}

function writeTable(table, data) {
    const payload = JSON.stringify(data);
    if (hasLocalStorage) {
        localStorage.setItem(storageKey(table), payload);
    } else {
        _inMemoryMockStorage[storageKey(table)] = payload;
    }
}

function applyFilters(items, filters) {
    if (!filters || filters.length === 0) return items;
    return items.filter(item => {
        return filters.every(([field, value]) => String(item[field]) === String(value));
    });
}

function createQuery(table) {
    let op = null;
    let updateObj = null;
    const filters = [];

    let selectCols = null;
    return {
        select(cols) {
            selectCols = cols;
            return this; // defer execution until awaited (then)
        },
        insert: async (rows) => {
            const all = readTable(table);
            const toInsert = rows.map(r => ({ id: Date.now() + Math.floor(Math.random() * 1000), ...r }));
            const next = all.concat(toInsert);
            writeTable(table, next);
            return { data: toInsert, error: null };
        },
        delete() {
            op = 'delete';
            return this;
        },
        update(obj) {
            op = 'update';
            updateObj = obj;
            return this;
        },
        eq(field, value) {
            filters.push([field, value]);
            return this;
        },
        async _exec() {
            const all = readTable(table);
            const matched = applyFilters(all, filters);
            // If select was not called, default to returning all
            const data = matched;
            if (op === 'delete') {
                const remaining = all.filter(i => !matched.includes(i));
                writeTable(table, remaining);
                return { data: matched, error: null };
            }
            if (op === 'update') {
                const updated = all.map(i => matched.includes(i) ? { ...i, ...updateObj } : i);
                writeTable(table, updated);
                const returned = updated.filter(i => matched.some(m => m.id === i.id));
                return { data: returned, error: null };
            }
            return { data, error: null };
        },
        then(resolve, reject) {
            this._exec().then(resolve, reject);
        }
    };
}

// initialize sample data if missing (use readTable/writeTable to support Node env without localStorage)
if (readTable('frota').length === 0) {
    writeTable('frota', [
        { id: 1, nome: 'Carlos Oliveira', status: 'Online', veiculo: 'Fiorino', placa: 'ABC-1234', fone: '5511999990000' },
        { id: 2, nome: 'Ana Souza', status: 'Ocupado', veiculo: 'Van', placa: 'XYZ-9876', fone: '5511988887777' }
    ]);
}

if (readTable('pedidos').length === 0) {
    writeTable('pedidos', []);
}

// If env vars are present, validate SUPABASE_URL and use the real Supabase client; otherwise fallback to mock
function isValidUrl(u) {
    try {
        const parsed = new URL(u);
        // Basic checks: protocol should be http or https, and hostname should contain 'supabase'
        return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && parsed.hostname && parsed.hostname.includes('supabase');
    } catch (e) {
        return false;
    }
}

if (SUPABASE_URL && SUPABASE_KEY && isValidUrl(SUPABASE_URL)) {
    try {
        supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    } catch (e) {
        console.error('Failed to initialize Supabase client:', e, { SUPABASE_URL, SUPABASE_KEY: !!SUPABASE_KEY });
        isMock = true;
        supabase = {
            from(table) {
                return createQuery(table);
            }
        };
    }
} else {
    if (SUPABASE_URL || SUPABASE_KEY) {
        console.warn('Supabase env vars present but invalid. Falling back to mock. Supabase URL:', SUPABASE_URL);
    }
    isMock = true;
    supabase = {
        from(table) {
            return createQuery(table);
        }
    };
}

// Helper: subscribe to a table's postgres_changes (works with real Supabase)
// Returns an unsubscribe function. If mock, it falls back to a polling mechanism.
export function subscribeToTable(table, handler, opts = { event: '*', schema: 'public', pollMs: 2000 }) {
    if (isMock) {
        // Simple polling for mock: call handler with latest data periodically
        let stopped = false;
        const poll = async () => {
            if (stopped) return;
            try {
                const { data } = await supabase.from(table).select('*');
                handler({ type: 'poll', table, data });
            } catch (e) { /* ignore */ }
            setTimeout(poll, opts.pollMs || 2000);
        };
        poll();
        return () => { stopped = true; };
    }

    const channel = supabase
        .channel(`public:${table}`)
        .on('postgres_changes', { event: opts.event, schema: opts.schema, table }, (payload) => {
            handler(payload);
        })
        .subscribe();

    return () => {
        try {
            supabase.removeChannel(channel);
        } catch (e) {
            // fallback
            channel.unsubscribe && channel.unsubscribe();
        }
    };
}

export { isMock };
export default supabase;
