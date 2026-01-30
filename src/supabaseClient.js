import { createClient } from '@supabase/supabase-js';

// Detect env vars (works in Vite browser and Node)
const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : process.env;

// Primary sources for credentials
let SUPABASE_URL = env.VITE_SUPABASE_URL || env.SUPABASE_URL || '';
let SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || '';

// Optional hardcoded fallback for local development ONLY.
// If you want to enable it, replace the empty strings below with your local dev Supabase values.
// Leave blank in production/repos to avoid leaking keys.
const DEV_FALLBACK_URL = '';
const DEV_FALLBACK_ANON_KEY = '';

// If running in development *and* env vars are missing, allow an explicit fallback.
if ((!SUPABASE_URL || !SUPABASE_ANON_KEY) && (process.env.NODE_ENV === 'development' || env.NODE_ENV === 'development')) {
    if (DEV_FALLBACK_URL && DEV_FALLBACK_ANON_KEY) {
        SUPABASE_URL = SUPABASE_URL || DEV_FALLBACK_URL;
        SUPABASE_ANON_KEY = SUPABASE_ANON_KEY || DEV_FALLBACK_ANON_KEY;
        console.warn('Using DEV_FALLBACK Supabase credentials. Consider setting env vars instead.');
    }
}

export const HAS_SUPABASE_CREDENTIALS = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let supabase = null;

if (HAS_SUPABASE_CREDENTIALS) {
    try {
        supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { realtime: { params: { eventsPerSecond: 10 } } });
        console.log('✅ CONEXÃO REAL ESTABELECIDA COM SUPABASE');
    } catch (e) {
        console.error('Falha ao inicializar Supabase client:', e);
        supabase = null;
    }
} else {
    console.error('Supabase credentials missing. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your environment.');
}

// Helper: subscribe to realtime changes for a table — returns an unsubscribe function.
// If Supabase is not available, returns a noop unsub and logs an error.
export function subscribeToTable(table, handler, opts = { event: '*', schema: 'public' }) {
    if (!supabase || !supabase.channel) {
        console.error('subscribeToTable: Supabase client not initialized. Cannot subscribe to realtime.');
        return () => { /* noop */ };
    }
    const channel = supabase
        .channel(`public:${table}`)
        .on('postgres_changes', { event: opts.event, schema: opts.schema, table }, (payload) => handler(payload))
        .subscribe();

    return () => {
        try { supabase.removeChannel(channel); } catch (e) { channel.unsubscribe && channel.unsubscribe(); }
    };
}

export default supabase;
