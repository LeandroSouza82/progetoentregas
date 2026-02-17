import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join } from 'path';

// Ler .env.local
let supabaseUrl, supabaseKey;
try {
    const envPath = join(process.cwd(), '.env.local');
    const envContent = readFileSync(envPath, 'utf-8');
    const lines = envContent.split('\n');

    for (const line of lines) {
        if (line.startsWith('VITE_SUPABASE_URL=')) {
            supabaseUrl = line.split('=')[1].trim().replace(/['"]/g, '');
        }
        if (line.startsWith('VITE_SUPABASE_ANON_KEY=')) {
            supabaseKey = line.split('=')[1].trim().replace(/['"]/g, '');
        }
    }

    console.log('🔍 Supabase URL:', supabaseUrl);
} catch (err) {
    console.error('❌ Erro ao ler .env.local:', err.message);
}

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Variáveis de ambiente não encontradas no .env.local');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkMotoristas() {
    console.log('🔍 Verificando motoristas no banco...\n');

    try {
        const { data, error, count } = await supabase
            .from('motoristas')
            .select('*', { count: 'exact' });

        if (error) {
            console.error('❌ Erro ao buscar motoristas:', error);
            return;
        }

        console.log(`✅ Total de motoristas: ${count || data?.length || 0}\n`);

        if (data && data.length > 0) {
            console.log('📋 Lista de motoristas:\n');
            data.forEach((m, idx) => {
                console.log(`${idx + 1}. ${m.nome || 'Sem nome'} ${m.sobrenome || ''}`);
                console.log(`   ID: ${m.id}`);
                console.log(`   Aprovado: ${m.aprovado ? '✅' : '❌'}`);
                console.log(`   Online: ${m.esta_online ? '✅' : '❌'}`);
                console.log(`   Lat/Lng: ${m.lat}, ${m.lng}`);
                console.log('');
            });
        } else {
            console.log('⚠️ Nenhum motorista encontrado no banco!');
            console.log('\n💡 Para adicionar um motorista de teste, execute:');
            console.log('   node scripts/add-motorista-teste.mjs');
        }

    } catch (err) {
        console.error('❌ Erro:', err);
    }
}

checkMotoristas();
