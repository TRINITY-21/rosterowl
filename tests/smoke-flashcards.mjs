import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const out = '/tmp/rosterowl-flashcards';
const base = process.env.BASE_URL ?? 'http://localhost:4321';
const errors = [];
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chromium' });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(base + '/flashcards/', { waitUntil: 'networkidle' });
await page.waitForSelector('object[type="application/pdf"], .print-msg, .tool-empty', { timeout: 20000 });
await page.waitForTimeout(1200);

// The count line is the last .print-note in the options column.
const note = page.locator('.print-note').last();
async function waitForNote(re, msg) {
  for (let i = 0; i < 60; i++) {
    const text = (await note.innerText()).replace(/\s+/g, ' ');
    if (re.test(text)) return text;
    await page.waitForTimeout(250);
  }
  assert.fail(`${msg} — count line never matched ${re}`);
}

// Sample class (22 students) should be in the preview state: names mode by
// default, count line showing all 22 cards.
await waitForNote(/22 cards/, 'sample class names should feed the preview');
await page.screenshot({ path: `${out}/01-names-jumbo.png` });

// Pick the 4-per-page classic size: 22 cards -> 6 pages.
await page.getByLabel('Card size').selectOption('large');
await waitForNote(/22 cards.*6 pages/, '22 cards at 4-up should fill 6 pages');
await page.screenshot({ path: `${out}/02-names-4up.png` });

const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 20000 }),
  page.getByRole('button', { name: /download 22 cards/i }).click(),
]);
const { readFileSync } = await import('node:fs');
const buf = readFileSync(await download.path());
const { PDFDocument } = await import('pdf-lib');
const doc = await PDFDocument.load(new Uint8Array(buf));
assert.equal(buf.subarray(0, 5).toString(), '%PDF-', 'downloaded flashcards should be a PDF');
assert.equal(doc.getPageCount(), 6, '22 cards at 4 per page should fill 6 pages');
assert.match(download.suggestedFilename(), /\.pdf$/, 'download should be named *.pdf');

// Switch to a custom word list and type words: the count line must update,
// blank lines ignored, the duplicate kept (5 cards).
await page.getByLabel('Cards from').selectOption('custom');
await page.getByLabel('Your word list (one card per line)').fill('cat\ndog\nsun\n\ncat\nmoon');
await waitForNote(/5 cards/, 'custom word list should update the count line');
await page.screenshot({ path: `${out}/03-custom-words.png` });

assert.deepEqual(errors, [], `browser console/page errors: ${errors.join('\n')}`);
console.log(JSON.stringify({
  filename: download.suggestedFilename(),
  pages: doc.getPageCount(),
  errors,
}, null, 2));
await browser.close();
