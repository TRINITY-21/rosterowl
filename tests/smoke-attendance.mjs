import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { downloadPath } from './download-path.mjs';

const out = '/tmp/rosterowl-attendance';
const base = process.env.BASE_URL ?? 'http://localhost:4321';
const errors = [];
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chromium' });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
// A fixed school day (Wednesday 21 October 2026) so "today", the month menu
// and the absent-today link behave the same on every run, weekends included.
await page.clock.setFixedTime(new Date(2026, 9, 21, 10, 0));

async function waitForPreview() {
  await page.waitForSelector('object[type="application/pdf"], .print-msg, .tool-empty', { timeout: 20000 });
  await page.waitForTimeout(1200);
}

async function downloadSheet() {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.getByRole('button', { name: /download attendance/i }).click(),
  ]);
  return { download, buf: await readFile(await downloadPath(download)) };
}

async function pdfText(buf) {
  const task = getDocument({ data: new Uint8Array(buf), disableFontFace: true });
  const pdf = await task.promise;
  const items = (await (await pdf.getPage(1)).getTextContent()).items.map((i) => i.str);
  await task.destroy();
  return items;
}

await page.goto(base + '/attendance/', { waitUntil: 'networkidle' });
await waitForPreview();

assert.ok(await page.locator('[data-sample-banner]').isVisible(), 'sample-class banner should be visible');

const monthValue = await page.getByLabel('Month').inputValue();
assert.equal(monthValue, '2026-9', 'month select should default to the current month');

await page.screenshot({ path: `${out}/01-attendance.png` });
const first = await downloadSheet();
const { PDFDocument } = await import('pdf-lib');
const doc = await PDFDocument.load(new Uint8Array(first.buf));
assert.equal(first.buf.subarray(0, 5).toString(), '%PDF-', 'downloaded attendance sheet should be a PDF');
assert.equal(doc.getPageCount(), 1, 'attendance sheet should stay on one page');
assert.ok(
  first.download.suggestedFilename().includes('Attendance'),
  `filename should contain "Attendance": ${first.download.suggestedFilename()}`
);

// ---- Take attendance: Grace absent, Mateo late, everyone else present ----
const rows = page.locator('.att-row');
assert.equal(await rows.count(), 22, 'one row per sample student');
assert.match(await rows.nth(0).getAttribute('aria-label'), /^Adeyemi, Grace: Present\. Tap to change\.$/);
await rows.nth(0).click();
await rows.nth(1).click();
await rows.nth(1).click();
const tally = page.locator('.att-tally');
await assert.doesNotReject(
  tally.filter({ hasText: '20 present · 1 absent · 1 late' }).waitFor({ timeout: 5000 }),
  'tally should count the marks'
);
assert.match(await rows.nth(1).getAttribute('aria-label'), /^Alvarez, Mateo: Late\./);

await waitForPreview();
await page.screenshot({ path: `${out}/02-marked.png` });
const marked = await pdfText((await downloadSheet()).buf);
assert.equal(marked.filter((s) => s === 'A').length, 1, 'one absent mark on the sheet');
assert.equal(marked.filter((s) => s === 'L').length, 1, 'one late mark on the sheet');
assert.ok(marked.includes('Taken on 1 of 22 school days'), 'taken-days line on the sheet');

// Marks are saved: a reload shows the same day.
await page.reload({ waitUntil: 'networkidle' });
await waitForPreview();
assert.equal((await page.locator('.att-tally').textContent()).trim(), '20 present · 1 absent · 1 late');

// Marking today also tells the other tools: the picker skips Grace.
await page.goto(base + '/picker/', { waitUntil: 'networkidle' });
await page.getByText('1 absent skipped').waitFor({ timeout: 10000 });

// ---- A tab left open overnight must not file Thursday's taps under Wednesday ----
await page.goto(base + '/attendance/', { waitUntil: 'networkidle' });
await page.waitForSelector('.att-row');
await page.clock.setFixedTime(new Date(2026, 9, 22, 8, 5)); // Thursday morning, no page events
await page.locator('.att-row').nth(0).click(); // a tap on the stale "Wed · Today" panel
await page.locator('.att-date').filter({ hasText: /22/ }).waitFor({ timeout: 5000 });
assert.match(await page.locator('.att-date').textContent(), /22.*Today/, 'the panel moves to the new day');
assert.equal(
  await page.locator('.att-tally').count(),
  0,
  'Thursday is untaken: the stale tap must not have written anywhere'
);
await page.getByRole('button', { name: 'Previous school day' }).click();
assert.equal(
  (await page.locator('.att-tally').textContent()).trim(),
  '20 present · 1 absent · 1 late',
  "Wednesday's marks are untouched"
);
await page.getByRole('button', { name: 'Next school day' }).click();
// Waking the tab (visibility) also refreshes the day, without any tap.
await page.clock.setFixedTime(new Date(2026, 9, 23, 8, 0)); // Friday
await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
await page.locator('.att-date').filter({ hasText: /23/ }).waitFor({ timeout: 5000 });

// ---- Removing a student by mistake and pressing Undo keeps their attendance ----
await page.goto(base + '/seating-chart/', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Remove Grace' }).click({ force: true });
await page.getByRole('button', { name: 'Undo' }).click();
await page.goto(base + '/attendance/', { waitUntil: 'networkidle' });
await page.waitForSelector('.att-row');
await page.getByRole('button', { name: 'Previous school day' }).click(); // Thu 22
await page.getByRole('button', { name: 'Previous school day' }).click(); // Wed 21
assert.match(
  await page.locator('.att-row').nth(0).getAttribute('aria-label'),
  /^Adeyemi, Grace: Absent\./,
  "Undo brings Grace back with Wednesday's absence"
);
assert.equal((await page.locator('.att-tally').textContent()).trim(), '20 present · 1 absent · 1 late');

assert.deepEqual(errors, [], `browser console/page errors: ${errors.join('\n')}`);
console.log(JSON.stringify({
  filename: first.download.suggestedFilename(),
  pages: doc.getPageCount(),
  month: monthValue,
  marks: { A: 1, L: 1 },
  errors,
}, null, 2));
await browser.close();
