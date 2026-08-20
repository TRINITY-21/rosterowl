// Serves dist/ under the real generated dist/_headers and drives every route,
// failing on any Content-Security-Policy violation.
//
// This test exists because `astro preview` ignores _headers: without it, a CSP
// mistake is invisible locally and every tool on the live site breaks at once.
// Run: node tests/smoke-csp.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const dist = new URL('../dist/', import.meta.url).pathname;

/** Every published route, straight from the built sitemap — so a new page is
 *  covered the moment it ships, without this list being maintained. */
async function publishedRoutes() {
  const xml = await readFile(join(dist, 'sitemap-0.xml'), 'utf8');
  const routes = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
  assert.ok(routes.length > 10, `sitemap listed only ${routes.length} routes — did the build run?`);
  return routes;
}

/** The `/*` block from dist/_headers — the headers Cloudflare will really send. */
async function globalHeaders() {
  const text = await readFile(join(dist, '_headers'), 'utf8');
  const headers = {};
  let inGlobal = false;
  for (const line of text.split('\n')) {
    if (/^\S/.test(line)) {
      inGlobal = line.trim() === '/*';
      continue;
    }
    const match = inGlobal && line.match(/^\s+([\w-]+):\s*(.+)$/);
    if (match) headers[match[1]] = match[2];
  }
  assert.ok(headers['Content-Security-Policy'], '_headers has no CSP for /* — did the build run?');
  return headers;
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  // The pdf.js worker ships as .mjs; served as octet-stream a module script is
  // rejected on MIME type alone, which looks exactly like a CSP block.
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
};

const headers = await globalHeaders();

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let file = join(dist, normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''));
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
  } catch {
    file = join(dist, '404.html');
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { ...headers, 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, headers).end('not found');
  }
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const violations = [];
const browser = await chromium.launch({ channel: 'chromium' });
try {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  // The DOM event is authoritative; console text is kept for a usable message.
  await page.addInitScript(() => {
    globalThis.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      globalThis.__csp.push(`${e.effectiveDirective} blocked ${e.blockedURI} on ${location.pathname}`),
    );
  });

  // Plus a miss, so the 404 page is covered too.
  for (const route of [...(await publishedRoutes()), '/no-such-page/']) {
    await page.goto(base + route, { waitUntil: 'networkidle' });
    violations.push(...(await page.evaluate(() => globalThis.__csp)));
  }

  // The riskiest directives are the ones only the PDF path touches: the preview
  // embeds a blob: URL in <object>, and the island had to boot to get there.
  await page.goto(base + '/seating-chart/', { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-desk-id]', { timeout: 15000 });
  await page.getByRole('button', { name: /pdf|print|download/i }).first().click();
  await page.waitForSelector('.print-preview object, .print-preview .print-msg', { timeout: 20000 });
  violations.push(...(await page.evaluate(() => globalThis.__csp)));

  // And "Copy image", which is the only thing that starts the pdf.js worker —
  // the sole reason worker-src is in the policy at all.
  await page.goto(base + '/checklist/', { waitUntil: 'networkidle' });
  await page.waitForSelector('object[type="application/pdf"], .print-msg, .tool-empty', {
    timeout: 20000,
  });
  await page.locator('.share-menu > .btn').click();
  const copy = page.getByRole('menuitem', { name: /copy as image/i });
  if (await copy.count()) {
    await copy.click();
    await page.waitForSelector('.toast', { timeout: 30000 });
  }
  violations.push(...(await page.evaluate(() => globalThis.__csp)));
} finally {
  await browser.close();
  server.close();
}

if (violations.length) {
  console.error('CSP violations under the generated _headers:');
  for (const v of [...new Set(violations)]) console.error(`  - ${v}`);
  process.exit(1);
}
console.log('smoke-csp: no CSP violations across every route + the PDF path');
