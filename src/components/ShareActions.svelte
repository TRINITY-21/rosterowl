<script lang="ts">
  // The finish-the-job controls every printable tool shares: download the PDF,
  // or open a menu to hand it to the OS share sheet, copy it as an image, or
  // save it as a PNG. Centralised the way PdfPreview is, so all eleven surfaces
  // behave identically and a fix lands everywhere at once.
  //
  // Everything here is local. There is no share *link* anywhere in this menu:
  // a URL carrying a class list is data leaving the device, and /privacy says it
  // never does. Sharing means handing the finished file to the operating system.
  //
  // Deliberately absent: "Print". The site's print stylesheet tells the reader
  // to use the Download PDF button instead, because browser printing renders a
  // partial view of the page rather than the laid-out sheet. Offering it here
  // would be offering the worse of the two artefacts.
  import { app } from '../lib/appState.svelte';
  import Icon from './Icon.svelte';
  import {
    asPng,
    canCopyImage,
    canShareFile,
    copyImage,
    downloadBlob,
    pdfBlob,
    pdfToPng,
    shareFile,
  } from '../lib/share';

  let {
    /** Builds the PDF. Called fresh on every action so options are never stale. */
    getBytes,
    /** File name including the .pdf extension. */
    filename,
    /** What the sheet is, for the share sheet title and the toasts: "seating chart". */
    label,
    /**
     * Text on the download button. Tools that can count what they're about to
     * produce say so — "Download 24 certificates" tells a teacher the roster was
     * read correctly before they open the PDF.
     */
    downloadLabel = 'Download PDF',
    disabled = false,
    /** Smaller buttons, for the blank-printables gallery cards. */
    compact = false,
    /** Tools with their own error banner pass one; the rest get a toast. */
    onerror,
  }: {
    getBytes: () => Promise<Uint8Array>;
    filename: string;
    label: string;
    downloadLabel?: string;
    disabled?: boolean;
    compact?: boolean;
    onerror?: (error: unknown) => void;
  } = $props();

  const size = $derived(compact ? 15 : 16);

  let busy = $state<'' | 'download' | 'share' | 'copy' | 'png'>('');
  let open = $state(false);
  let menu = $state<HTMLDivElement | null>(null);
  let summary = $state<HTMLButtonElement | null>(null);
  let panel = $state<HTMLDivElement | null>(null);

  // Probed with a stand-in file: canShare() inspects the type, not the bytes, so
  // this settles before any PDF has been built.
  const shareable = canShareFile(new Blob([], { type: 'application/pdf' }), filename);
  const copyable = canCopyImage();
  // Nothing to back up on the blank-printables pages, where there is no roster.
  const backupable = $derived(app.classes.length > 0);

  async function run(kind: typeof busy, action: (bytes: Uint8Array) => Promise<void>) {
    if (busy || disabled) return;
    open = false;
    busy = kind;
    try {
      await action(await getBytes());
    } catch (e) {
      console.error(`[RosterOwl] ${kind} failed:`, e);
      if (onerror) onerror(e);
      else app.toast(e instanceof Error ? e.message : `Could not ${kind} the ${label}`, 'warn');
    } finally {
      busy = '';
    }
  }

  const download = () =>
    run('download', async (bytes) => {
      downloadBlob(pdfBlob(bytes), filename);
      app.toast(`${filename} saved to your downloads`, 'ok');
    });

  const share = () =>
    run('share', async (bytes) => {
      if (await shareFile(pdfBlob(bytes), filename, label)) app.toast(`${label} shared`, 'ok');
    });

  const copy = () =>
    run('copy', async (bytes) => {
      const png = await pdfToPng(bytes);
      try {
        await copyImage(png);
        app.toast('Image copied — paste it into an email or a doc', 'ok');
      } catch {
        // Clipboard writes need a permission some browsers refuse outright.
        // Falling back to a download still gets the teacher their image.
        downloadBlob(png, asPng(filename));
        app.toast('Your browser blocked the clipboard, so the image was downloaded instead', 'info');
      }
    });

  const savePng = () =>
    run('png', async (bytes) => {
      downloadBlob(await pdfToPng(bytes), asPng(filename));
      app.toast(`${asPng(filename)} saved to your downloads`, 'ok');
    });

  function saveBackup() {
    open = false;
    app.downloadBackup();
  }

  // Same dismissal behaviour as the header's Tools panel: outside pointerdown
  // and Escape both close it, and Escape returns focus to the button.
  function onPointerDown(e: PointerEvent) {
    if (open && e.target instanceof Node && !menu?.contains(e.target)) open = false;
  }
  function onKeyDown(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === 'Escape') {
      open = false;
      summary?.focus();
      return;
    }
    // This is announced as a menu, so it has to behave like one: arrows walk
    // the items, Home/End jump to the ends. Without this the ARIA role was
    // writing a cheque the keyboard couldn't cash — a screen-reader user was
    // told "menu" and then found only Tab, which walked straight past it.
    const items = focusableItems();
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    const to = {
      ArrowDown: at < 0 ? 0 : (at + 1) % items.length,
      ArrowUp: at < 0 ? items.length - 1 : (at - 1 + items.length) % items.length,
      Home: 0,
      End: items.length - 1,
    }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    items[to]?.focus();
  }

  const focusableItems = () =>
    [...(panel?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])].filter(
      (b) => !b.disabled
    );

  /**
   * Positions the panel with position:fixed rather than letting it sit in flow.
   *
   * On the printable tools this menu lives inside .print-options, which is a
   * scrolling panel (overflow-y: auto) — an absolutely positioned dropdown
   * inside it gets clipped at the panel edge. Fixed coordinates put it above
   * that, and it opens upwards when the button is low on screen, which it
   * usually is because the row is pinned to the bottom of the options column.
   */
  function place() {
    if (!open || !summary || !panel) return;
    const r = summary.getBoundingClientRect();
    const gap = 8;
    const width = Math.max(panel.offsetWidth, r.width);
    const above = r.top > window.innerHeight - r.bottom;

    // Left-aligned to the button, because on the printable tools the button sits
    // at the left of a narrow options column: right-aligning would hang the
    // panel off the card and into the page margin.
    panel.style.left = `${Math.max(gap, Math.min(r.left, window.innerWidth - width - gap))}px`;
    panel.style.width = `${width}px`;
    if (above) {
      panel.style.top = 'auto';
      panel.style.bottom = `${window.innerHeight - r.top + gap}px`;
    } else {
      panel.style.bottom = 'auto';
      panel.style.top = `${r.bottom + gap}px`;
    }
  }

  // Positioned after the panel is in the DOM and has a measurable width.
  // Focus follows it in: a menu the keyboard has to Tab into is not a menu, and
  // it also gives Escape something to return focus *from*.
  $effect(() => {
    if (!open) return;
    place();
    // preventScroll: the panel is already on screen, and .print-options around
    // it scrolls — letting the browser "reveal" the item would shift the column
    // under the teacher's cursor for no gain.
    focusableItems()[0]?.focus({ preventScroll: true });
  });

  // A fixed panel does not move with its button, so it is repositioned as
  // things scroll. Closing on scroll instead looks tempting and is wrong here:
  // .print-options is itself scrollable, and focusing the button can scroll it
  // by a pixel — which closed the menu in the same frame it opened.
  const reposition = () => place();
</script>

<svelte:window
  onpointerdown={onPointerDown}
  onkeydown={onKeyDown}
  onresize={reposition}
  onscrollcapture={reposition}
/>

<div class="share-actions">
  <button class="btn primary" class:small={compact} onclick={download} disabled={disabled || busy !== ''}>
    <Icon name="download" size={size} />
    {busy === 'download' ? 'Building…' : downloadLabel}
  </button>

  {#if shareable || copyable || backupable}
    <div class="share-menu" bind:this={menu}>
      <button
        class="btn"
        class:small={compact}
        class:is-open={open}
        type="button"
        bind:this={summary}
        onclick={() => (open = !open)}
        disabled={disabled || busy !== ''}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <Icon name="share" size={size} />
        {busy === 'share' || busy === 'copy' || busy === 'png' ? 'Building…' : 'Share'}
        <Icon name="chevron-down" size={14} />
      </button>

      {#if open}
      <div class="share-panel" role="menu" bind:this={panel}>
        {#if shareable}
          <button type="button" role="menuitem" onclick={share} disabled={disabled || busy !== ''}>
            <Icon name="share" size={16} />
            <span>
              <strong>Share…</strong>
              <small>AirDrop, Messages, Mail</small>
            </span>
          </button>
        {/if}

        {#if copyable}
          <button type="button" role="menuitem" onclick={copy} disabled={disabled || busy !== ''}>
            <Icon name="copy" size={16} />
            <span>
              <strong>Copy as image</strong>
              <small>Paste into an email or a doc</small>
            </span>
          </button>
        {/if}

        <button type="button" role="menuitem" onclick={savePng} disabled={disabled || busy !== ''}>
          <Icon name="download" size={16} />
          <span>
            <strong>Save as PNG</strong>
            <small>A picture of the first page</small>
          </span>
        </button>

        {#if backupable}
          <hr />
          <button type="button" role="menuitem" onclick={saveBackup}>
            <Icon name="file" size={16} />
            <span>
              <strong>Save backup file</strong>
              <small>Your classes, as a file you keep</small>
            </span>
          </button>
        {/if}
      </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .share-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .share-menu {
    position: relative;
  }

  .share-menu > .btn.is-open {
    border-color: var(--line-strong);
  }

  /* Fixed, with coordinates from place(): .print-options scrolls, and an
     absolutely positioned panel inside it would be clipped at its edge. */
  .share-panel {
    position: fixed;
    z-index: 40;
    min-width: 17rem;
    padding: var(--space-2);
    border: var(--rule-strong);
    border-radius: var(--radius-m);
    background: var(--surface);
    box-shadow: var(--shadow-2);
  }

  .share-panel button {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border: none;
    border-radius: var(--radius-s);
    background: none;
    color: var(--ink);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .share-panel button:hover:not(:disabled),
  .share-panel button:focus-visible {
    background: var(--brand-soft);
    color: var(--brand);
  }

  .share-panel button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .share-panel span {
    display: grid;
  }

  .share-panel strong {
    font-size: var(--text-sm);
    font-weight: 700;
  }

  .share-panel small {
    color: var(--muted);
    font-size: var(--text-xs);
  }

  .share-panel hr {
    height: 0;
    margin: var(--space-2) var(--space-1);
    border: none;
    border-top: var(--rule);
  }

  /* The menu is chrome, not content — never on a printed page. */
  @media print {
    .share-menu {
      display: none;
    }
  }
</style>
