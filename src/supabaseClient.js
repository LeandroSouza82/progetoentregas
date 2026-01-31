import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://uqxoadxqcwidxqsfayem.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxeG9hZHhxY3dpZHhxc2ZheWVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg0NDUxODksImV4cCI6MjA4NDAyMTE4OX0.q9_RqSx4YfJxlblPS9fwrocx3HDH91ff1zJvPbVGI8w';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

console.log('🚀 CONECTADO AO SUPABASE REAL: uqxoadxqcwidxqsfayem');
