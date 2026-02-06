import { createClient } from '@supabase/supabase-js';

// ==========================================
// CONFIGURAÇÃO DE AMBIENTE
// ==========================================

const isNode = typeof window === 'undefined';

// Credenciais (Fallback Hardcoded para garantir funcionamento se .env falhar)
const HARDCODED_URL = 'https://uqxoadxqcwidxqsfayem.supabase.co';
const HARDCODED_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxeG9hZHhxY3dpZHhxc2ZheWVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg0NDUxODksImV4cCI6MjA4NDAyMTE4OX0.q9_RqSx4YfJxlblPS9fwrocx3HDH91ff1zJvPbVGI8w';

// Tentativa segura de ler env (Node compatible)
const getEnv = (key) => {
    try {
        if (!isNode && import.meta && import.meta.env) {
            return import.meta.env[key];
        }
    } catch (e) { }
    return null;
};

const supabaseUrl = getEnv('VITE_SUPABASE_URL') || HARDCODED_URL;
const supabaseAnonKey = getEnv('VITE_SUPABASE_ANON_KEY') || HARDCODED_KEY;

// ==========================================
// ✅ VARIÁVEIS DE AMBIENTE - VERCEL
// ==========================================
// IMPORTANTE: Certifique-se de que estas variáveis estão configuradas na Vercel:
// 
// 1. VITE_SUPABASE_URL = https://uqxoadxqcwidxqsfayem.supabase.co
// 2. VITE_SUPABASE_ANON_KEY = (sua chave anon key)
//
// ⚠️ NÃO adicione Client ID ou Client Secret nas variáveis de ambiente da Vercel.
//    Essas chaves devem estar APENAS no painel do Supabase (Authentication > Providers > Google).
//
// Se adicionadas na Vercel, REMOVA imediatamente:
//    - GOOGLE_CLIENT_ID
//    - GOOGLE_CLIENT_SECRET
//    - Qualquer variável começando com GOOGLE_ ou OAUTH_
//
// O fluxo OAuth usa as credenciais configuradas no Supabase, não nas variáveis de ambiente.
// ==========================================

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
        // Criar cliente com storage personalizável
        clientInstance = createClient(supabaseUrl, supabaseAnonKey, {
            auth: {
                autoRefreshToken: true,
                persistSession: true,
                detectSessionInUrl: true,
                flowType: 'pkce',
                storage: window.localStorage  // Default: localStorage
            }
        });
        hasCreds = true;

        // Log de verificação (Solicitado Pelo Usuário)
        if (clientInstance && clientInstance.auth) {
            console.log('✅ [V10 Delivery] supabase.auth detectado com sucesso.');
        } else {
            console.warn('⚠️ [V10 Delivery] CLIENTE CRIADO MAS SUPABASE.AUTH É UNDEFINED');
        }
        // ✅ Função para alterar o tipo de storage dinamicamente
        clientInstance.setStorageType = function (useLocalStorage) {
            const newStorage = useLocalStorage ? window.localStorage : window.sessionStorage;

            // Recriar o cliente com o novo storage
            const newClient = createClient(supabaseUrl, supabaseAnonKey, {
                auth: {
                    autoRefreshToken: true,
                    persistSession: true,
                    detectSessionInUrl: true,
                    flowType: 'pkce',
                    storage: newStorage
                }
            });

            // Copiar propriedades do novo cliente para o atual
            clientInstance.auth = newClient.auth;

            console.log(`🔄 [Supabase] Storage alterado para: ${useLocalStorage ? 'localStorage (persistente)' : 'sessionStorage (sessão única)'}`);
        };
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
    try {
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
export const supabase = clientInstance;
export default supabase;

