import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignPreparedRoute, isApprovedDriver } from '../src/services/routeAssignment.js';
function client({approved=true, rows, updateError}={}) {
 const calls=[]; const driver={id:'uuid',nome:'Leandro',aprovado:approved,esta_online:false};
 return {calls,from(table){calls.push(['from',table]);return {
  select(){return this;},eq(...a){calls.push(['eq',...a]);return this;},is(...a){calls.push(['is',...a]);return this;},in(){return this;},
  single(){return Promise.resolve({data:driver});},update(p){calls.push(['update',p]);return this;},
  insert(){throw new Error('Avisos legados não devem ser usados pelo despacho.');},
  then(ok,fail){return Promise.resolve({data:rows??[{id:1,motorista_id:'uuid',status:'em_rota'}],error:updateError}).then(ok,fail);}
 };}};
}
const request={driverId:'uuid',deliveryIds:[1]};
test('approved offline driver receives persistent route without legacy notice',async()=>{
 const c=client();const r=await assignPreparedRoute(c,request);assert.equal(r.warning,null);
 assert.ok(!c.calls.some(x=>x[0]==='from'&&x[1]==='avisos_gestor'));
 assert.ok(c.calls.some(x=>x[0]==='is'&&x[1]==='motorista_id'&&x[2]===null));
 assert.ok(!c.calls.some(x=>x[0]==='eq'&&x[1]==='esta_online'));
});
test('missing driver and empty route cannot write',async()=>{
 const c=client();for(const r of [{deliveryIds:[1]},{driverId:'uuid',deliveryIds:[]}])await assert.rejects(assignPreparedRoute(c,r));assert.equal(c.calls.length,0);
});
test('unapproved driver cannot receive route',async()=>{const c=client({approved:false});await assert.rejects(assignPreparedRoute(c,request),/aprovado/);assert.ok(!c.calls.some(x=>x[0]==='update'));assert.equal(isApprovedDriver({aprovado:null}),false);});
test('partial or wrong-owner updates never report success or emit notice',async()=>{
 for(const rows of [[],[{id:1,motorista_id:'other',status:'em_rota'}]]){const c=client({rows});await assert.rejects(assignPreparedRoute(c,request),/Nem todos/);assert.ok(!c.calls.some(x=>x[0]==='notice'));}
});
test('database error is surfaced',async()=>{await assert.rejects(assignPreparedRoute(client({updateError:new Error('RLS')}),request),/RLS/);});
test('route persistence does not depend on avisos_gestor UUID compatibility',async()=>{const c=client();const r=await assignPreparedRoute(c,request);assert.equal(r.warning,null);assert.equal(c.calls.filter(x=>x[0]==='update').length,1);assert.ok(!c.calls.some(x=>x[0]==='from'&&x[1]==='avisos_gestor'));});
