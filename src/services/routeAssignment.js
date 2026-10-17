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
    // O aviso é independente da atribuição; falha no aviso nunca provoca reenvio do roteiro.
    let warning = null;
    try {
        const { error: noticeError } = await client.from('avisos_gestor').insert({
            titulo: 'Novo roteiro', mensagem: 'Você tem um novo roteiro. Abra o aplicativo para consultar os pontos atribuídos a você.',
            motorista_id: String(driver.id), lida: false,
        });
        if (noticeError) throw noticeError;
    } catch {
        warning = 'O roteiro foi salvo, mas o aviso não pôde ser registrado. Ele aparecerá ao abrir o aplicativo.';
    }
    return { driver, ids, warning };
}
