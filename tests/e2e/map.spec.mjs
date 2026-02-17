import { test, expect } from '@playwright/test';

// Note: runs against dev server at http://localhost:5177/
const BASE = process.env.BASE_URL || 'http://localhost:5177/';

test.describe('MapaLogistica E2E', () => {
    test('shows driver Leandro and ignores out-of-SC deliveries', async ({ page }) => {
        // Seed motorista in localStorage before the app loads
        await page.addInitScript(() => {
            const motorista = {
                id: '00c21342-0000-0000-0000-000000000000',
                nome: 'Leandro',
                esta_online: true,
                lat: -27.6607,
                lng: -48.7086,
                foto: ''
            };
            try { localStorage.setItem('motorista', JSON.stringify(motorista)); } catch (e) { }
            // Seed a delivery outside SC (São Paulo) - should be ignored by map
            const mock = [{ id: 9999, cliente: 'SP Cliente', endereco: 'Av Paulista', lat: -23.55052, lng: -46.633308, status: 'Em Rota' }];
            try { localStorage.setItem('mock_entregas', JSON.stringify(mock)); } catch (e) { }
        });

        await page.goto(BASE);
        await page.waitForSelector('text=Mapa da Rota');

        // Ensure the driver name is visible somewhere on the page (side panel or marker tooltip)
        const foundDriver = await page.locator('text=Leandro').first();
        expect(await foundDriver.count()).toBeGreaterThan(0);

        // The SP delivery should NOT show up on the map (or markers list visually)
        const spDelivery = await page.locator('text=SP Cliente');
        expect(await spDelivery.count()).toBe(0);
    });
});
