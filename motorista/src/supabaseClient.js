// Mock supabase client for motorista app (similar to dashboard/src/supabaseClient.js)
function storageKey(table) { return `mock_${table}`; }
function readTable(table) {
    try { const raw = localStorage.getItem(storageKey(table)); if (!raw) return []; return JSON.parse(raw); } catch (e) { return []; }
}
function writeTable(table, data) { localStorage.setItem(storageKey(table), JSON.stringify(data)); }
function applyFilters(items, filters) { if (!filters || filters.length === 0) return items; return items.filter(item => filters.every(([field, value]) => String(item[field]) === String(value))); }

function createQuery(table) {
    let op = null; let updateObj = null; const filters = []; let selectCols = null; let orderSpec = null;
    return {
        select(cols) { selectCols = cols; return this; },
        insert: async (rows) => { const all = readTable(table); const toInsert = rows.map(r => ({ id: Date.now() + Math.floor(Math.random() * 1000), ...r })); const next = all.concat(toInsert); writeTable(table, next); return { data: toInsert, error: null }; },
        delete() { op = 'delete'; return this; },
        update(obj) { op = 'update'; updateObj = obj; return this; },
        eq(field, value) { filters.push([field, value]); return this; },
        order(field, opts) { orderSpec = { field, opts }; return this; },
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
            if (op === 'delete') { const remaining = all.filter(i => !matched.includes(i)); writeTable(table, remaining); return { data: matched, error: null }; }
            if (op === 'update') { const updated = all.map(i => matched.includes(i) ? { ...i, ...updateObj } : i); writeTable(table, updated); const returned = updated.filter(i => matched.some(m => m.id === i.id)); return { data: returned, error: null }; }
            return { data: matched, error: null };
        },
        then(resolve, reject) { this._exec().then(resolve, reject); }
    };
}

if (!localStorage.getItem(storageKey('frota'))) {
    writeTable('frota', [{ id: 1, nome: 'Carlos Oliveira', status: 'Online', veiculo: 'Fiorino', placa: 'ABC-1234', fone: '5511999990000' }]);
}
if (!localStorage.getItem(storageKey('entregas'))) { writeTable('entregas', []); }

export const supabase = { from(table) { return createQuery(table); } };
export default supabase;
