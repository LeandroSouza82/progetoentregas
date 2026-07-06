const { createClient } = require('./node_modules/@supabase/supabase-js/dist/index.cjs');
const fs = require('fs');

const env = fs.readFileSync('c:/progetoentregas/.env.local', 'utf8');
const u = env.match(/VITE_SUPABASE_URL\s*=\s*(.*)/)[1].trim().replace(/['"]/g, '');
const k = env.match(/VITE_SUPABASE_ANON_KEY\s*=\s*(.*)/)[1].trim().replace(/['"]/g, '');

const supabase = createClient(u, k);
supabase.from('entregas').select('*').order('id', {ascending: false}).limit(5)
  .then(res => console.log(JSON.stringify(res.data, null, 2)))
  .catch(console.error);
