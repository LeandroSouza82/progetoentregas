import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transform } from 'esbuild';
import { resolveEnvironment, PRODUCTION_PROJECT_REF } from '../src/environment.js';

const source = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const transformed = await transform(source, {loader:'jsx',format:'esm'});
const executable = transformed.code.replace(/^import .*;$/gm,'')
    .replaceAll('import.meta.env', 'env').replaceAll('import(', 'loadModule(')
    .replace(/start\(\);\s*$/, 'return start();');
async function start(env) {
    const renders=[], loaded=[];
    const React={createElement:(type,props,...children)=>({type,props,children}),StrictMode:'StrictMode'};
    const ReactDOM={createRoot:()=>({render:node=>renders.push(node)})};
    await new Function('React','ReactDOM','document','resolveEnvironment','env','loadModule',executable)(
        React,ReactDOM,{getElementById:()=>({})},resolveEnvironment,env,
        async path=>{loaded.push(path);return {default:()=>null};});
    return {renders,loaded};
}
test('invalid startup renders explanation without importing application or services', async () => {
    for(const env of [{},{VITE_APP_ENV:'test',VITE_SUPABASE_PROJECT_REF:PRODUCTION_PROJECT_REF,
        VITE_SUPABASE_URL:`https://${PRODUCTION_PROJECT_REF}.supabase.co`,VITE_SUPABASE_ANON_KEY:'sb_publishable_fake'}]) {
        const result=await start(env);
        assert.deepEqual(result.loaded,[]);
        assert.match(JSON.stringify(result.renders), /configuração pendente/);
    }
});
test('valid test startup loads application and shows test label', async () => {
    const result=await start({VITE_APP_ENV:'test',VITE_SUPABASE_PROJECT_REF:'ficticio',
        VITE_SUPABASE_URL:'https://ficticio.supabase.co',VITE_SUPABASE_ANON_KEY:'sb_publishable_fake'});
    assert.deepEqual(result.loaded,['leaflet/dist/leaflet.css','./App.jsx']);
    assert.match(JSON.stringify(result.renders), /Homologação/);
});
