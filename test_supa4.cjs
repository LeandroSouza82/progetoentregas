const { createClient } = require('./node_modules/@supabase/supabase-js/dist/index.cjs');

const HARDCODED_URL = 'https://uqxoadxqcwidxqsfayem.supabase.co';
const HARDCODED_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxeG9hZHhxY3dpZHhxc2ZheWVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg0NDUxODksImV4cCI6MjA4NDAyMTE4OX0.q9_RqSx4YfJxlblPS9fwrocx3HDH91ff1zJvPbVGI8w';

const supabase = createClient(HARDCODED_URL, HARDCODED_KEY);
supabase.from('entregas').select('id, recebedor, nome_recebedor, recebedor_nome, tipo_recebedor, recebedor_tipo').order('id', {ascending: false}).limit(5)
  .then(res => console.log(JSON.stringify(res.data, null, 2)))
  .catch(console.error);
