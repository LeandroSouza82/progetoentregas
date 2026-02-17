import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Missing Supabase env variables. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
    try {
        const random = Math.random().toString(36).slice(2, 8);
        const email = `v10-test-${Date.now()}-${random}@example.com`;
        const password = `V10-${Date.now().toString(36)}-${random}A!`;
        const nome = `V10 Test ${random}`;

        console.log('Creating test user:', email);
        const signRes = await supabase.auth.signUp({
            email,
            password,
            options: { data: { nome } }
        });

        if (signRes.error) {
            console.error('signUp error:', signRes.error);
            process.exit(1);
        }

        const userId = signRes.data?.user?.id || signRes.user?.id || null;
        console.log('signUp returned user id:', userId);

        console.log('Waiting 2s for trigger to run...');
        await sleep(2000);

        // Build double-filter using only `id` and `email` (avoid non-existent columns)
        const orParts = [];
        if (userId) orParts.push(`id.eq.${userId}`);
        orParts.push(`email.eq.${email}`);
        const orFilter = orParts.join(',');

        console.log('Querying motoristas with .or(', orFilter, ')');
        const { data: found, error: findErr } = await supabase.from('motoristas').select('*').or(orFilter).limit(1);
        if (findErr) {
            console.error('Error querying motoristas:', findErr);
            process.exit(1);
        }

        if (!found || found.length === 0) {
            console.error('❌ Trigger did not create a motoristas row for the new user.');
            process.exit(1);
        }

        console.log('✅ Trigger OK — motoristas row found:', found[0]);

        // Now test double-filter updates
        console.log('Testing double-filter update: setting esta_online = true');
        const { error: upErr1 } = await supabase.from('motoristas').update({ esta_online: true }).or(orFilter).select();
        if (upErr1) {
            console.error('Error setting esta_online = true:', upErr1);
            process.exit(1);
        }

        console.log('Testing double-filter update: setting esta_online = false');
        const { error: upErr2 } = await supabase.from('motoristas').update({ esta_online: false }).or(orFilter).select();
        if (upErr2) {
            console.error('Error setting esta_online = false:', upErr2);
            process.exit(1);
        }

        console.log('✅ Filtro Duplo OK');
        process.exit(0);
    } catch (e) {
        console.error('Unexpected error in validation script:', e && e.message ? e.message : e);
        process.exit(1);
    }
}

main();
