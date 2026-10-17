import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isApprovedDriver } from '../src/services/routeAssignment.js';

// Executa o handler conectado à tabela, sem React nem conexão de rede.
const source = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const start = source.indexOf('    const aoSelecionarMotorista =');
const end = source.indexOf('    const handleEnviarRota', start);
assert.ok(start >= 0 && end > start);
function selection() {
    const state = [];
    const forbidden = new Proxy({}, {get(){throw new Error('Selecionar não pode acessar o banco.');}});
    const handler = new Function('isApprovedDriver', 'setMotoristaSelecionadoId', 'setPodeEnviar', 'supabase',
        source.slice(start,end) + '\nreturn aoSelecionarMotorista;')(
        isApprovedDriver, id=>state.push(['driver',id]), allowed=>state.push(['send',allowed]), forbidden);
    return {handler,state};
}
test('selecting approved offline driver only changes selection, never deliveries', async () => {
    const {handler,state}=selection();
    await handler({id:'motorista-A',aprovado:true,esta_online:false});
    assert.deepEqual(state,[['driver','motorista-A'],['send',false]]);
    assert.match(source, /onClick=\{\(\) => aoSelecionarMotorista && aoSelecionarMotorista\(m\)\}/);
});
test('selection ignores unapproved or unidentified drivers', async () => {
    const {handler,state}=selection();
    for(const driver of [null,{}, {id:'B',aprovado:false},{aprovado:true}]) await handler(driver);
    assert.deepEqual(state,[]);
});
