import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { downloadPath } from './download-path.mjs';

const out = '/tmp/rosterowl-jobs';
const base = process.env.BASE_URL ?? 'http://localhost:4321';
const errors = [];
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chromium' });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(base + '/jobs-chart/', { waitUntil: 'networkidle' });
await page.waitForSelector('object[type="application/pdf"], .print-msg, .tool-empty', { timeout: 20000 });
await page.waitForTimeout(1200);

// The sample class ships with 8 jobs, all assigned.
const rowSelects = page.locator('.job-row select');
assert.equal(await page.locator('.job-row').count(), 8, 'sample class should show 8 job rows');
const before = await rowSelects.evaluateAll((els) => els.map((el) => el.value));
assert.ok(before.every((v) => v.length > 0), 'every sample job should have an assigned student');

// Rotate: every job changes hands, so assignments must differ.
await page.getByRole('button', { name: /^rotate jobs$/i }).click();
await page.waitForTimeout(600);
const after = await rowSelects.evaluateAll((els) => els.map((el) => el.value));
const rotated = after.some((v, i) => v !== before[i]);
assert.ok(rotated, 'rotate should change at least one assignment');

await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/01-jobs-chart.png` });
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 20000 }),
  page.getByRole('button', { name: /download jobs chart/i }).click(),
]);
const { readFileSync } = await import('node:fs');
const buf = readFileSync(await downloadPath(download));
const { PDFDocument } = await import('pdf-lib');
const doc = await PDFDocument.load(new Uint8Array(buf));
assert.ok(download.suggestedFilename().endsWith('.pdf'), 'download should be a .pdf file');
assert.equal(buf.subarray(0, 5).toString(), '%PDF-', 'downloaded jobs chart should be a PDF');
assert.equal(doc.getPageCount(), 1, 'jobs chart should stay on one page');
assert.deepEqual(errors, [], `browser console/page errors: ${errors.join('\n')}`);
console.log(JSON.stringify({
  filename: download.suggestedFilename(),
  pages: doc.getPageCount(),
  rotated,
  errors,
}, null, 2));
await browser.close();
