import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join } from 'path';

let supabaseUrl, supabaseKey;
try {
    const envPath = join(process.cwd(), '.env.local');
    const envContent = readFileSync(envPath, 'utf-8');
    const lines = envContent.split('\n');
    for (const line of lines) {
        if (line.trim().startsWith('VITE_SUPABASE_URL=')) supabaseUrl = line.split('=')[1].trim().replace(/['"]/g, '');
        if (line.trim().startsWith('VITE_SUPABASE_ANON_KEY=')) supabaseKey = line.split('=')[1].trim().replace(/['"]/g, '');
    }
} catch (err) {
    console.error('Erro ao ler .env.local:', err.message);
}

if (!supabaseUrl || !supabaseKey) {
    console.error('Supabase credentials not found in .env.local — abortando.');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    console.log('🚨 Iniciando remoção de entregas duplicadas: [264, 265, 266]');
    const ids = [264, 265, 266];

    // Show current records (if any)
    const { data: found, error: findErr } = await supabase.from('entregas').select('id, cliente, endereco, status, created_at').in('id', ids);
    if (findErr) console.warn('Erro ao buscar registros antes da remoção:', findErr);
    console.log('Registros atuais para os IDs solicitados:', found || []);

    // Perform deletion
    const { data, error } = await supabase.from('entregas').delete().in('id', ids);
    if (error) {
        console.error('Erro ao deletar entregas:', error);
        process.exit(1);
    }

    console.log('Resposta do delete:', { data, error });
    console.log('Registros removidos (se retornados):', Array.isArray(data) ? data.map(d => d.id) : data);
    console.log('✅ Operação concluída.');
}

run().catch(err => {
    console.error('Erro inesperado:', err);
    process.exit(1);
});