import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Missing Supabase env variables. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const LEANDRO_ID = '00c21342-1d55-4feb-bb5a-0045f9fdd095';

async function main() {
    try {
        console.log('Fetching entregas with status = "aguardando" (limit 5)');
        const { data: rows, error } = await supabase
            .from('entregas')
            .select('id,cliente,endereco,status,motorista_id')
            .eq('status', 'aguardando')
            .limit(5);

        if (error) {
            console.error('Error fetching entregas:', error);
            process.exit(1);
        }

        if (!rows || rows.length === 0) {
            console.log('No entregas with status "aguardando" found. Trying entregas with null motorista_id...');
            const { data: rows2, error: err2 } = await supabase
                .from('entregas')
                .select('id,cliente,endereco,status,motorista_id')
                .is('motorista_id', null)
                .limit(5);

            if (err2) {
                console.error('Error fetching entregas with null motorista_id:', err2);
                process.exit(1);
            }

            if (!rows2 || rows2.length === 0) {
                console.log('No candidate entregas found to assign. Exiting.');
                process.exit(0);
            }

            await assign(rows2.slice(0, 3));
        } else {
            await assign(rows.slice(0, 3));
        }
    } catch (e) {
        console.error('Unexpected error:', e);
        process.exit(1);
    }
}

async function assign(candidates) {
    const ids = candidates.map(r => r.id).filter(Boolean);
    if (ids.length === 0) {
        console.log('No valid entrega IDs to assign.');
        return;
    }
    console.log('Assigning entregas:', ids, 'to motorista', LEANDRO_ID);

    // Bulk update using .in
    try {
        const { data, error } = await supabase
            .from('entregas')
            .update({ motorista_id: LEANDRO_ID })
            .in('id', ids)
            .select('id,cliente,endereco,status,motorista_id');

        if (error) {
            console.error('Error updating entregas:', error);
            process.exit(1);
        }

        console.log('Updated rows:', data);

        // Confirm by querying entregas for Leandro
        const { data: confirm, error: cErr } = await supabase
            .from('entregas')
            .select('id,cliente,endereco,status,motorista_id')
            .eq('motorista_id', LEANDRO_ID)
            .order('id', { ascending: false })
            .limit(10);

        if (cErr) {
            console.error('Error confirming entregas for Leandro:', cErr);
            process.exit(1);
        }

        console.log(`Entregas currently assigned to ${LEANDRO_ID}:`);
        console.table(confirm || []);
    } catch (e) {
        console.error('Assign failed:', e && e.message ? e.message : e);
        process.exit(1);
    }
}

main();
