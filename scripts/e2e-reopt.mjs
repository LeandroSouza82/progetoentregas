import { chromium } from 'playwright';

(async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    page.on('dialog', async dialog => { try { await dialog.accept(); } catch (e) { } });
    try {
        await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });

        // Add a test delivery
        await page.click('text=Nova Carga');
        await page.fill('input[name="cliente"]', 'Teste Reopt');
        await page.fill('input[name="endereco"]', 'Rua Teste Reopt, 1');
        await page.click('button:has-text("ADICIONAR À LISTA")');
        await page.waitForTimeout(500);

        // Go to Central de Despacho
        await page.click('text=Central de Despacho');
        await page.waitForTimeout(300);

        // Click REORGANIZAR ROTA (header)
        await page.click('button:has-text("REORGANIZAR ROTA")');
        await page.waitForSelector('text=Escolha um motorista');

        // Click first 'REORGANIZAR ROTA' button in modal
        const reoptButtons = await page.$$('button:has-text("REORGANIZAR ROTA")');
        if (reoptButtons.length === 0) {
            console.log('ERRO: nenhum motorista online encontrado para reopt.');
            await browser.close();
            process.exit(2);
        }
        await reoptButtons[0].click();

        // wait for processing (give it some time)
        await page.waitForTimeout(1500);

        // Wait for KM to appear in the header
        try {
            await page.waitForSelector('text=KM', { timeout: 5000 });
        } catch (e) {
            console.log('ERRO: KM não apareceu na tela após reopt');
            await browser.close();
            process.exit(3);
        }

        // Read mock entregas from localStorage in page context
        const result = await page.evaluate(() => {
            try {
                const raw = localStorage.getItem('mock_entregas');
                const logsRaw = localStorage.getItem('mock_logs_roteirizacao');
                const entregas = raw ? JSON.parse(raw) : [];
                const logs = logsRaw ? JSON.parse(logsRaw) : [];
                const ordemNonZero = Array.isArray(entregas) ? entregas.some(e => e.ordem_logistica && Number(e.ordem_logistica) > 0) : false;
                return { ok: true, ordemNonZero, logsCount: Array.isArray(logs) ? logs.length : 0, logsPreview: logs.slice(-3) };
            } catch (e) {
                return { ok: false, reason: String(e) };
            }
        });

        console.log('RESULTADO REOPT:', JSON.stringify(result, null, 2));
        if (!result.ok) {
            console.log('TESTE E2E REOPT: FALHA lendo localStorage', result.reason);
            await browser.close();
            process.exit(4);
        }

        if (!result.ordemNonZero) {
            console.log('TESTE E2E REOPT: FALHA - ordem_logistica ainda zero para todos');
            await browser.close();
            process.exit(5);
        }

        if (!result.logsCount || result.logsCount === 0) {
            console.log('TESTE E2E REOPT: FALHA - nenhum log de roteirizacao encontrado');
            await browser.close();
            process.exit(6);
        }

        console.log('TESTE E2E REOPT: SUCESSO');
        await browser.close();
        process.exit(0);
    } catch (e) {
        console.error('Erro no script E2E REOPT:', e);
        try { await browser.close(); } catch (e) { }
        process.exit(7);
    }
})();