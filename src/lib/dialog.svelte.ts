// Promise-based replacement for window.confirm()/alert(). A single host
// component (ConfirmDialog.svelte) renders whatever request is pending, so
// destructive actions get a real, styled modal instead of a browser popup.

export interface DialogOptions {
  title: string;
  message: string;
  /** Extra fine-print under the message (e.g. what exactly gets cleared). */
  detail?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Danger renders a red filled confirm button and warning icon. */
  tone?: 'default' | 'danger';
}

interface PendingDialog extends DialogOptions {
  resolve: (ok: boolean) => void;
}

class DialogState {
  current = $state<PendingDialog | null>(null);

  request(options: DialogOptions): Promise<boolean> {
    // A second request while one is open cancels the first — matches how
    // browsers serialize confirm(), without ever stacking modals.
    this.current?.resolve(false);
    return new Promise((resolve) => {
      this.current = { tone: 'default', ...options, resolve };
    });
  }

  settle(ok: boolean) {
    const pending = this.current;
    this.current = null;
    pending?.resolve(ok);
  }
}

export const dialog = new DialogState();

/** Drop-in async replacement for `window.confirm(...)`. */
export function confirmDialog(options: DialogOptions): Promise<boolean> {
  if (typeof document === 'undefined') return Promise.resolve(true);
  return dialog.request(options);
}

// ---------------------------------------------------------------------------
// Scroll lock
// ---------------------------------------------------------------------------
// Modals stack (a confirm can open on top of a modal), so the lock is counted.
// A boolean flag would unlock the page when the topmost layer closed.

let lockDepth = 0;

export function pushScrollLock() {
  if (typeof document === 'undefined') return;
  lockDepth += 1;
  document.body.dataset.modalOpen = '';
}

export function popScrollLock() {
  if (typeof document === 'undefined') return;
  lockDepth = Math.max(0, lockDepth - 1);
  if (lockDepth === 0) delete document.body.dataset.modalOpen;
}
