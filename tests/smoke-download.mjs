// Verifies the actual PDF download event fires with a sane filename (Chromium).
import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chromium' });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

const base = process.env.BASE_URL ?? 'http://localhost:4321';
await page.goto(base + '/seating-chart/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-desk-id]');
await page.getByRole('button', { name: /download pdf/i }).first().click();
await page.waitForSelector('object[type="application/pdf"], .err', { timeout: 20000 });
await page.waitForTimeout(800);
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 10000 }),
  page.locator('.dl').click(),
]);
const path = await download.path();
const { readFileSync } = await import('node:fs');
const head = readFileSync(path).subarray(0, 5).toString();
console.log(JSON.stringify({ filename: download.suggestedFilename(), pdfMagic: head, errors }, null, 2));
await browser.close();
