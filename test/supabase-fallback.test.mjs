import assert from 'node:assert';

// Polyfill localStorage for Node tests
global.localStorage = global.localStorage || { getItem: () => null, setItem: () => null };

// Helper to import module with env overrides
async function loadWithEnv(env) {
  const oldEnv = { ...process.env };
  try {
    Object.assign(process.env, env);
    // Dynamically import a fresh copy by clearing cache
    const m = await import('../src/supabaseClient.js');
    return m;
  } finally {
    // Restore env and delete from cache
    process.env = oldEnv;
    const url = new URL('../src/supabaseClient.js', import.meta.url).pathname;
    // Node ESM caches modules by URL; to force reimport we'll import via data URL in tests when needed
  }
}

(async () => {
  // Case 1: invalid URL -> should fallback to mock
  process.env.VITE_SUPABASE_URL = 'nota-url';
  process.env.VITE_SUPABASE_ANON_KEY = 'key';
  let m = await import('../src/supabaseClient.js');
  assert.strictEqual(m.isMock, true, 'Expected isMock === true for invalid SUPABASE_URL');
  console.log('✅ invalid URL falls back to mock');

  // Case 2: valid-looking URL -> should attempt to initialize client (isMock === false)
  process.env.VITE_SUPABASE_URL = 'https://exemplo.supabase.co';
  process.env.VITE_SUPABASE_ANON_KEY = 'fakekey';
  // Need to reload module; using dynamic import with a unique query helps bypass cache
  const m2 = await import('../src/supabaseClient.js?#2');
  assert.strictEqual(m2.isMock, false, 'Expected isMock === false for valid SUPABASE_URL');
  console.log('✅ valid URL initializes client (syntactically)');

  console.log('All tests passed.');
})();