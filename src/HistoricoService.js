import { supabase } from './supabaseClient';

/**
 * Serviço modular para gestão de dados do Histórico
 */
export const HistoricoService = {
    /**
     * Busca entregas finalizadas filtradas por data opcional
     * @param {string} dataIso - Data no formato YYYY-MM-DD
     */
    async fetchHistorico(dataIso = null, busca = '') {
        try {
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

            if (busca) {
                const termo = `%${busca}%`;
                // Filtering globally if a search term is provided, ignoring dataIso
                query = query.or(`cliente.ilike.${termo},endereco.ilike.${termo}`);
            } else if (dataIso) {
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
