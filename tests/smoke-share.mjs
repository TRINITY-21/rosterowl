// Drives the "Copy image" path end to end: build a real PDF, render page 1 with
// pdf.js, and put a PNG on the clipboard.
//
// Worth its own driver because none of the other smoke tests touch pdf.js. It is
// lazily imported, runs in a worker, and is the one piece of the share row that
// can fail silently — a clipboard write that quietly does nothing looks exactly
// like a clipboard write that worked.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.BASE_URL ?? 'http://localhost:4321';
const errors = [];

const browser = await chromium.launch({ channel: 'chromium' });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.grantPermissions(['clipboard-read', 'clipboard-write']);
const page = await context.newPage();
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(`${base}/checklist/`, { waitUntil: 'networkidle' });
await page.waitForSelector('object[type="application/pdf"], .print-msg, .tool-empty', {
  timeout: 20000,
});

// The actions live behind the Share menu; open it first.
await page.locator('.share-menu > .btn').click();
const copyItem = page.getByRole('menuitem', { name: /copy as image/i });
assert.equal(await copyItem.count(), 1, 'Copy as image should be offered in Chromium');

await copyItem.click();
// pdf.js has to be fetched, start a worker, and rasterise — allow for all three.
await page.waitForSelector('.toast', { timeout: 30000 });
const toast = (await page.locator('.toast .msg').first().textContent()) ?? '';
assert.match(toast, /copied/i, `expected a success toast, got: ${toast}`);

// Read it back: a PNG on the clipboard, big enough to be a real page render.
const image = await page.evaluate(async () => {
  const items = await navigator.clipboard.read();
  const type = items[0]?.types.find((t) => t.startsWith('image/'));
  if (!type) return null;
  const bitmap = await createImageBitmap(await items[0].getType(type));
  return { type, width: bitmap.width, height: bitmap.height };
});

assert.ok(image, 'clipboard should hold an image');
assert.equal(image.type, 'image/png');
assert.ok(image.width >= 1000, `image too small to be a rendered page: ${image.width}px wide`);
assert.ok(image.height > image.width * 0.5, `unexpected aspect ratio: ${image.width}x${image.height}`);

// "Share…" is offered exactly when the platform can take a file, and hidden
// otherwise — never shown-but-broken. Not clicked: it would open a real OS share
// sheet that nothing in a headless run can dismiss.
const canShare = await page.evaluate(() => {
  const file = new File([new Uint8Array([1])], 'x.pdf', { type: 'application/pdf' });
  return Boolean(navigator.canShare?.({ files: [file] }) && navigator.share);
});
await page.locator('.share-menu > .btn').click();
// Each item's accessible name is its title plus its description line, so this
// matches on the title only rather than anchoring the whole string.
assert.equal(
  await page.getByRole('menuitem', { name: /share…/i }).count(),
  canShare ? 1 : 0,
  `"Share…" visibility should match navigator.canShare (${canShare})`,
);

await browser.close();

assert.deepEqual(errors, [], `console errors: ${errors.join('\n')}`);
console.log(`smoke-share: copied a ${image.width}x${image.height} PNG to the clipboard`);
