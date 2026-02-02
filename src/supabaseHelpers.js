import { supabase } from './supabaseClient';

export async function logoutSetOffline() {
    try {
        // Pega usuário atual (Auth v2)
        const { data } = await supabase.auth.getUser();
        const user = data?.user || null;
        if (user) {
            // Tenta avisar o banco usando id OU email (fallback), pois o id do Auth pode ser UUID diferente do PK da tabela
            try {
                const idPart = user.id ? `id.eq.${user.id}` : null;
                const emailPart = user.email ? `email.eq.${user.email}` : null;
                const orFilter = [idPart, emailPart].filter(Boolean).join(',');
                if (orFilter) {
                    const updatePromise = supabase.from('motoristas').update({ esta_online: false }).or(orFilter);
                    // Aguarda no máximo 2s pelo update para não travar o logout
                    const timeout = new Promise((res) => setTimeout(() => res({ timeout: true }), 2000));
                    const result = await Promise.race([updatePromise, timeout]);
                    if (result && result.timeout) {
                        console.warn('logoutSetOffline: update excedeu 2s, prosseguindo com signOut');
                    } else {
                        const { error } = result || {};
                        if (error) console.warn('logoutSetOffline: erro ao atualizar esta_online por id/email', error);
                    }
                }
            } catch (e) {
                console.warn('logoutSetOffline: falha no update de esta_online (por id/email)', e);
            }
        }
    } catch (e) {
        console.warn('logoutSetOffline: falha ao marcar motorista offline', e);
    }

    try {
        // Ordem: garantir que o update no banco por email aconteça antes do signOut
        try {
            // obter email salvo como fallback
            const fallbackEmail = (user && user.email) ? user.email : (typeof localStorage !== 'undefined' ? localStorage.getItem('v10_email') : null);
            if (fallbackEmail) {
                const { error } = await supabase.from('motoristas').update({ esta_online: false }).eq('email', fallbackEmail);
                if (error) console.warn('logoutSetOffline: erro ao atualizar esta_online por email antes do signOut', error);
            }
        } catch (e) {
            console.warn('logoutSetOffline: falha ao executar update por email antes do signOut', e);
        }

        try {
            await supabase.auth.signOut();
        } catch (e) {
            console.warn('logoutSetOffline: falha ao executar signOut', e);
        }
        try { if (typeof localStorage !== 'undefined') localStorage.removeItem('v10_email'); } catch (e) { }
    } catch (e) {
        console.warn('logoutSetOffline: falha ao executar signOut', e);
    }
}

export default logoutSetOffline;
