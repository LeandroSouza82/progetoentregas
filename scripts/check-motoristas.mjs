import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://uqxoadxqcwidxqsfayem.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxeG9hZHhxY3dpZHhxc2ZheWVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg0NDUxODksImV4cCI6MjA4NDAyMTE4OX0.q9_RqSx4YfJxlblPS9fwrocx3HDH91ff1zJvPbVGI8w';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

(async () => {
    try {
        const { data, error } = await supabase.from('motoristas').select('*');
        if (error) {
            console.error('Erro ao buscar motoristas:', error.message || error);
            process.exit(1);
        }
        console.log('Motoristas encontrados:', (data || []).length);
        console.table((data || []).map(m => ({ id: m.id, nome: m.nome, lat: m.lat, lng: m.lng })));
    } catch (e) {
        console.error('Falha inesperada:', e && e.message ? e.message : e);
        process.exit(1);
    }
})();
