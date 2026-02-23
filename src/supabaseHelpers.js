import { supabase } from './supabaseClient';

export async function logoutSetOffline() {
    // Nova lógica: limpar coordenadas (latitude/longitude/lat/lng) e setar `ultima_atualizacao` antes do signOut.
    try {
        // Pega usuário atual (Auth v2)
        const { data } = await supabase.auth.getUser();
        const user = data?.user || null;

        // Se tivermos um user.id, priorizamos o update por id e só executamos signOut após sucesso
        if (user && user.id) {
            try {
                const { data: updData, error: updErr } = await supabase.from('motoristas').update({ latitude: null, longitude: null, lat: null, lng: null, ultima_atualizacao: new Date() }).eq('id', user.id).select();
                if (updErr) {
                    console.error('logoutSetOffline: erro ao limpar localização por id', updErr);
                    return; // não prosseguir com signOut se falhar
                }
            } catch (e) {
                console.error('logoutSetOffline: exceção ao atualizar motoristas por id', e);
                return;
            }
        } else {
            // Fallback por email salvo no localStorage (ou user.email se disponível)
            try {
                const fallbackEmail = (user && user.email) ? user.email : (typeof localStorage !== 'undefined' ? localStorage.getItem('v10_email') : null);
                if (fallbackEmail) {
                    const { data: updData, error: updErr } = await supabase.from('motoristas').update({ latitude: null, longitude: null, lat: null, lng: null, ultima_atualizacao: new Date() }).eq('email', fallbackEmail).select();
                    if (updErr) {
                        console.warn('logoutSetOffline: erro ao limpar localização por email (fallback)', updErr);
                        // continuar para signOut mesmo que o update por email falhe, já que não temos id seguro
                    }
                }
            } catch (e) {
                console.warn('logoutSetOffline: falha no update por email (fallback)', e);
            }
        }

        // Finalmente, encerra a sessão
        try {
            await supabase.auth.signOut();
        } catch (e) {
            console.warn('logoutSetOffline: falha ao executar signOut', e);
        }

        try { if (typeof localStorage !== 'undefined') localStorage.removeItem('v10_email'); } catch (e) { }
    } catch (e) {
        console.warn('logoutSetOffline: falha inesperada', e);
    }
}

export default logoutSetOffline;
