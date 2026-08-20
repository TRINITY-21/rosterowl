import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { downloadPath } from './download-path.mjs';

const out = '/tmp/rosterowl-bingo';
const base = process.env.BASE_URL ?? 'http://localhost:4321';
const errors = [];
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chromium' });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(base + '/bingo/', { waitUntil: 'networkidle' });
await page.waitForSelector('object[type="application/pdf"], .print-msg, .tool-empty', { timeout: 20000 });
await page.waitForTimeout(1200);

// Fresh profile → the 22-student sample class is active.
assert.ok((await page.locator('[data-sample-banner]').count()) > 0, 'sample class banner should be present');

// Size picker reflects pool limits: 21 classmates per card (own name excluded),
// so 5×5 (needs 24 with free center) is disabled while 4×4 (needs 16) is not.
const sizeSelect = page.getByLabel('Grid size');
// Playwright's isDisabled() ignores `disabled` on <option> (not in the HTML
// spec's "actually disabled" list) — read the DOM property instead.
const optDisabled = (v) => sizeSelect.locator(`option[value="${v}"]`).evaluate((el) => el.disabled);
assert.equal(await optDisabled(5), true, '5×5 should be unavailable for the 22-student sample');
assert.equal(await optDisabled(4), false, '4×4 should be available');

// Download the 4×4 names-mode set: 22 cards 1-up + caller's list = 23 pages.
await sizeSelect.selectOption('4');
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/01-bingo-names.png` });
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 20000 }),
  page.getByRole('button', { name: /download .*bingo cards/i }).click(),
]);
assert.ok(download.suggestedFilename().endsWith('.pdf'), 'download filename should end with .pdf');
const { readFileSync } = await import('node:fs');
const buf = readFileSync(await downloadPath(download));
const { PDFDocument } = await import('pdf-lib');
const doc = await PDFDocument.load(new Uint8Array(buf));
assert.equal(buf.subarray(0, 5).toString(), '%PDF-', 'downloaded bingo set should be a PDF');
assert.equal(doc.getPageCount(), 23, '22 cards 1-up + caller list should be 23 pages');

// Custom mode: type a few words and confirm they persist across a reload
// (the store saves on a 400ms debounce — wait it out before reloading).
await page.getByLabel('Card items').selectOption('custom');
const wordList = 'cat\ndog\nsun\nmoon\nstar\ntree\nfish\nbird\nfrog';
await page.getByLabel('Your word list').fill(wordList);
await page.waitForTimeout(700);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('object[type="application/pdf"], .print-msg, .tool-empty', { timeout: 20000 });
await page.getByLabel('Card items').selectOption('custom');
assert.equal(await page.getByLabel('Your word list').inputValue(), wordList, 'word list should persist across reloads');
await page.screenshot({ path: `${out}/02-bingo-custom.png` });

assert.deepEqual(errors, [], `browser console/page errors: ${errors.join('\n')}`);
console.log(JSON.stringify({
  filename: download.suggestedFilename(),
  pages: doc.getPageCount(),
  errors,
}, null, 2));
await browser.close();
