import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const messages = [];

  page.on('console', msg => {
    messages.push({ type: 'console.' + msg.type(), text: msg.text() });
  });
  page.on('pageerror', err => {
    messages.push({ type: 'pageerror', text: String(err) });
  });

  try {
    // Use file URL to load built dist files directly (avoids running a dev server)
    const path = new URL('../dist/index.html', import.meta.url).href;
    await page.goto(path, { waitUntil: 'networkidle' });
    // wait a bit for client-side logs
    await page.waitForTimeout(1500);

    // print relevant messages
    const relevant = messages.filter(m => /supabase|Supabase|Invalid supabaseUrl|Invalid/.test(m.text));
    console.log('captured messages count:', messages.length);
    for (const m of relevant) {
      console.log(m.type + ':', m.text);
    }

    if (relevant.length === 0) {
      console.log('No Supabase-related errors or warnings found in console.');
    }
  } catch (e) {
    console.error('Error during page visit:', e);
  } finally {
    await browser.close();
  }
})();