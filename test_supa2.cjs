const { createClient } = require('./node_modules/@supabase/supabase-js/dist/index.cjs');
const fs = require('fs');
const code = fs.readFileSync('c:/progetoentregas/src/supabaseClient.js', 'utf8');
const matchUrl = code.match(/supabaseUrl\s*=\s*['"`]?([^'"`]+)['"`]?/);
const matchKey = code.match(/supabaseAnonKey\s*=\s*['"`]?([^'"`]+)['"`]?/);

if (matchUrl && matchKey) {
  let url = matchUrl[1];
  let key = matchKey[1];
  if (url.startsWith('import.meta')) {
    // try reading .env
    const env = fs.readFileSync('c:/progetoentregas/.env', 'utf8');
    const u = env.match(/VITE_SUPABASE_URL=(.*)/);
    const k = env.match(/VITE_SUPABASE_ANON_KEY=(.*)/);
    url = u[1].trim();
    key = k[1].trim();
  }
  const supabase = createClient(url, key);
  supabase.from('entregas').select('*').order('id', {ascending: false}).limit(3)
    .then(res => console.log(JSON.stringify(res.data, null, 2)))
    .catch(console.error);
}
