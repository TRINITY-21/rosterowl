import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const out = '/tmp/rosterowl-attendance';
const base = process.env.BASE_URL ?? 'http://localhost:4321';
const errors = [];
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chromium' });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(base + '/attendance/', { waitUntil: 'networkidle' });
await page.waitForSelector('object[type="application/pdf"], .print-msg, .tool-empty', { timeout: 20000 });
await page.waitForTimeout(1200);

assert.ok(await page.locator('[data-sample-banner]').isVisible(), 'sample-class banner should be visible');

const now = new Date();
const monthValue = await page.getByLabel('Month').inputValue();
assert.equal(
  monthValue,
  `${now.getFullYear()}-${now.getMonth()}`,
  'month select should default to the current month'
);

await page.screenshot({ path: `${out}/01-attendance.png` });
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 20000 }),
  page.getByRole('button', { name: /download attendance/i }).click(),
]);
const { readFileSync } = await import('node:fs');
const buf = readFileSync(await download.path());
const { PDFDocument } = await import('pdf-lib');
const doc = await PDFDocument.load(new Uint8Array(buf));
assert.equal(buf.subarray(0, 5).toString(), '%PDF-', 'downloaded attendance sheet should be a PDF');
assert.equal(doc.getPageCount(), 1, 'attendance sheet should stay on one page');
assert.ok(
  download.suggestedFilename().includes('Attendance'),
  `filename should contain "Attendance": ${download.suggestedFilename()}`
);
assert.deepEqual(errors, [], `browser console/page errors: ${errors.join('\n')}`);
console.log(JSON.stringify({
  filename: download.suggestedFilename(),
  pages: doc.getPageCount(),
  month: monthValue,
  errors,
}, null, 2));
await browser.close();
