// Getting a finished sheet out of the browser and to another human.
//
// Everything here is local. Sharing hands the file to the operating system's own
// share sheet, or puts an image on the clipboard — no upload, no share link, and
// nothing that would put a student's name into a URL. That keeps the promise on
// /privacy/ intact while still giving a teacher a way to send today's chart to
// the person covering their class.

/** The download every tool used to open by hand, in one place. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  // Long enough for the download to start; revoking immediately can cancel it.
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export const pdfBlob = (bytes: Uint8Array) =>
  new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/pdf' });

function toFile(blob: Blob, filename: string) {
  return new File([blob], filename, { type: blob.type });
}

/**
 * Whether the OS share sheet will take a file of this kind. False on most
 * desktops, true on iPadOS, iOS and Android — which is exactly where a teacher
 * wants to AirDrop a chart to the classroom next door.
 */
export function canShareFile(blob: Blob, filename: string): boolean {
  if (typeof navigator === 'undefined' || !navigator.canShare || !navigator.share) return false;
  try {
    return navigator.canShare({ files: [toFile(blob, filename)] });
  } catch {
    return false;
  }
}

/** Opens the OS share sheet. Resolves false if the teacher dismissed it. */
export async function shareFile(blob: Blob, filename: string, title: string): Promise<boolean> {
  try {
    await navigator.share({ files: [toFile(blob, filename)], title });
    return true;
  } catch (e) {
    // A dismissed share sheet rejects with AbortError; that is not a failure.
    if (e instanceof DOMException && e.name === 'AbortError') return false;
    throw e;
  }
}

/** Whether an image can be put on the clipboard (Firefox lacks ClipboardItem). */
export function canCopyImage(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof ClipboardItem !== 'undefined' &&
    typeof navigator.clipboard?.write === 'function'
  );
}

/**
 * The first page of a PDF, rendered to a PNG.
 *
 * pdf.js is imported here and nowhere else, so its ~340 KB only loads when a
 * teacher actually asks for an image — first paint, Lighthouse and the SEO
 * pages never pay for it. Rendering the real PDF (rather than screenshotting the
 * DOM) means the image is exactly what would come out of the printer, and it
 * works for all ten tools without a second renderer to keep in step.
 */
export async function pdfToPng(bytes: Uint8Array, targetWidth = 1600): Promise<Blob> {
  const pdfjs = await import('pdfjs-dist');
  // Bundled by Vite as a same-origin module worker, which the site's
  // Content-Security-Policy allows (`worker-src 'self'`). No CDN.
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).href;

  // getDocument takes ownership of the buffer, so hand it a copy — the caller
  // still needs these bytes for the download button next to this one.
  const task = pdfjs.getDocument({ data: bytes.slice() });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: targetWidth / base.width });

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser could not create the image');

    // PDFs are drawn on transparency; paper white keeps the PNG readable when
    // it lands in a dark-themed chat window.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvas, canvasContext: context, viewport }).promise;

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Could not build the image'))),
        'image/png',
      );
    });
  } finally {
    // Tears down the worker too, so repeated copies don't leak one each time.
    await task.destroy();
  }
}

/** Puts a PNG on the clipboard, ready to paste into email, Docs or a message. */
export async function copyImage(blob: Blob): Promise<void> {
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

/** "Sample class — Seating chart.pdf" → "Sample class — Seating chart.png" */
export const asPng = (filename: string) => filename.replace(/\.pdf$/i, '') + '.png';
