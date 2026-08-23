// Browser smoke drive: loads every page, exercises the core seating flow,
// and saves screenshots. Run: node tests/smoke.mjs [outDir]
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const out = process.argv[2] ?? '/tmp/rosterowl-shots';
const base = process.env.BASE_URL ?? 'http://localhost:4321';
const errors = [];
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ channel: 'chromium' });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));

// Home
await page.goto(base + '/', { waitUntil: 'networkidle' });
await page.screenshot({ path: `${out}/01-home.png`, fullPage: true });

// Privacy
await page.goto(base + '/privacy/', { waitUntil: 'networkidle' });
await page.screenshot({ path: `${out}/02-privacy.png` });

// Tool: sample class should render desks with names
await page.goto(base + '/seating-chart/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-desk-id]', { timeout: 15000 });
const deskCount = await page.locator('[data-desk-id]').count();
await page.screenshot({ path: `${out}/03-tool.png` });

// Shuffle
await page.getByRole('button', { name: /shuffle/i }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/04-shuffled.png` });

// Select a seated desk -> action bar appears
await page.locator('[data-desk-id]:not(.empty)').first().click();
await page.waitForSelector('.action-bar', { timeout: 5000 });
await page.screenshot({ path: `${out}/05-actionbar.png` });

// Keep-apart picking flow
await page.getByRole('button', { name: /keep apart with/i }).click();
await page.waitForSelector('.pick-banner');
const desks = page.locator('[data-desk-id]:not(.empty)');
await desks.nth(3).click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/06-rule-added.png` });

// Arrange mode
await page.getByRole('button', { name: 'Arrange room' }).click();
await page.waitForTimeout(200);
await page.screenshot({ path: `${out}/07-arrange.png` });

// Add a table of 4
await page.getByRole('button', { name: 'table of 4', exact: true }).click();
await page.waitForTimeout(200);
const deskCount2 = await page.locator('[data-desk-id]').count();

// Back to seat mode, open paste modal via sample banner
await page.getByRole('button', { name: 'Seat students' }).click();
await page.getByRole('button', { name: /use my class list/i }).click();
await page.waitForSelector('textarea');
await page.locator('textarea').fill('Rivera, Sofia\nRivera, Marco\nO’NEILL, PATRICK\n3. Jamie Lee jamie.lee@school.org\nWatson, Mary Jane');
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/08-paste.png` });
await page.locator('input[placeholder*="Period 3"]').fill('Period 2 — Science');
await page.getByRole('button', { name: /create class/i }).click();
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/09-new-class.png` });

// PDF dialog with live preview
await page.getByRole('button', { name: /download pdf/i }).first().click();
await page.waitForSelector('object[type="application/pdf"]', { timeout: 20000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/10-pdf-dialog.png` });

// Dark mode
await page.keyboard.press('Escape');
await page.locator('.menu summary').click();
await page.locator('.theme select').selectOption('dark');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/11-dark.png` });

// Reload: state should persist (Period 2 still active, dark theme applied)
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('[data-desk-id]', { timeout: 15000 });
const activeClass = await page.locator('select[aria-label="Switch class"]').inputValue().then(async (v) => {
  return page.locator(`select[aria-label="Switch class"] option[value="${v}"]`).textContent();
});
await page.screenshot({ path: `${out}/12-reloaded.png` });

assert.ok(deskCount > 0, 'sample seating chart should render desks');
assert.equal(deskCount2, deskCount + 4, 'adding a table of four should add four desks');
assert.match(activeClass?.trim() ?? '', /Period 2 — Science/, 'active class should persist after reload');
assert.deepEqual(errors, [], `browser console/page errors: ${errors.join('\n')}`);
assert.equal(
  await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth),
  false,
  'desktop seating page should not overflow horizontally'
);

const mobile = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
await mobile.goto(base + '/', { waitUntil: 'networkidle' });
assert.equal(
  await mobile.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth),
  false,
  'mobile home page should not overflow horizontally'
);
await mobile.goto(base + '/seating-chart/', { waitUntil: 'networkidle' });
await mobile.waitForSelector('[data-desk-id]', { timeout: 15000 });
assert.equal(
  await mobile.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth),
  false,
  'mobile seating page should not overflow horizontally'
);

// A single width cannot catch a narrow overflow band. The header's controls sit
// on a knife edge — brand, tools menu, sign-in pill and theme toggle in one row
// — and a breakpoint set a few pixels off leaves a range of real phones
// scrolling sideways while 320 and 390 both pass. So sweep: common device
// widths, plus one pixel either side of every breakpoint the header defines.
const phoneCtx = await browser.newContext({ viewport: { width: 320, height: 568 } });
const phone = await phoneCtx.newPage();
const overflowed = [];
for (const width of [320, 344, 359, 360, 361, 368, 375, 376, 390, 393, 412, 414, 430, 619, 620, 621, 768]) {
  await phone.setViewportSize({ width, height: 568 });
  await phone.goto(base + '/', { waitUntil: 'networkidle' });
  const over = await phone.evaluate(() => ({
    over: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    needs: document.documentElement.scrollWidth,
  }));
  if (over.over) overflowed.push(`${width}px (needs ${over.needs}px)`);
}
assert.deepEqual(
  overflowed,
  [],
  `home page overflows horizontally at: ${overflowed.join(', ')} — check the header breakpoints in Layout.astro`
);
await phone.goto(base + '/seating-chart/', { waitUntil: 'networkidle' });
await phone.waitForSelector('[data-desk-id]', { timeout: 15000 });
assert.equal(
  await phone.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth),
  false,
  '320px seating page should not overflow horizontally'
);

console.log(JSON.stringify({ deskCount, deskCountAfterAdd: deskCount2, activeClassAfterReload: activeClass?.trim(), consoleErrors: errors }, null, 2));
await browser.close();
