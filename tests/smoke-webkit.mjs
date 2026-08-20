// Same core drive as smoke.mjs but in WebKit (Safari engine) — including a
// two-tab cross-storage check that Chromium smoke doesn't cover.
// KNOWN ARTIFACT: Playwright's WebKit build has no PDF plugin, so the inline
// PDF preview area renders blank here even though real desktop Safari shows
// it fine. Browsers that truly can't preview report pdfViewerEnabled=false
// and get the .nopreview fallback message instead. Download works everywhere.
import { webkit } from 'playwright';
const out = '/tmp/rosterowl-webkit';
const errors = [];
const browser = await webkit.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e)));

const base = 'http://localhost:4321';
await page.goto(base + '/seating-chart/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-desk-id]', { timeout: 15000 });
const deskCount = await page.locator('[data-desk-id]').count();
await page.screenshot({ path: `${out}/01-tool.png` });

// Shuffle + rule flow
await page.getByRole('button', { name: /shuffle/i }).click();
await page.waitForTimeout(400);
await page.locator('[data-desk-id]:not(.empty)').first().click();
await page.waitForSelector('.action-bar', { timeout: 5000 });
await page.getByRole('button', { name: /keep apart with/i }).click();
await page.locator('[data-desk-id]:not(.empty)').nth(4).click();
await page.waitForTimeout(300);

// Safari-specific: the storage warning card should be visible
const safariNotice = await page.locator('.safari').count();

// PDF generation (the pipeline that must not depend on @page/print CSS)
await page.getByRole('button', { name: /download pdf/i }).first().click();
await page.waitForSelector('object[type="application/pdf"], .err, .nopreview', { timeout: 20000 });
await page.waitForTimeout(1500);
const pdfError = await page.locator(".nopreview:visible").count();
await page.screenshot({ path: `${out}/02-pdf.png` });
await page.keyboard.press('Escape');

// Cross-tab: edit in tab2, then check tab1 adopted it before saving over it
const page2 = await ctx.newPage();
await page2.goto(base + '/seating-chart/', { waitUntil: 'networkidle' });
await page2.waitForSelector('[data-desk-id]');
await page2.locator('.class-name').fill('Renamed In Tab Two');
await page2.locator('.class-name').blur();
await page2.waitForTimeout(700); // let the debounced save land
await page.bringToFront();
await page.waitForTimeout(500);
const tab1Name = await page.locator('.class-name').inputValue();

// Group maker in webkit
await page.goto(base + '/group-maker/', { waitUntil: 'networkidle' });
await page.waitForSelector('.gcard', { timeout: 15000 });
const groups = await page.locator('.gcard').count();
await page.screenshot({ path: `${out}/03-groups.png` });

console.log(JSON.stringify({
  engine: 'webkit',
  deskCount,
  safariNoticeShown: safariNotice > 0,
  fallbackMessageShown: pdfError > 0,
  tab1SeesTab2Rename: tab1Name === 'Renamed In Tab Two',
  groups,
  errors,
}, null, 2));
await browser.close();
