// Generates the whole icon set from one owl drawing, so the tab icon, the iOS
// home screen, and the Android maskable icon can never drift apart.
//
//   npm run icons
//
// Playwright does the rasterising (it renders SVG exactly the way the browsers
// that will show these icons do), ImageMagick only stacks the PNGs into .ico.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = join(root, 'public');
const tmp = join(root, 'node_modules', '.cache', 'rosterowl-icons');

const BRAND = '#2e6b4f'; // chalkboard green — the plate, never the owl
const OWL = `
  <path d="M14 30c0-9.9 8.1-18 18-18s18 8.1 18 18v9c0 8.3-6.7 15-15 15h-6c-8.3 0-15-6.7-15-15v-9Z" fill="#e8a03c"/>
  <path d="M17 17 L25 13.5 L22.4 21.5 Z" fill="#e8a03c"/>
  <path d="M47 17 L39 13.5 L41.6 21.5 Z" fill="#e8a03c"/>
  <circle cx="24.5" cy="30" r="7.6" fill="#fdfcf8"/>
  <circle cx="39.5" cy="30" r="7.6" fill="#fdfcf8"/>
  <circle cx="24.5" cy="30" r="3.2" fill="#243230"/>
  <circle cx="39.5" cy="30" r="3.2" fill="#243230"/>
  <path d="M32 36.5 L28.9 41.5 L35.1 41.5 Z" fill="#c9822a"/>
`;

/**
 * @param rx     corner radius in the 64-unit viewBox (0 = square plate)
 * @param scale  owl scale about the canvas centre; < 1 pulls it into a safe zone
 */
function svg({ rx, scale }) {
  const owl =
    scale === 1
      ? OWL.trimEnd()
      : `\n  <g transform="translate(32 32) scale(${scale}) translate(-32 -32)">${OWL}  </g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="100%" height="100%">
  <rect width="64" height="64" rx="${rx}" fill="${BRAND}"/>${owl}
</svg>`;
}

// Rounded plate for browser tabs and the PWA. Square (iOS rounds it itself) for
// apple-touch-icon — a transparent or pre-rounded one gets a black corner halo.
// Maskable pulls the owl to 85% so it survives Android's circle crop.
const ROUNDED = svg({ rx: 14, scale: 1 });
const SQUARE = svg({ rx: 0, scale: 1 });
const MASKABLE = svg({ rx: 0, scale: 0.85 });

const TARGETS = [
  { file: join(out, 'icon-192.png'), size: 192, art: ROUNDED },
  { file: join(out, 'icon-512.png'), size: 512, art: ROUNDED },
  { file: join(out, 'icon-512-maskable.png'), size: 512, art: MASKABLE },
  { file: join(out, 'apple-touch-icon.png'), size: 180, art: SQUARE },
  // .ico members — assembled below, then discarded.
  { file: join(tmp, 'ico-16.png'), size: 16, art: ROUNDED },
  { file: join(tmp, 'ico-32.png'), size: 32, art: ROUNDED },
  { file: join(tmp, 'ico-48.png'), size: 48, art: ROUNDED },
];

mkdirSync(tmp, { recursive: true });

const browser = await chromium.launch();
try {
  for (const { file, size, art } of TARGETS) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(
      `<!doctype html><meta charset="utf-8">
       <style>html,body{margin:0;padding:0;width:${size}px;height:${size}px;overflow:hidden}
       svg{display:block}</style>${art}`,
    );
    await page.screenshot({ path: file, omitBackground: true });
    await page.close();
    console.log(`  ${size.toString().padStart(3)}px  ${file.replace(root + '/', '')}`);
  }
} finally {
  await browser.close();
}

// 16/32/48 in one .ico: Google's SERP favicon and older Safari still ask for it.
const ico = join(out, 'favicon.ico');
execFileSync('magick', [join(tmp, 'ico-16.png'), join(tmp, 'ico-32.png'), join(tmp, 'ico-48.png'), ico]);
console.log(`  ico    ${ico.replace(root + '/', '')}`);

// Keep the SVG favicon in step with the same drawing.
writeFileSync(join(out, 'favicon.svg'), ROUNDED.replace(' width="100%" height="100%"', '') + '\n');
console.log(`  svg    public/favicon.svg`);

rmSync(tmp, { recursive: true, force: true });
