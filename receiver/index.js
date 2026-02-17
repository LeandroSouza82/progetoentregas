const express = require('express');
const app = express();
app.use(express.json());

app.post('/receive', (req, res) => {
    console.log('--- ROTA RECEBIDA ---');
    console.log(JSON.stringify(req.body, null, 2));
    console.log('---------------------');
    res.json({ ok: true, received: true });
});

app.get('/', (req, res) => res.send('Receiver running. POST to /receive'));

const port = process.env.PORT || 4000;
app.listen(port, '0.0.0.0', () => {
    console.log(`Receiver listening on http://0.0.0.0:${port}/receive`);
});
