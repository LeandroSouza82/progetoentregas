// Supabase client wrapper: reads credentials from `import.meta.env` (Vite).
// If `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are present the code will
// attempt to dynamically import `@supabase/supabase-js` and initialize a real
// client. Otherwise a localStorage-backed mock is exported so the app can run
// without external configuration during development.
//
// Add the following to your .env (dashboard/.env.local) when using Supabase:
// VITE_SUPABASE_URL=https://<project-ref>.supabase.co
// VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
// (keep the anon key secret-ish; do NOT commit .env.local)
//
// The mock stores data in localStorage under keys 'mock_frota' and 'mock_pedidos'
// mock that implements a subset of the API used by this project (from(), auth.*)
// This lets the app run without network config during development.
// - Stores data in localStorage under keys 'mock_frota' and 'mock_pedidos'
// - Implements chainable `.from(table).select()/insert()/delete()/update().eq()`
// This avoids build errors when Supabase isn't configured. Replace with a
// real Supabase client when ready.

function storageKey(table) {
    return `mock_${table}`;
}

function readTable(table) {
    try {
        const raw = localStorage.getItem(storageKey(table));
        if (!raw) return [];
        return JSON.parse(raw);
    } catch (e) {
        return [];
    }
}

function writeTable(table, data) {
    localStorage.setItem(storageKey(table), JSON.stringify(data));
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

// initialize sample data if missing
if (!localStorage.getItem(storageKey('frota'))) {
    writeTable('frota', [
        { id: 1, nome: 'Carlos Oliveira', status: 'Online', veiculo: 'Fiorino', placa: 'ABC-1234', fone: '5511999990000' },
        { id: 2, nome: 'Ana Souza', status: 'Ocupado', veiculo: 'Van', placa: 'XYZ-9876', fone: '5511988887777' }
    ]);
}

if (!localStorage.getItem(storageKey('pedidos'))) {
    writeTable('pedidos', []);
}

// Read env vars through Vite's import.meta.env
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let realClient = null;
if (isSupabaseConfigured) {
    // dynamic import so projects without @supabase/supabase-js still run
    (async () => {
        try {
            const mod = await import('@supabase/supabase-js');
            realClient = mod.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
            console.log('[supabaseClient] Real Supabase client initialized');
        } catch (e) {
            console.warn('[supabaseClient] Could not load @supabase/supabase-js, falling back to mock', e);
        }
    })();
} else {
    console.log('[supabaseClient] VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY not set — using mock client');
}

const mock = {
    from(table) {
        return createQuery(table);
    },
    // minimal auth mock compatible surface
    auth: {
        async signInWithPassword({ email, password }) {
            // simulate success if email present
            if (!email || !password) return { error: { message: 'Missing credentials' }, data: null };
            // In a real setup you'd validate against users table; here we accept any.
            const user = { id: Date.now(), email };
            return { data: { user }, error: null };
        },
        async resetPasswordForEmail(email, options) {
            if (!email) return { error: { message: 'Missing email' }, data: null };
            // simulate sending email
            console.log('[supabaseClient:mock] resetPasswordForEmail called for', email, options);
            return { data: { message: 'Simulated reset email sent' }, error: null };
        }
    }
};

export const supabase = new Proxy({}, {
    get(_, prop) {
        if (realClient) return realClient[prop];
        return mock[prop];
    }
});

export default supabase;
