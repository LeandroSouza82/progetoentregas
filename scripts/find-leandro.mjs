import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join } from 'path';

let supabaseUrl, supabaseKey;
try {
    const envPath = join(process.cwd(), '.env.local');
    const envContent = readFileSync(envPath, 'utf-8');
    const lines = envContent.split('\n');
    for (const line of lines) {
        if (line.trim().startsWith('VITE_SUPABASE_URL=')) {
            supabaseUrl = line.split('=')[1].trim().replace(/['"]/g, '');
        }
        if (line.trim().startsWith('VITE_SUPABASE_ANON_KEY=')) {
            supabaseKey = line.split('=')[1].trim().replace(/['"]/g, '');
        }
    }
} catch (err) {
    console.error('Erro ao ler .env.local:', err.message);
}

if (!supabaseUrl || !supabaseKey) {
    console.error('Supabase credentials not found.');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const LEANDRO_ID = '00c21342-1d55-4feb-bb5a-0045f9fdd095';

async function checkLeandro() {
    console.log('--- BUSCANDO LEANDRO ---');

    // 1. Check motorista record
    const { data: motorista, error: mErr } = await supabase
        .from('motoristas')
        .select('*')
        .eq('id', LEANDRO_ID)
        .maybeSingle();

    if (mErr) console.error('Erro ao buscar motorista:', mErr);
    else if (motorista) {
        console.log('✅ Motorista encontrado:');
        console.log(`   Nome: ${motorista.nome} ${motorista.sobrenome || ''}`);
        console.log(`   Status: ${motorista.esta_online ? 'ONLINE' : 'OFFLINE'}`);
        console.log(`   Aprovado: ${motorista.aprovado}`);
    } else {
        console.log('❌ Motorista Leandro não encontrado com ID específico.');
        // Try searching by name
        const { data: search, error: sErr } = await supabase
            .from('motoristas')
            .select('*')
            .ilike('nome', '%Leandro%');
        if (search && search.length > 0) {
            console.log('🔍 Encontrei por nome:');
            console.table(search);
        }
    }

    // 2. Check deliveries (entregas)
    console.log('\n--- ENTREGAS DO LEANDRO ---');
    const { data: entregas, error: eErr } = await supabase
        .from('entregas')
        .select('id, cliente, endereco, status, created_at')
        .eq('motorista_id', LEANDRO_ID)
        .order('created_at', { ascending: false });

    if (eErr) console.error('Erro ao buscar entregas:', eErr);
    else if (entregas && entregas.length > 0) {
        console.log(`✅ ${entregas.length} entregas encontradas:`);
        console.table(entregas);
    } else {
        console.log('⚠️ Nenhuma entrega vinculada ao Leandro.');
    }
}

checkLeandro();
