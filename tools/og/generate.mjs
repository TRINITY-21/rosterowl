// Renders one social card per indexable route into public/og/.
//
//   npm run og              all routes
//   npm run og -- /picker/  just one
//
// Requires a build first: the card art is the landing page's own sheet stack,
// screenshotted from dist/ rather than reimplemented here. That is the whole
// design decision — a hand-copied version of the hero would drift the first time
// someone nudged the real one, and the drift would only ever be visible in a
// Facebook link preview, which is the last place anyone looks.
//
// The route list comes from OG_ROUTES in src/lib/seo.ts, itself derived from the
// tool registry — so adding a tool to tools.ts is still the only edit needed, and
// the card a <meta> tag points at is the card that gets rendered.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_TOOLS, PRINTABLES, SEATING, SEATING_VARIANTS, TOOL_GROUPS } from '../../src/lib/tools.ts';
import { OG_ROUTES, ogSlug } from '../../src/lib/seo.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dist = join(root, 'dist');
const outDir = join(root, 'public', 'og');

if (!existsSync(join(dist, 'index.html'))) {
  console.error('No dist/ — run `npm run build` first; the card art comes from the built site.');
  process.exit(1);
}

const C = {
  paper: '#faf7f0',
  ink: '#243230',
  muted: '#5c6b66',
  brand: '#2e6b4f',
  accent: '#e8a03c',
  line: '#ddd6c7',
  surface: '#ffffff',
};

// setContent() leaves the page on an about:blank origin, from which Chromium
// refuses to fetch file:// fonts — and a silent fallback to Times is exactly the
// kind of thing you only notice once the card is public.
const fontUrl = (f) =>
  `data:font/woff2;base64,${readFileSync(join(root, 'public', 'fonts', f)).toString('base64')}`;

/** What each route says. Home gets the suite pitch; everything else its tool. */
function contentFor(route) {
  if (route === '/') {
    return {
      eyebrow: '',
      headline: 'One roster.\nEvery classroom tool.',
      sub: 'Seating charts, groups & fair picking — free, no signup, nothing uploaded unless you turn on sync.',
    };
  }
  const variant = SEATING_VARIANTS.find((v) => v.href === route);
  if (variant) return { eyebrow: 'Seating chart maker', headline: variant.label, sub: SEATING.copy };

  if (route === PRINTABLES.href) {
    return {
      eyebrow: 'Free printables',
      headline: 'Blank printables',
      sub: 'Ready-to-print blanks — attendance, checklists, name plates, jobs, bingo. No signup, no watermark.',
    };
  }
  const tool = ALL_TOOLS.find((t) => t.href === route);
  if (!tool) throw new Error(`No card content for ${route}`);
  // The group label, not "RosterOwl" — the lockup above already says that.
  const group = TOOL_GROUPS.find((g) => g.tools.includes(tool));
  return { eyebrow: group?.label ?? '', headline: tool.title, sub: tool.copy };
}

const OWL = `<svg viewBox="0 0 64 64" width="56" height="56">
  <path d="M14 30c0-9.9 8.1-18 18-18s18 8.1 18 18v9c0 8.3-6.7 15-15 15h-6c-8.3 0-15-6.7-15-15v-9Z" fill="${C.accent}"/>
  <path d="M17 17 L25 13.5 L22.4 21.5 Z" fill="${C.accent}"/><path d="M47 17 L39 13.5 L41.6 21.5 Z" fill="${C.accent}"/>
  <circle cx="24.5" cy="30" r="7.6" fill="#fdfcf8"/><circle cx="39.5" cy="30" r="7.6" fill="#fdfcf8"/>
  <circle cx="24.5" cy="30" r="3.2" fill="${C.ink}"/><circle cx="39.5" cy="30" r="3.2" fill="${C.ink}"/>
  <path d="M32 36.5 L28.9 41.5 L35.1 41.5 Z" fill="#c9822a"/></svg>`;

function card(route, art) {
  const { eyebrow, headline, sub } = contentFor(route);

  return `<!doctype html><meta charset="utf-8">
<style>
  @font-face { font-family: Baloo; src: url('${fontUrl('Baloo2-Variable.woff2')}'); font-weight: 400 800; }
  @font-face { font-family: Atkinson; src: url('${fontUrl('AtkinsonHyperlegible-Regular.woff2')}'); font-weight: 400; }
  @font-face { font-family: Atkinson; src: url('${fontUrl('AtkinsonHyperlegible-Bold.woff2')}'); font-weight: 700; }
  * { margin: 0; box-sizing: border-box; }
  body { position: relative; width: 1200px; height: 630px; background: ${C.paper};
         font-family: Atkinson, sans-serif; overflow: hidden; }

  /* The landing page's ruled notebook paper, same recipe as index.astro. */
  body::before {
    content: ''; position: absolute; inset: 0; z-index: 0;
    background-image: repeating-linear-gradient(to bottom, transparent 0 38px,
      color-mix(in srgb, ${C.brand} 14%, transparent) 38px 39px);
    -webkit-mask-image: linear-gradient(to bottom, #000 10%, transparent 92%);
  }

  .card { position: relative; z-index: 1; height: 100%;
          display: grid; grid-template-columns: 620px 580px; align-items: center; }
  .left { padding: 64px 40px 64px 76px; display: flex; flex-direction: column; height: 100%; }
  .brand { display: flex; align-items: center; gap: 14px; }
  .brand span { font-family: Baloo; font-weight: 800; font-size: 42px; color: ${C.ink}; letter-spacing: -0.01em; }
  .eyebrow { margin-top: 30px; font-weight: 700; font-size: 20px; color: ${C.accent};
             text-transform: uppercase; letter-spacing: 0.08em; }
  /* pre, not pre-line: the only breaks are the ones written into the headline,
     and anything too wide overflows measurably so it can be shrunk to fit. */
  h1 { margin-top: 12px; font-family: Baloo; font-weight: 800; font-size: 76px; line-height: 1.05;
       color: ${C.brand}; letter-spacing: -0.02em; white-space: pre; }
  .sub { margin-top: 20px; font-size: 23px; line-height: 1.45; color: ${C.muted}; }
  .chips { margin-top: auto; display: flex; gap: 10px; }
  .chip { border: 1.5px solid ${C.line}; border-radius: 999px; padding: 10px 18px;
          font-size: 18px; font-weight: 700; color: ${C.ink}; background: ${C.surface}; }

  /* The real hero art, bled off the right edge the way the page does it. */
  .art { height: 100%; position: relative; }
  .art img { position: absolute; top: 50%; left: 0; transform: translateY(-50%);
             width: 660px; height: auto; }
</style>
<div class="card">
  <div class="left">
    <div class="brand">${OWL}<span>RosterOwl</span></div>
    ${eyebrow ? `<div class="eyebrow">${eyebrow}</div>` : ''}
    <h1>${headline}</h1>
    <p class="sub">${sub}</p>
    <div class="chips"><span class="chip">No signup</span><span class="chip">No watermark</span><span class="chip">Unlimited students</span></div>
  </div>
  <div class="art"><img src="${art}" alt=""></div>
</div>`;
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const server = createServer((req, res) => {
  let file = join(dist, normalize(new URL(req.url, 'http://x').pathname));
  try {
    if (statSync(file).isDirectory()) file = join(file, 'index.html');
    const type = TYPES[extname(file)] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type }).end(readFileSync(file));
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();

try {
  // 1. Grab the hero art from the real landing page, at 2x so it stays crisp
  //    once it is scaled into the card.
  const heroPage = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await heroPage.goto(`${base}/`, { waitUntil: 'networkidle' });
  const stack = heroPage.locator('.sheet-stack');
  await stack.waitFor({ timeout: 15000 });

  // Strip the page's own paper and ruled lines so the capture is just the sheets
  // and their shadows on transparency. Otherwise the card shows a seam where the
  // screenshot's background meets its own, with two sets of ruled lines a few
  // pixels out of phase — which is precisely the tell that a card was pasted
  // together rather than designed.
  await heroPage.evaluate(() => {
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    const style = document.createElement('style');
    style.textContent = '.hero::before, .hero-copy::before { display: none !important; }';
    document.head.appendChild(style);
  });

  const box = await stack.boundingBox();
  // Padded: the sheets are rotated and their drop shadows fall outside the box.
  const pad = 34;
  const shot = await heroPage.screenshot({
    omitBackground: true,
    clip: {
      x: Math.max(0, box.x - pad),
      y: Math.max(0, box.y - pad),
      width: box.width + pad * 2,
      height: box.height + pad * 2,
    },
  });
  const art = `data:image/png;base64,${shot.toString('base64')}`;
  await heroPage.close();
  console.log(`  hero art captured (${Math.round(box.width)}x${Math.round(box.height)} CSS px)`);

  // 2. Compose each card around it.
  const routes = process.argv.slice(2).length ? process.argv.slice(2) : OG_ROUTES;
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });

  for (const route of routes) {
    await page.setContent(card(route, art));
    await page.evaluate(() => document.fonts.ready);
    // Shrink the headline until its longest line fits the column. Measuring
    // beats counting characters: a new tool with a long name gets a correct card
    // without anyone tuning a threshold.
    await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      let size = parseFloat(getComputedStyle(h1).fontSize);
      while (h1.scrollWidth > h1.clientWidth && size > 34) {
        size -= 2;
        h1.style.fontSize = `${size}px`;
      }
    });

    const file = join(outDir, `${ogSlug(route)}.png`);
    await page.screenshot({ path: file });
    console.log(`  ${route.padEnd(38)} → public/og/${ogSlug(route)}.png`);
    // The home card doubles as the site-wide fallback, for pages with no card of
    // their own (privacy, about, contact, terms, 404).
    if (route === '/') await page.screenshot({ path: join(root, 'public', 'og.png') });
  }
} finally {
  await browser.close();
  server.close();
}
