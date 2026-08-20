// Proves the offline claim rather than assuming it: build a chart PDF online,
// install the service worker, cut the network, then build the same PDF again and
// check the two match.
//
// The PDF step is the point. Precaching the HTML and JS is easy to get right and
// makes the site *look* like it works offline; the tools only actually work if
// the TTFs embedded into every PDF were precached too, and that failure is
// invisible until a teacher with no signal presses Download. Comparing against
// the online build catches it — a PDF whose fonts failed to load is a very
// different size from one whose fonts didn't. (The document's own structure is
// inside compressed object streams, so there is nothing to grep for.)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { downloadPath } from './download-path.mjs';

const base = process.env.BASE_URL ?? 'http://localhost:4321';

/** Opens the seating chart's PDF dialog and returns the downloaded bytes. */
async function downloadChart(page) {
  await page.waitForSelector('[data-desk-id]', { timeout: 20000 });
  await page.getByRole('button', { name: /pdf|print|download/i }).first().click();

  const button = page
    .getByLabel('Download seating chart PDF')
    .getByRole('button', { name: /^download pdf$/i });
  await button.waitFor({ state: 'visible', timeout: 30000 });
  // Disabled until the preview finishes — offline that is the same render path
  // the download itself uses, so waiting here is waiting for the real work.
  try {
    await button.and(page.locator(':not([disabled])')).waitFor({ timeout: 30000 });
  } catch (e) {
    // The dialog puts the real reason on screen; a bare timeout would send the
    // next person hunting through Playwright instead of reading it.
    const shown = await page.locator('.print-msg.err').allTextContents();
    throw new Error(
      `PDF never became downloadable. On-screen error: ${shown.join(' | ') || '(none)'}`,
      { cause: e },
    );
  }

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    button.click(),
  ]);
  return new Uint8Array(readFileSync(await downloadPath(download)));
}

const browser = await chromium.launch({ channel: 'chromium' });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

// 1. Online: the reference PDF, and the visit that installs the worker.
await page.goto(`${base}/seating-chart/`, { waitUntil: 'networkidle' });
await page.evaluate(() => navigator.serviceWorker.ready);
const online = await downloadChart(page);

// 2. registerType is 'prompt', so there is no clientsClaim — the worker takes
//    control on the next navigation rather than this one.
await page.goto(`${base}/seating-chart/`, { waitUntil: 'networkidle' });
assert.ok(
  await page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
  'service worker should control the page after a reload',
);
// Let the precache finish before pulling the plug.
await page.waitForTimeout(3000);

// 3. Drop the HTTP cache, keeping Cache Storage and the worker registration.
//    Without this the test proves nothing about the precache: loadPdfFonts uses
//    fetch(..., { cache: 'force-cache' }), so the fonts fetched during the
//    online download above would be served offline from the ordinary HTTP cache
//    whether or not the service worker had ever heard of them. A teacher opening
//    the site cold on a school iPad has no such cache — this models that.
const cdp = await context.newCDPSession(page);
await cdp.send('Network.clearBrowserCache');

// 4. Cut the network.
await context.setOffline(true);

await page.goto(`${base}/seating-chart/`, { waitUntil: 'domcontentloaded' });
const offline = await downloadChart(page);

// Not exact equality: the two builds differ by a couple of bytes because the PDF
// carries its own creation timestamp. A missing font costs tens of kilobytes, so
// a small tolerance still catches the failure this test exists for.
const drift = Math.abs(offline.byteLength - online.byteLength);
assert.ok(
  drift < 512,
  `offline PDF differs from the online one by ${drift} bytes ` +
    `(${offline.byteLength} vs ${online.byteLength}) — most likely the embedded ` +
    'fonts were not served from cache',
);

// 5. A page never visited online should also work, because it was precached.
await page.goto(`${base}/bingo/`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.tool-frame', { timeout: 20000 });

// 6. And an unknown route falls back to the 404 page rather than the dinosaur.
await page.goto(`${base}/no-such-page/`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('main', { timeout: 20000 });

await context.setOffline(false);
// --- the service worker must not swallow /api/* navigations -----------------
//
// navigateFallback answers every navigation the worker has no route for with
// the 404 page. Signing in is a navigation (location.href to
// /api/auth/google/start, and Google navigating back to the callback), so a
// missing denylist entry silently replaces the whole OAuth flow with
// "Hoo? That page flew off." Nothing that skips service workers — curl, a
// plain fetch, every other smoke test — can see it.
//
// The assertion is deliberately about the *worker*, not the API: this suite
// runs against `astro preview`, which serves only static files and has no
// /api/, so a real 404 from the server is the correct outcome here. What must
// never happen is a 200 carrying the precached 404 page, which is what the
// worker returns when it has hijacked the navigation.
{
  // /api/ is the one that broke sign-in; the file paths are the general case —
  // a sitemap or robots.txt swallowed by the worker is invisible until someone
  // opens it and sees the 404 page.
  for (const path of ['/api/me', '/sitemap-index.xml', '/robots.txt']) {
    const probe = await context.newPage();
    const response = await probe.goto(base + path, { waitUntil: 'domcontentloaded' });
    const status = response?.status() ?? 0;
    const body = await probe.evaluate(() => document.body.innerText);
    assert.ok(
      !(status === 200 && /page flew off/i.test(body)),
      `the service worker answered ${path} with the cached 404 page (status ${status}) — ` +
        'check navigateFallbackDenylist in astro.config.mjs',
    );
    await probe.close();
  }
}

await browser.close();

console.log(`smoke-offline: rebuilt an identical ${offline.byteLength}-byte PDF with the network off`);
