export const isApprovedDriver = (driver) => driver?.aprovado === true;

// A atribuição fica no banco: presença e GPS do motorista não são pré-requisitos.
export async function assignPreparedRoute(client, { driverId, deliveryIds, pickup }) {
    if (!driverId || !deliveryIds?.length) throw new Error('Selecione um motorista e organize o roteiro antes de enviar.');
    const ids = [...new Set(deliveryIds.map(String))];
    const { data: driver, error: driverError } = await client.from('motoristas')
        .select('id,nome,aprovado').eq('id', driverId).single();
    if (driverError) throw driverError;
    if (!isApprovedDriver(driver)) throw new Error('Este motorista ainda precisa ser aprovado pelo gestor.');

    const payload = { motorista_id: String(driver.id), status: 'em_rota' };
    if (pickup && Number.isFinite(pickup.lat) && Number.isFinite(pickup.lng)) {
        Object.assign(payload, { endereco_coleta: 'Localização Dinâmica (Gestor)', lat_coleta: pickup.lat, lng_coleta: pickup.lng });
    }
    const { data, error } = await client.from('entregas').update(payload)
        .in('id', ids).eq('status', 'pendente').is('motorista_id', null)
        .select('id,motorista_id,status');
    if (error) throw error;
    const confirmedIds = new Set((data || []).filter(row =>
        String(row.motorista_id) === String(driver.id) && row.status === 'em_rota'
    ).map(row => String(row.id)));
    if (confirmedIds.size !== ids.length || ids.some(id => !confirmedIds.has(id))) {
        throw new Error('Nem todos os pontos puderam ser atribuídos. Atualize a fila para conferir os pontos já enviados antes de tentar novamente.');
    }
    // O próprio roteiro é o registro persistente. O app consulta os pontos ao abrir
    // e produz o aviso local; não depende de avisos_gestor (ID bigint no legado).
    return { driver, ids, warning: null };
}
