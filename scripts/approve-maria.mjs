import { supabase } from '../src/supabaseClient.js';

(async () => {
    try {
        console.log('[script] Procurando motorista pendente cujo nome contém "Maria"...');
        const { data, error } = await supabase.from('motoristas').select('*').ilike('nome', '%maria%').eq('aprovado', false).limit(1);
        if (error) {
            console.error('[script] Erro na busca:', error);
            process.exit(1);
        }
        if (!data || data.length === 0) {
            console.log('[script] Nenhum motorista pendente encontrado com nome contendo "Maria".');
            process.exit(0);
        }

        const m = data[0];
        console.log('[script] Encontrado:', { id: m.id, nome: m.nome, email: m.email, telefone: m.telefone, aprovado: m.aprovado });

        const { data: updData, error: updErr } = await supabase.from('motoristas').update({ aprovado: true, acesso: 'aprovado' }).eq('id', m.id).select();
        if (updErr) {
            console.error('[script] Erro ao aprovar:', updErr);
            process.exit(1);
        }
        console.log('[script] Motorista aprovado com sucesso:', updData);
        process.exit(0);
    } catch (e) {
        console.error('[script] Erro inesperado:', e);
        process.exit(1);
    }
})();