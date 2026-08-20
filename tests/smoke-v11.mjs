// Drives the picker, template gallery, and a preset landing page.
import { chromium } from 'playwright';
const out = '/tmp/rosterowl-v11';
const errors = [];
const browser = await chromium.launch({ channel: 'chromium' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
const base = 'http://localhost:4321';

// Picker: pick 5 times, assert no repeats, check progress text
await page.goto(base + '/picker/', { waitUntil: 'networkidle' });
await page.waitForSelector('.big-pick', { timeout: 15000 });
const picked = [];
for (let i = 0; i < 5; i++) {
  await page.locator('.big-pick').click();
  await page.waitForTimeout(150);
  picked.push((await page.locator('.picked-name').textContent())?.trim());
}
const progressText = (await page.locator('.progress .lbl').textContent())?.trim();
const uniquePicks = new Set(picked).size;
await page.screenshot({ path: `${out}/01-picker.png` });

// Picker persistence: reload, history chips should survive
await page.waitForTimeout(700); // let the debounced save land
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.big-pick');
const historyAfterReload = await page.locator('.hchip').count();

// Template gallery: download a blank PDF
await page.goto(base + '/seating-chart/templates/', { waitUntil: 'networkidle' });
await page.waitForSelector('.card');
const cardCount = await page.locator('.card').count();
await page.screenshot({ path: `${out}/02-templates.png`, fullPage: true });
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 15000 }),
  page.locator('.card button').nth(6).click(), // a U-shape card
]);
const blankName = download.suggestedFilename();

// U-shape landing page with FRESH profile (preset must apply)
const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page2 = await ctx2.newPage();
page2.on('pageerror', (e) => errors.push('ushape: ' + String(e)));
await page2.goto(base + '/seating-chart/u-shape/', { waitUntil: 'networkidle' });
await page2.waitForSelector('[data-desk-id]', { timeout: 15000 });
const uDesks = await page2.locator('[data-desk-id]').count();
await page2.screenshot({ path: `${out}/03-ushape.png` });

console.log(JSON.stringify({
  picked, uniquePicks, progressText, historyAfterReload,
  templateCards: cardCount, blankPdfName: blankName,
  uShapeDeskCount: uDesks, // expect 26
  errors,
}, null, 2));
await browser.close();
