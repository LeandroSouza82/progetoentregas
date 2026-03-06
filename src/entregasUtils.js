export function mergeRecordIntoArray(prev, rec) {
    const id = rec && rec.id;
    const list = Array.isArray(prev) ? prev.slice() : [];
    if (id === undefined || id === null) {
        // nothing to merge, return original list
        return list;
    }
    const idx = list.findIndex(i => i && i.id === id);
    if (idx !== -1) {
        list[idx] = { ...list[idx], ...rec };
    } else {
        list.push(rec);
    }
    // keep ordering by ordem_logistica when present
    try {
        return list.slice().sort((a, b) => {
            const oa = (a && Number(a.ordem_logistica)) || 99999;
            const ob = (b && Number(b.ordem_logistica)) || 99999;
            return oa - ob;
        });
    } catch (e) {
        return list;
    }
}

export function removeRecordById(prev, id) {
    if (!Array.isArray(prev)) return [];
    return prev.filter(i => i && i.id !== id);
}
