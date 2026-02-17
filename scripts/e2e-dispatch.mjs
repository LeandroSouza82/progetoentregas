import { chromium } from 'playwright';

(async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    page.on('dialog', async dialog => { try { await dialog.accept(); } catch (e) { } });
    try {
        await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });

        // Click 'Nova Carga' tab
        await page.click('text=Nova Carga');
        await page.fill('input[name="cliente"]', 'Teste E2E');
        await page.fill('input[name="endereco"]', 'Rua Teste, 123');
        await page.click('button:has-text("ADICIONAR À LISTA")');
        // wait a bit for local update
        await page.waitForTimeout(500);

        // Go to Central de Despacho
        await page.click('text=Central de Despacho');
        await page.waitForTimeout(300);

        // Click ENVIAR ROTA (header)
        await page.click('button:has-text("ENVIAR ROTA")');
        await page.waitForSelector('text=Selecionar Motorista');

        // Click the first 'ENVIAR ROTA' button in modal
        const sendButtons = await page.$$('button:has-text("ENVIAR ROTA")');
        if (sendButtons.length === 0) {
            console.log('ERRO: nenhum motorista online encontrado para enviar rota.');
            await browser.close();
            process.exit(2);
        }
        await sendButtons[0].click();

        // wait for processing
        await page.waitForTimeout(1000);

        // Read mock entregas from localStorage in page context
        const result = await page.evaluate(() => {
            try {
                const raw = localStorage.getItem('mock_entregas');
                if (!raw) return { ok: false, reason: 'mock_entregas not found' };
                const arr = JSON.parse(raw);
                return { ok: true, count: arr.length, last: arr[arr.length - 1] };
            } catch (e) {
                return { ok: false, reason: String(e) };
            }
        });

        console.log('RESULTADO:', JSON.stringify(result, null, 2));
        if (result.ok) {
            const last = result.last;
            const motoristaIsNumber = typeof last.motorista_id === 'number';
            const statusIsCorrect = String(last.status).trim().toLowerCase() === 'em_rota';
            const hasDispatched = typeof last.dispatched_at === 'string' && !Number.isNaN(Date.parse(last.dispatched_at));
            console.log('motorista_id é number?', motoristaIsNumber);
            console.log("status === 'em_rota'?", statusIsCorrect);
            console.log('dispatched_at ISO?', hasDispatched, last.dispatched_at);
            if (motoristaIsNumber && statusIsCorrect && hasDispatched) {
                console.log('TESTE E2E: SUCESSO');
                await browser.close();
                process.exit(0);
            } else {
                console.log('TESTE E2E: FALHA - verifique dados acima');
                await browser.close();
                process.exit(3);
            }
        } else {
            console.log('TESTE E2E: NÃO FOI POSSÍVEL LER mock_entregas:', result.reason);
            await browser.close();
            process.exit(4);
        }
    } catch (e) {
        console.error('Erro no script E2E:', e);
        try { await browser.close(); } catch (e) { }
        process.exit(5);
    }
})();
