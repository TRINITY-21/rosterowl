import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { downloadPath } from './download-path.mjs';

const out = '/tmp/rosterowl-nametags';
const base = process.env.BASE_URL ?? 'http://localhost:4321';
const errors = [];
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chromium' });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(base + '/name-tags/', { waitUntil: 'networkidle' });
await page.waitForSelector('object[type="application/pdf"], .print-msg, .tool-empty', { timeout: 20000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/01-deskplates.png` });

await page.getByLabel('Style').selectOption('badge-8up');
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/02-badges.png` });
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 20000 }),
  page.getByRole('button', { name: /download .* name tags/i }).click(),
]);
const { readFileSync } = await import('node:fs');
const buf = readFileSync(await downloadPath(download));
const { PDFDocument } = await import('pdf-lib');
const doc = await PDFDocument.load(new Uint8Array(buf));
assert.equal(buf.subarray(0, 5).toString(), '%PDF-', 'downloaded name tags should be a PDF');
assert.equal(doc.getPageCount(), 3, '22 students at 8 per sheet should fill 3 pages');
assert.deepEqual(errors, [], `browser console/page errors: ${errors.join('\n')}`);
console.log(JSON.stringify({
  filename: download.suggestedFilename(),
  pages: doc.getPageCount(),
  errors,
}, null, 2));
await browser.close();
