import { supabase } from './supabaseClient';

/**
 * Serviço modular para gestão de dados do Histórico
 */
export const HistoricoService = {
    /**
     * Busca entregas finalizadas filtradas por data opcional
     * @param {string} dataIso - Data no formato YYYY-MM-DD
     */
    async fetchHistorico(dataIso = null) {
        try {
            // Incluindo 'arquivado' conforme solicitado para garantir que registros limpos do mapa apareçam aqui
            const statusAlvo = [
                'concluido', 'concluída', 'concluida', 'concluído',
                'falha', 'erro', 
                'entregue', 'entregada', 'entregado', 
                'sucesso', 'arquivado'
            ];


            let query = supabase
                .from('entregas')
                .select('*')
                .in('status', statusAlvo);

            if (dataIso) {
                // Filtro de data: do início ao fim do dia selecionado em UTC
                // data_conclusao é o campo oficial de finalização
                const start = `${dataIso}T00:00:00.000Z`;
                const end = `${dataIso}T23:59:59.999Z`;
                query = query.gte('data_conclusao', start).lte('data_conclusao', end);
            }

            const { data, error } = await query.order('data_conclusao', { ascending: false });

            
            if (error) {
                console.error("⚠️ [HistoricoService] Erro do Supabase:", error);
                throw error;
            }
            
            return data || [];
        } catch (err) {
            console.error('HistoricoService.fetchHistorico error:', err);
            throw err;
        }
    }
};
