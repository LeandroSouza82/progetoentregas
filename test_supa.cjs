const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const code = fs.readFileSync('c:/progetoentregas/src/supabaseClient.js', 'utf8');
const matchUrl = code.match(/supabaseUrl\s*=\s*['"`]?([^'"`]+)['"`]?/);
const matchKey = code.match(/supabaseAnonKey\s*=\s*['"`]?([^'"`]+)['"`]?/);
if (matchUrl && matchKey) {
  const supabase = createClient(matchUrl[1], matchKey[1]);
  supabase.from('entregas').select('*').order('id', {ascending: false}).limit(10).then(res => console.log(JSON.stringify(res.data, null, 2))).catch(console.error);
}
