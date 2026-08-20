// Fetches the self-hosted TTFs for PDF embedding, once.
import type { PdfFonts } from './types';
import type { CertFonts } from './pdfCerts';

let cache: PdfFonts | null = null;
let displayCache: Uint8Array | null = null;

export async function loadPdfFonts(): Promise<PdfFonts> {
  if (cache) return cache;
  const get = (url: string) =>
    fetch(url, { cache: 'force-cache' }).then((r) => {
      if (!r.ok) throw new Error('Could not load fonts for the PDF');
      return r.arrayBuffer();
    });
  const [regular, bold] = await Promise.all([
    get('/fonts/AtkinsonHyperlegible-Regular.ttf'),
    get('/fonts/AtkinsonHyperlegible-Bold.ttf'),
  ]);
  cache = { regular: new Uint8Array(regular), bold: new Uint8Array(bold) };
  return cache;
}

/** Body fonts + the Baloo 2 display face used on certificates. */
export async function loadCertFonts(): Promise<CertFonts> {
  const base = await loadPdfFonts();
  if (!displayCache) {
    // Distinct filename on purpose: an earlier broken build shipped under the
    // old name and force-cache would happily serve it forever. If this font is
    // ever regenerated, RENAME the file again.
    const r = await fetch('/fonts/Baloo2-Display.ttf', { cache: 'force-cache' });
    if (!r.ok) throw new Error('Could not load fonts for the PDF');
    displayCache = new Uint8Array(await r.arrayBuffer());
  }
  return { ...base, display: displayCache };
}
