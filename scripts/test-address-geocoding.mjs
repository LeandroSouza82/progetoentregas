import assert from 'node:assert/strict';
import test from 'node:test';
import { extrairComponentesEndereco, resultadoCorrespondeAoEndereco, buscarCoordenadas } from '../src/geoUtils.js';
const pedido = 'Cond. Positano Rua Veneza 390 passa vinte palhoça';

test('separa condomínio, rua e número no texto real do pedido', () => {
    const { rua, numero, cidade } = extrairComponentesEndereco(pedido);
    assert.equal(rua, 'Rua Veneza');
    assert.equal(numero, '390');
    assert.equal(cidade, 'Palhoça');

    // Garante que "Bloco A, Sala 801" seja limpo sem amputar o sobrenome "Blum" da rua
    const emilio = extrairComponentesEndereco('R. Emílio Blum, 131 - Bloco A, Sala 801 - Centro, Florianópolis - SC, 88020-010');
    assert.equal(emilio.rua, 'Rua Emílio Blum');
    assert.equal(emilio.numero, '131');
    assert.equal(emilio.cidade, 'Florianópolis');
});

test('rejeita outro logradouro, outro número, outra cidade e centro da rua', () => {
    for (const resultado of [
        'Rua Geraldo Jansem, 580, Ponte do Imaruim, Palhoça',
        'Rua Geraldo Jansem, 390, Palhoça',
        'Rua Veneza, 39, Palhoça',
        'Rua Veneza, Palhoça',
        'Rua Veneza, Passa 390, Palhoça',
        'Rua Veneza, 390, São José',
    ]) assert.equal(resultadoCorrespondeAoEndereco(pedido, resultado), false, resultado);
    assert.equal(resultadoCorrespondeAoEndereco(pedido, 'Rua Veneza, 390, Passa Vinte, Palhoça'), true);
    assert.equal(resultadoCorrespondeAoEndereco(pedido, '390 Rua Veneza, Palhoça'), true);
});

test('modo nível de rua aceita rua sem número, mas nunca outro número, rua ou cidade', () => {
    const opcoes = { exigirNumero: false };
    assert.equal(resultadoCorrespondeAoEndereco(pedido, 'Rua Veneza, Passa Vinte, Palhoça', {}, opcoes), true);
    assert.equal(resultadoCorrespondeAoEndereco(pedido, 'Rua Veneza, Palhoça', { road: 'Rua Veneza', house_number: '39' }, opcoes), false);
    assert.equal(resultadoCorrespondeAoEndereco(pedido, 'Rua Geraldo Jansem, Palhoça', {}, opcoes), false);
    assert.equal(resultadoCorrespondeAoEndereco(pedido, 'Rua Veneza, São José', {}, opcoes), false);
});

test('busca ignora o ponto incorreto e encontra o imóvel solicitado', async () => {
    const fetchAnterior = globalThis.fetch;
    try {
        globalThis.fetch = async () => new Response(JSON.stringify([
            { lat: '-27.632061', lon: '-48.652295', display_name: 'Rua Geraldo Jansem, 580, Palhoça', address: { road: 'Rua Geraldo Jansem', house_number: '580' } },
            { lat: '-27.64', lon: '-48.68', display_name: 'Rua Veneza, 390, Palhoça', address: { road: 'Rua Veneza', house_number: '390' } },
        ]));
        const result = await buscarCoordenadas(pedido);
        assert.equal(result.display_name, 'Rua Veneza, 390, Palhoça');
        // Coordenadas sintéticas: este teste verifica seleção, não localização real.
        assert.equal(result.lat, -27.64);
        assert.equal(result.aproximado, false);
        globalThis.fetch = async () => new Response(JSON.stringify([
            { lat: '-27.632061', lon: '-48.652295', display_name: 'Rua Geraldo Jansem, 580, Palhoça' },
            { lat: '-27.64', lon: '-48.68', display_name: 'Rua Veneza, Palhoça' },
        ]));
        // Sem número no mapa: usa o trecho da rua correta (nunca a Geraldo Jansem) e marca como aproximado.
        const aproximado = await buscarCoordenadas(pedido);
        assert.equal(aproximado.display_name, 'Rua Veneza, Palhoça');
        assert.equal(aproximado.aproximado, true);
        globalThis.fetch = async () => new Response(JSON.stringify([
            { lat: '-27.632061', lon: '-48.652295', display_name: 'Rua Geraldo Jansem, 580, Palhoça' },
        ]));
        assert.equal(await buscarCoordenadas(pedido), null);
        globalThis.fetch = async () => new Response('', { status: 429 });
        assert.equal(await buscarCoordenadas(pedido), null);
        globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
        assert.equal(await buscarCoordenadas(pedido), null);
    } finally { globalThis.fetch = fetchAnterior; }
});
