import assert from 'node:assert/strict';
import test from 'node:test';
import { extrairComponentesEndereco, resultadoCorrespondeAoEndereco, buscarCoordenadas } from '../src/geoUtils.js';
const pedido = 'Cond. Positano Rua Veneza 390 passa vinte palhoça';
const leParque = 'R Najla Carone Guedert 821 Pagani - palhoça';

test('separa condomínio, rua e número no texto real do pedido', () => {
    const { rua, numero, cidade } = extrairComponentesEndereco(pedido);
    assert.equal(rua, 'Rua Veneza');
    assert.equal(numero, '390');
    assert.equal(cidade, 'Palhoça');
    const destino = extrairComponentesEndereco(leParque);
    assert.equal(destino.rua, 'Rua Najla Carone Goedert');
    assert.equal(destino.numero, '821');
    assert.equal(destino.bairro, 'Pagani');
    assert.equal(extrairComponentesEndereco('Rua 7 de Setembro, 821, Palhoça').rua, 'Rua 7 de Setembro');
    assert.equal(extrairComponentesEndereco('Rua 7, 821, Palhoça').rua, 'Rua 7');

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
        const ruaSemNumero = {
            lat: '-27.64',
            lon: '-48.68',
            display_name: 'Rua Najla Carone Goedert, Pagani, Palhoça',
            category: 'highway',
            address: { road: 'Rua Najla Carone Goedert', city: 'Palhoça' }
        };
        globalThis.fetch = async () => Response.json([ruaSemNumero]);
        assert.equal(await buscarCoordenadas(leParque), null);
        const referencia = await buscarCoordenadas(leParque, { incluirReferencia: true });
        assert.equal(referencia.display_name, ruaSemNumero.display_name);
        assert.equal(referencia.aproximado, true);

        const consultas = [];
        globalThis.fetch = async url => {
            consultas.push(url);
            if (url.searchParams.has('street')) {
                return Response.json([{
                    ...ruaSemNumero,
                    category: 'building',
                    display_name: '821, Rua Najla Carone Goedert, Palhoça',
                    address: { ...ruaSemNumero.address, house_number: '821' }
                }]);
            }
            return Response.json([
                ruaSemNumero,
                {
                    ...ruaSemNumero,
                    category: 'building',
                    display_name: '821, Rua Najla Carone Goedert, São José, Palhoça',
                    address: { ...ruaSemNumero.address, house_number: '821', city: 'São José' }
                }
            ]);
        };
        const imovel = await buscarCoordenadas(leParque);
        assert.equal(imovel.aproximado, false);
        assert.equal(imovel.display_name, '821, Rua Najla Carone Goedert, Palhoça');
        assert.equal(consultas.length, 3);
        assert.equal(consultas[2].searchParams.get('street'), '821 Rua Najla Carone Goedert');

        let requisicoes = 0;
        globalThis.fetch = async () => {
            requisicoes++;
            return new Response('', { status: 429 });
        };
        assert.equal(await buscarCoordenadas(pedido), null);
        assert.equal(requisicoes, 1);
    } finally {
        globalThis.fetch = fetchAnterior;
    }
});
