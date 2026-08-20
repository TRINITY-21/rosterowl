// The object-URL lifecycle behind every printable tool's preview pane.
//
// Seven tools were each carrying their own copy: the same pdfViewerEnabled
// probe, the same create-then-revoke-the-previous dance in three places, and the
// same teardown effect. Copied code that hands out resources the caller has to
// give back is exactly the code that leaks — one tool had already drifted into
// abandoning its last URL when the roster emptied instead of revoking it.
//
// PdfPreview.svelte owns how a preview *looks*; this owns what it *holds*.
import { onDestroy } from 'svelte';

/**
 * False where the browser can't render a PDF inline — some WebKit builds and
 * Chrome with its internal viewer disabled. Those teachers still get the real
 * download; showing them a permanently blank pane would just look broken.
 */
export function canPreviewPdf(): boolean {
  return typeof navigator === 'undefined' || (navigator as Navigator).pdfViewerEnabled !== false;
}

export interface PdfPreviewHandle {
  /** Current blob: URL, or '' when there is nothing to show. */
  readonly url: string;
  readonly canPreview: boolean;
  /** Point the preview at these bytes, releasing whatever it held before. */
  show(bytes: Uint8Array): void;
  /** Nothing to preview — an emptied roster, a filtered-out class. */
  clear(): void;
}

/**
 * Call once, during component init: the returned handle revokes its last URL
 * when the component is destroyed, so no caller has to remember to.
 */
export function createPdfPreview(): PdfPreviewHandle {
  let url = $state('');
  const canPreview = canPreviewPdf();

  function release() {
    if (url) URL.revokeObjectURL(url);
  }

  onDestroy(release);

  return {
    get url() {
      return url;
    },
    get canPreview() {
      return canPreview;
    },
    show(bytes) {
      if (!canPreview) return;
      // The new URL is minted before the old one is revoked: revoking first
      // would blank the <object> for a frame between renders.
      const next = URL.createObjectURL(
        new Blob([bytes.slice().buffer], { type: 'application/pdf' })
      );
      release();
      url = next;
    },
    clear() {
      release();
      url = '';
    },
  };
}
