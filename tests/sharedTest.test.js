import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {createSharedTestFetch, scopedRealtimeClient, testCardName} from '../src/sharedTest.js';
import {resolveEnvironment,PRODUCTION_PROJECT_REF} from '../src/environment.js';
import {assignPreparedRoute} from '../src/services/routeAssignment.js';
const driver='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const env={url:`https://${PRODUCTION_PROJECT_REF}.supabase.co`,testDriverId:driver,isSharedTest:true};
function capture(){const calls=[];return {calls,fetch:createSharedTestFetch(env,async req=>{calls.push({url:new URL(req.url),method:req.method,body:req.method==='GET'?null:await req.text()});return Response.json([]);})};}
test('shared database needs explicit mode and dedicated driver',()=>{
 const vars={VITE_APP_ENV:'shared-test',VITE_SUPABASE_URL:env.url,VITE_SUPABASE_PROJECT_REF:PRODUCTION_PROJECT_REF,VITE_SUPABASE_ANON_KEY:'sb_publishable_fake'};
 assert.throws(()=>resolveEnvironment(vars));
 assert.equal(resolveEnvironment({...vars,VITE_TEST_DRIVER_ID:driver}).isSharedTest,true);
});
test('new cards are visibly marked and cannot upsert existing cards',async()=>{
 const c=capture();await c.fetch(env.url+'/rest/v1/entregas',{method:'POST',body:JSON.stringify([{cliente:'Teste 1'}])});
 const row=JSON.parse(c.calls[0].body)[0];assert.equal(row.cliente,'TESTE V10 - Teste 1');assert.match(row.obs,/NÃO REALIZAR/);
 assert.equal(testCardName('TESTE V10 - Teste 2'),'TESTE V10 - Teste 2');
 await assert.rejects(c.fetch(env.url+'/rest/v1/entregas',{method:'POST',headers:{prefer:'resolution=merge-duplicates'},body:'[{"id":3}]'}));
});
test('reads, updates and deletes always include test-name filter and preserve ID filters',async()=>{
 const c=capture();for(const method of ['GET','PATCH','DELETE'])await c.fetch(env.url+'/rest/v1/entregas?id=in.(1,2)',{method,...(method==='PATCH'?{body:'{"status":"em_rota"}'}:{})});
 for(const call of c.calls){assert.equal(call.url.searchParams.get('cliente'),'ilike.TESTE V10 - *');assert.equal(call.url.searchParams.get('id'),'in.(1,2)');}
});
test('wide writes, real drivers and maintenance tables never reach network',async()=>{
 const c=capture();for(const [path,method,body]of [['entregas','DELETE'],['entregas','PATCH','{}'],['entregas?id=eq.1','PATCH','{"motorista_id":"other"}'],['logs_roteirizacao','DELETE'],['rpc/reset','POST','{}'],['motoristas','POST','{}']])await assert.rejects(c.fetch(env.url+'/rest/v1/'+path,{method,body}));
 assert.equal(c.calls.length,0);
});
test('driver presence updates are restricted to dedicated TESTE driver',async()=>{
 const c=capture();await c.fetch(env.url+'/rest/v1/motoristas?id=eq.other',{method:'PATCH',body:'{"esta_online":true}'});
 assert.deepEqual(c.calls[0].url.searchParams.getAll('id'),['eq.other','eq.'+driver]);assert.equal(c.calls[0].url.searchParams.get('nome'),'ilike.TESTE V10 - *');
});
test('realtime ignores real cards and other drivers',()=>{
 const callbacks=[];const channel={on(type,filter,cb){callbacks.push(cb);return this;},subscribe(){return this;}};
 const wrapped=scopedRealtimeClient({channel:()=>channel},env);const delivered=[];
 wrapped.channel('test').on('postgres_changes',{table:'entregas'},p=>delivered.push(p)).subscribe();
 callbacks[0]({new:{cliente:'Cliente real'},eventType:'UPDATE'});callbacks[0]({new:{cliente:'TESTE V10 - 1'},eventType:'INSERT'});assert.equal(delivered.length,1);
});
test('SDK dispatch persists offline test route and a fresh client reads it; other cards stay untouched',async()=>{
 const rows=[{id:1,cliente:'TESTE V10 - 1',status:'pendente',motorista_id:null},{id:2,cliente:'CLIENTE REAL',status:'pendente',motorista_id:null}];
 const server=async request=>{
  const u=new URL(request.url);if(u.pathname.endsWith('/motoristas'))return Response.json({id:driver,nome:'TESTE V10 - Motorista',aprovado:true,esta_online:false});
  const ids=(u.searchParams.get('id')||'').match(/\d+/g)||[];
  const selected=rows.filter(r=>(!ids.length||ids.includes(String(r.id)))&&(!u.searchParams.has('cliente')||r.cliente.startsWith('TESTE V10 - ')));
  if(request.method==='PATCH'){const data=await request.json();selected.forEach(r=>Object.assign(r,data));}
  return Response.json(selected);
 };
 const make=()=>createClient(env.url,'sb_publishable_fake',{global:{fetch:createSharedTestFetch(env,server)},auth:{persistSession:false,autoRefreshToken:false}});
 await assignPreparedRoute(make(),{driverId:driver,deliveryIds:[1]});
 const result=await make().from('entregas').select().eq('motorista_id',driver).eq('status','em_rota');
 assert.equal(result.error,null);assert.deepEqual(result.data.map(r=>r.id),[1]);assert.equal(rows[1].motorista_id,null);assert.equal(rows[1].status,'pendente');
});
