const url = process.env.URL || 'http://127.0.0.1:4000/receive';
const payload = {
    title: 'Rota de teste',
    driver: 'Carlos Oliveira',
    pedido: {
        id: 'teste-123',
        endereco: 'Rua Exemplo, 123',
        lat: -23.55052,
        lng: -46.633308
    },
    timestamp: new Date().toISOString()
};

console.log('Enviando POST para', url);

const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
});

console.log('Status:', res.status);
const text = await res.text();
console.log('Resposta do receptor:', text);
