// Test helper: every text item on every page of a PDF, in drawing order.
// pdfjs's legacy build runs under Node, so tests can assert on what a teacher
// would actually read on the printed page rather than on renderer internals.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export async function pdfText(bytes: Uint8Array): Promise<string[]> {
  // getDocument transfers (detaches) the buffer it is given; copy so the
  // caller's bytes stay usable.
  const task = getDocument({ data: bytes.slice(), disableFontFace: true });
  const pdf = await task.promise;
  const out: string[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    for (const item of content.items) if ('str' in item) out.push(item.str);
  }
  await task.destroy();
  return out;
}
