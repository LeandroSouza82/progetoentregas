// Mock minimal supabase client for local development
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

export const supabase = {
    from(table) {
        return createQuery(table);
    }
};

export default supabase;
