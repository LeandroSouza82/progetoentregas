import assert from 'node:assert/strict';
import test from 'node:test';
import { extrairComponentesEndereco, resultadoCorrespondeAoEndereco, buscarCoordenadas } from '../src/geoUtils.js';
const pedido = 'Cond. Positano Rua Veneza 390 passa vinte palhoça';

test('separa condomínio, rua e número no texto real do pedido', () => {
    const { rua, numero, cidade } = extrairComponentesEndereco(pedido);
    assert.equal(rua, 'Rua Veneza');
    assert.equal(numero, '390');
    assert.equal(cidade, 'Palhoça');
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
        globalThis.fetch = async () => new Response(JSON.stringify([
            { lat: '-27.632061', lon: '-48.652295', display_name: 'Rua Geraldo Jansem, 580, Palhoça' },
            { lat: '-27.64', lon: '-48.68', display_name: 'Rua Veneza, Palhoça' },
        ]));
        assert.equal(await buscarCoordenadas(pedido), null);
    } finally { globalThis.fetch = fetchAnterior; }
});
