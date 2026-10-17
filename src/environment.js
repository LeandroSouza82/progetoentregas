// A referência de produção é usada apenas para impedir conexões de homologação.
export const PRODUCTION_PROJECT_REF = 'uqxoadxqcwidxqsfayem';

export function resolveEnvironment(env = {}) {
    const name = env.VITE_APP_ENV || 'test';
    if (!['test', 'shared-test', 'production'].includes(name)) throw new Error('Ambiente inválido. Use test, shared-test ou production.');
    const projectRef = (env.VITE_SUPABASE_PROJECT_REF || '').trim();
    const key = (env.VITE_SUPABASE_ANON_KEY || '').trim();
    let url;
    try { url = new URL(env.VITE_SUPABASE_URL); } catch {
        throw new Error('Configure o banco de homologação antes de abrir o painel.');
    }
    if (!/^[a-z0-9]+$/.test(projectRef) || url.protocol !== 'https:' || url.host !== `${projectRef}.supabase.co`
        || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
        throw new Error('A URL precisa corresponder ao projeto Supabase configurado.');
    }
    if (name === 'test' && projectRef === PRODUCTION_PROJECT_REF) {
        throw new Error('Conexão bloqueada: o painel de teste não pode usar o banco de produção.');
    }
    if (name === 'production' && projectRef !== PRODUCTION_PROJECT_REF) {
        throw new Error('O projeto configurado não corresponde à produção conhecida.');
    }
    const testDriverId = (env.VITE_TEST_DRIVER_ID || '').trim();
    if (name === 'shared-test' && (projectRef !== PRODUCTION_PROJECT_REF || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(testDriverId))) {
        throw new Error('Configure o projeto atual e o UUID do motorista TESTE para usar o banco compartilhado.');
    }
    if (!key) throw new Error('Configure a chave pública do projeto selecionado.');
    // Chaves administrativas nunca pertencem ao navegador.
    if (!key.startsWith('sb_publishable_')) {
        try {
            const encoded = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
            const claims = JSON.parse(atob(encoded));
            if (claims.role !== 'anon' || claims.ref !== projectRef) throw new Error();
        } catch { throw new Error('Use a chave pública do mesmo projeto, nunca uma chave administrativa.'); }
    }
    return Object.freeze({ name, projectRef, url: url.origin, key, isTest: name !== 'production', isSharedTest: name === 'shared-test', testDriverId });
}
