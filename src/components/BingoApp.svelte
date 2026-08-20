<!-- RosterOwl classroom bingo card generator -->
<script lang="ts">
  import { untrack } from 'svelte';
  import { app } from '../lib/appState.svelte';
  import type { BingoSize } from '../lib/pdfBingo';
  import PasteModal from './PasteModal.svelte';
  import Toasts from './Toasts.svelte';
  import ClassSwitcher from './ClassSwitcher.svelte';
  import EmptyState from './EmptyState.svelte';
  import Icon from './Icon.svelte';
  import PdfPreview from './PdfPreview.svelte';

  app.load();

  // Deterministic PRNG (mulberry32) so the preview and the download are the
  // same set of cards; "New shuffle" bumps the seed for a fresh set.
  function mulberry32(seed: number) {
    return () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const newSeed = () => Math.floor(Math.random() * 4294967296);

  let pasteMode = $state<'new' | 'add' | null>(null);
  let mode = $state<'names' | 'custom'>('names');
  let size = $state<BingoSize>(4);
  let freeCenter = $state(true);
  let count = $state(30);
  let title = $state('Class Bingo');
  let customText = $state(app.activeClass?.wordLists.bingo ?? '');
  let perPage = $state<1 | 2>(1);
  let callerList = $state(true);
  let paper = $state<'letter' | 'a4'>('letter');
  let inkSaver = $state(false);
  let showFooter = $state(true);
  let seed = $state(newSeed());

  let previewUrl = $state('');
  let generating = $state(true);
  let error = $state('');
  let pages = $state(0);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const canPreview =
    typeof navigator === 'undefined' || (navigator as Navigator).pdfViewerEnabled !== false;

  const cls = $derived(app.activeClass);

  // Same normalization as the lib (trim, drop blanks, ignore duplicates
  // case-insensitively) so the counts shown here always match what it builds.
  function normalize(lines: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of lines) {
      const item = raw.trim();
      if (!item) continue;
      const key = item.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    return out;
  }

  // Names mode uses the same display names as every other tool — names only,
  // never absent flags or any other roster tag (privacy rule).
  const items = $derived(
    mode === 'names'
      ? normalize((cls?.students ?? []).map((s) => app.names.get(s.id) ?? `${s.first} ${s.last}`.trim()))
      : normalize(customText.split('\n'))
  );
  /** Items each card can draw from (own name excluded in names mode). */
  const avail = $derived(mode === 'names' ? Math.max(0, items.length - 1) : items.length);
  const cardCount = $derived(
    mode === 'names' ? items.length : Math.max(1, Math.min(60, Math.floor(Number.isFinite(count) ? Number(count) : 30)))
  );

  function needs(s: number): number {
    return s * s - (freeCenter && s % 2 === 1 ? 1 : 0);
  }
  const poolOk = $derived(needs(size) <= avail && cardCount > 0);
  const sizeHint = $derived(`${size}×${size} needs ${needs(size)} items — you have ${avail}`);
  /** The one next step that unblocks a too-small pool, for the current mode. */
  const fixHint = $derived(
    mode === 'names'
      ? 'Pick a smaller grid, or add students to your class list.'
      : 'Add more items above (one per line), or pick a smaller grid.'
  );

  // The saved word list travels with the class: reload it on class switch ONLY.
  // Reading wordLists.bingo reactively would make every keystroke (which writes
  // it back via setWordList) re-run this effect and stomp the textarea, so the
  // read is untracked and guarded on the class id.
  let seededFor: string | null = app.activeClassId;
  $effect(() => {
    const id = app.activeClassId;
    if (id === seededFor) return;
    seededFor = id;
    customText = untrack(() => app.activeClass?.wordLists.bingo ?? '');
  });

  async function generate(): Promise<Uint8Array | null> {
    const c = app.activeClass;
    if (!c || c.students.length === 0) {
      error = 'No class yet — paste your class list first';
      generating = false;
      return null;
    }
    if (!poolOk) {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = '';
      error = '';
      pages = 0;
      generating = false;
      return null;
    }
    generating = true;
    error = '';
    try {
      const [{ buildBingoCards, renderBingoPdf }, { loadCertFonts }] = await Promise.all([
        import('../lib/pdfBingo'),
        import('../lib/pdfFonts'),
      ]);
      const fonts = await loadCertFonts();
      const cards = buildBingoCards(
        items,
        {
          size,
          freeCenter,
          count: cardCount,
          excludeHeader: mode === 'names',
          title: mode === 'custom' ? title.trim() || 'Class Bingo' : undefined,
        },
        mulberry32(seed)
      );
      const result = await renderBingoPdf(
        cards,
        { paper, perPage, callerList, items, inkSaver, showFooter },
        fonts
      );
      pages = result.pages;
      if (canPreview) {
        const url = URL.createObjectURL(
          new Blob([result.bytes.slice().buffer], { type: 'application/pdf' })
        );
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = url;
      }
      return result.bytes;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not build the PDF';
      return null;
    } finally {
      generating = false;
    }
  }

  $effect(() => {
    void [mode, size, freeCenter, count, title, items.join('\0'), perPage, callerList, paper, inkSaver, showFooter, seed, app.activeClassId];
    generating = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => generate(), 350);
    return () => {
      if (timer) clearTimeout(timer);
    };
  });

  $effect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  });

  async function download() {
    if (!poolOk) return;
    const bytes = await generate();
    if (!bytes) return;
    const { bingoPdfFilename } = await import('../lib/pdfBingo');
    const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = bingoPdfFilename(cls?.name ?? 'Class');
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    app.toast(`${cardCount} bingo card${cardCount === 1 ? '' : 's'} saved as one PDF`, 'ok');
  }

</script>

<div class="tool-frame">
  <div class="tool-toolbar">
    <div class="tool-cluster">
      <ClassSwitcher onnew={() => (pasteMode = 'new')} />
    </div>
  </div>

  {#if app.isSample}
    <div data-sample-banner>
      <span><strong>Sample class.</strong> Preview the cards, then replace it with your own roster.</span>
      <button class="btn primary small" onclick={() => (pasteMode = 'new')}>Use my class list</button>
    </div>
  {/if}

  {#if !cls || cls.students.length === 0}
    <EmptyState title="No class yet" actionLabel="Paste your class list" onaction={() => (pasteMode = 'new')}>
      Paste your class list once — a unique bingo card for everyone, no name typed twice.
    </EmptyState>
  {:else}
    <div class="print-grid">
      <div class="print-options">
        <label class="print-opt">
          Card items
          <select bind:value={mode} aria-label="Card items">
            <option value="names">Student names — one card per student</option>
            <option value="custom">My own word list</option>
          </select>
        </label>
        {#if mode === 'custom'}
          <label class="print-opt">
            Card title
            <input bind:value={title} maxlength="60" placeholder="Class Bingo" />
          </label>
          <label class="print-opt">
            Your word list — one per line (saved with this class)
            <textarea
              class="word-list"
              rows="7"
              placeholder="sight words, vocab, math facts — one per line"
              value={customText}
              oninput={(e) => {
                customText = e.currentTarget.value;
                app.setWordList('bingo', customText);
              }}
            ></textarea>
          </label>
          <label class="print-opt">
            Cards
            <input type="number" min="1" max="60" bind:value={count} aria-label="Number of cards" />
          </label>
        {/if}
        <label class="print-opt">
          Grid size
          <select bind:value={size} aria-label="Grid size">
            {#each [3, 4, 5] as s}
              <option value={s} disabled={needs(s) > avail}>
                {s} × {s}{needs(s) > avail ? ` — needs ${needs(s)} items` : ''}
              </option>
            {/each}
          </select>
        </label>
        {#if size % 2 === 1}
          <label class="print-check">
            <input type="checkbox" bind:checked={freeCenter} />
            Free center square
          </label>
        {/if}
        <label class="print-opt">
          Layout
          <select bind:value={perPage}>
            <option value={1}>1 card per page — big and playable</option>
            <option value={2}>2 cards per page — paper saver</option>
          </select>
        </label>
        <label class="print-opt">
          Paper
          <select bind:value={paper}>
            <option value="letter">Letter (US)</option>
            <option value="a4">A4</option>
          </select>
        </label>
        <label class="print-check">
          <input type="checkbox" bind:checked={callerList} />
          Caller's list page (numbered tick-boxes)
        </label>
        <label class="print-check">
          <input type="checkbox" bind:checked={inkSaver} />
          Ink saver (B/W)
        </label>
        <label class="print-check">
          <input type="checkbox" bind:checked={showFooter} />
          “Made with RosterOwl” footer
        </label>
        <button class="btn small quiet" onclick={() => (seed = newSeed())} disabled={!poolOk}>
          <Icon name="shuffle" size={16} />
          New shuffle
        </button>
        {#if !poolOk}
          <p class="print-note warn" role="status">
            <Icon name="alert" size={14} />
            <span>{sizeHint}. {fixHint}</span>
          </p>
        {:else}
          <p class="print-note">
            {cardCount} card{cardCount === 1 ? '' : 's'}, every one unique ·
            {generating ? '…' : pages} page{pages === 1 && !generating ? '' : 's'}, one PDF.
          </p>
        {/if}
        <button
          class="btn primary"
          onclick={() => download()}
          disabled={generating || !!error || !poolOk}
        >
          <Icon name="download" size={16} />
          {generating ? 'Preparing preview…' : `Download ${cardCount} bingo card${cardCount === 1 ? '' : 's'}`}
        </button>
      </div>
      <!-- Nothing can be rendered until the pool is big enough — say by how much,
           and give the one action that fixes it. Passed only while it applies. -->
      {#snippet poolTooSmall()}
        <div class="print-msg">
          <p>{sizeHint}</p>
          <p>{fixHint}</p>
          {#if mode === 'names'}
            <button class="btn small" onclick={() => (pasteMode = 'add')}>Add students</button>
          {/if}
        </div>
      {/snippet}
      <PdfPreview
        label="bingo card"
        {previewUrl}
        {generating}
        {error}
        {canPreview}
        onretry={() => generate()}
        blocked={poolOk ? undefined : poolTooSmall}
        portrait
      />
    </div>
  {/if}
</div>

{#if pasteMode}
  <PasteModal mode={pasteMode} onclose={() => (pasteMode = null)} />
{/if}
<Toasts />

<style>
  /* The word list is body copy, not a label: it must not inherit the bold,
     muted type of the .print-opt it sits inside. */
  .word-list {
    width: 100%;
    font-size: var(--text-sm);
    font-weight: 400;
    line-height: 1.5;
    color: var(--ink);
  }

  /* The alert glyph is a flex item of the global .print-note.warn row: keep it
     from shrinking on a 320px screen and sit it on the first line of text. */
  .print-note.warn :global(svg) {
    flex: none;
    margin-top: 0.15em;
  }
</style>
