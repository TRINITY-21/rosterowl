import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chromium' });
const page = await (await browser.newContext({ viewport: { width: 1200, height: 630 } })).newPage();
await page.goto('file:///tmp/og-card.html');
await page.waitForTimeout(400);
await page.screenshot({ path: 'public/og.png' });
console.log('og.png written');
await browser.close();
