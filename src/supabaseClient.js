import { createClient } from '@supabase/supabase-js';

import { resolveEnvironment } from './environment.js';
import { createSharedTestFetch, scopedRealtimeClient } from './sharedTest.js';

const isNode = typeof window === 'undefined';
let environment = null;
let configurationError = null;
if (!isNode) {
    try { environment = resolveEnvironment(import.meta.env); }
    catch (error) { configurationError = error; }
}
const supabaseUrl = environment?.url;
const supabaseAnonKey = environment?.key;
export { environment, configurationError };

// ==========================================
// INICIALIZAÇÃO DO CLIENTE
// ==========================================

let clientInstance = null;
let hasCreds = false;
let subscribeFn = null;

if (isNode) {
    console.log('[SUPABASE] Ambiente Node detectado. Carregando Mock...');
    // --- MOCK LOGIC FOR NODE ---
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

    // seed defaults for tests if localStorage exists (Node with polyfill)
    if (typeof localStorage !== 'undefined') {
        if (!localStorage.getItem(storageKey('frota'))) {
            writeTable('frota', [{ id: 1, nome: 'Carlos Oliveira', status: 'Online', veiculo: 'Fiorino', placa: 'ABC-1234', fone: '5511999990000' }]);
        }
    }

    clientInstance = { from(table) { return createQuery(table); }, auth: { getSession: () => Promise.resolve({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => { } } } }) } };
    hasCreds = false;

    subscribeFn = function (table, handler, opts = {}) {
        return () => { };
    };

} else {
    // --- BROWSER / REAL CLIENT ---
    console.log('[SUPABASE] Inicializando cliente real...');

    if (!supabaseUrl || !supabaseAnonKey) {
        console.error('❌ [V10 Delivery] FALHA CRÍTICA: URL ou Key do Supabase ausentes.');
        clientInstance = null;
    } else {
        // Single instance guard to avoid Multiple GoTrueClient instances across HMR
        try {
            if (typeof globalThis !== 'undefined' && globalThis.__V10_SUPABASE_CLIENT__ && globalThis.__V10_SUPABASE_ENV__ === environment.url) {
                clientInstance = globalThis.__V10_SUPABASE_CLIENT__;
                hasCreds = true;
                console.log('🔁 [Supabase] Reusing existing global Supabase client instance');
            } else {
                // Criar cliente fixo com localStorage
                clientInstance = createClient(supabaseUrl, supabaseAnonKey, {
                    global: environment.isSharedTest ? {fetch: createSharedTestFetch(environment)} : {},
                    auth: {
                        autoRefreshToken: true,
                        persistSession: true,
                        detectSessionInUrl: true,
                        flowType: 'pkce',
                        storage: window.localStorage,
                        storageKey: `v10-${environment.name}-${environment.projectRef}-auth`
                    }
                });
                hasCreds = true;
                try {
                    globalThis.__V10_SUPABASE_CLIENT__ = clientInstance;
                    globalThis.__V10_SUPABASE_ENV__ = environment.url;
                } catch (e) { /* ignore */ }
                console.log('✅ [V10 Delivery] supabase.auth detectado com sucesso.');
            }
        } catch (e) {
            console.warn('⚠️ [V10 Delivery] Falha ao criar/reusar o cliente Supabase:', e);
            clientInstance = null;
            hasCreds = false;
        }

        subscribeFn = function (table, handler, opts = {}) {
            const pollMs = typeof opts.pollMs === 'number' ? opts.pollMs : 1000;
            let last = null;
            let stopped = false;
            (async () => {
                while (!stopped) {
                    try {
                        const res = await clientInstance.from(table).select('*');
                        const curr = JSON.stringify(res && res.data ? res.data : []);
                        if (curr !== last) {
                            last = curr;
                            handler({ data: res.data, error: res && res.error ? res.error : null });
                        }
                    } catch (e) { /* silent */ }
                    await new Promise(r => setTimeout(r, pollMs));
                }
            })();
            return () => { stopped = true; };
        };
    }
}

// ==========================================
// EXPORTS
// ==========================================

// Variáveis de Estado
export const HAS_SUPABASE_CREDENTIALS = hasCreds;
export let SUPABASE_CONNECTED = false; // Será atualizado pelo check
export let SUPABASE_READY = !!clientInstance; // Pronto imediatamente pois é síncrono agora
let lastSupabaseError = null;

// Callbacks (Mantidos para compatibilidade, mas agora disparam imediatamente)
const supabaseReadyHandlers = [];
export function onSupabaseReady(cb) {
    if (typeof cb !== 'function') return;
    try { setTimeout(() => cb(clientInstance), 0); } catch (e) { }
}

const supabaseConnectedHandlers = [];
export function onSupabaseConnected(cb) {
    if (typeof cb !== 'function') return;
    if (SUPABASE_CONNECTED) setTimeout(cb, 0);
    else supabaseConnectedHandlers.push(cb);
}

function _notifySupabaseConnected() {
    SUPABASE_CONNECTED = true;
    try { supabaseConnectedHandlers.forEach(fn => fn()); } catch (e) { }
    supabaseConnectedHandlers.length = 0;
}

// Função de Healthcheck
export async function checkSupabaseConnection() {
    lastSupabaseError = null;
    if (!clientInstance || typeof clientInstance.from !== 'function') {
        const err = new Error('Supabase client is not initialized');
        lastSupabaseError = err;
        SUPABASE_CONNECTED = false;
        return { connected: false, error: err };
    }
    try {
        const res = await clientInstance.from('entregas').select('id').limit(1);
        if (res.error) {
            lastSupabaseError = res.error;
            SUPABASE_CONNECTED = false;
            return { connected: false, error: res.error };
        }
        SUPABASE_CONNECTED = true;
        _notifySupabaseConnected();
        return { connected: true, error: null };
    } catch (e) {
        lastSupabaseError = e;
        SUPABASE_CONNECTED = false;
        return { connected: false, error: e };
    }
}

export function getLastSupabaseError() { return lastSupabaseError; }

export async function buscarTodasEntregas() {
    if (!clientInstance) return [];
    // Se estivermos no browser e o cliente suportar auth, verificar sessão ativa
    try {
        if (clientInstance.auth && typeof clientInstance.auth.getSession === 'function') {
            try {
                const { data: { session } = {} } = await clientInstance.auth.getSession();
                if (!session) {
                    // Não buscar dados sem sessão
                    console.log('🔒 buscarTodasEntregas: sessão ausente — abortando fetch de entregas');
                    return [];
                }
            } catch (e) {
                // Se falhar ao obter sessão, abortar por segurança
                console.warn('🔒 buscarTodasEntregas: falha ao obter sessão, abortando:', e);
                return [];
            }
        }

        const res = await clientInstance.from('entregas').select('*');
        if (res.error) throw res.error;
        return res.data || [];
    } catch (e) {
        console.warn('Erro fetch entregas:', e);
        return [];
    }
}

export const subscribeToTable = subscribeFn;

// ✅ Exportação Principal Clara e Direta (Solicitado)
export const supabase = scopedRealtimeClient(clientInstance, environment);
export default supabase;

