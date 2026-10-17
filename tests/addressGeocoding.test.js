import { test } from 'node:test';
import assert from 'node:assert/strict';
import { geocodeExactAddress,normalizeAddressQuery,validCoordinates } from '../src/services/addressGeocoding.js';
const address='Rua Najla Carone Guedert, 123, Pagani, Palhoça, SC, Brasil';
const feature={center:[-48.67,-27.64],address:'123',relevance:1,place_name:address};
const fake=f=>async()=>({ok:true,json:async()=>({features:[f]})});
test('preserves complete address and hyphens without forced city',async()=>{
 const input='Rua Rio-de-Janeiro, 55, Centro, São José, SC';assert.equal(normalizeAddressQuery(input),input);
 let url;await geocodeExactAddress(address,'test',async u=>{url=u;return fake(feature)();});
 assert.ok(decodeURIComponent(url.pathname).includes(address));assert.equal(url.searchParams.get('fuzzyMatch'),'false');
});
test('never substitutes hardcoded number 821',async()=>{assert.equal(await geocodeExactAddress(address,'test',fake({...feature,address:'821'})),null);});
test('rejects street-only and uncertain candidates',async()=>{for(const f of [{...feature,address:undefined},{...feature,relevance:0.5},{...feature,relevance:undefined}])assert.equal(await geocodeExactAddress(address,'test',fake(f)),null);});
test('number in street name is not house number',async()=>{assert.equal(await geocodeExactAddress('Rua 7 de Setembro, 95, São José, SC','test',fake({...feature,address:'7'})),null);});
test('coordinates stay in lat lng order',async()=>{const r=await geocodeExactAddress(address,'test',fake(feature));assert.deepEqual([r.lat,r.lng],[-27.64,-48.67]);});
test('rejects invalid coordinate pairs',()=>{for(const pair of [[NaN,1],[1,Infinity],[91,1],[1,181],[0,0],[null,1]])assert.equal(validCoordinates(...pair),false);});
