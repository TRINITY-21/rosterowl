<!-- RosterOwl flashcard maker tool -->
<script lang="ts">
  import { untrack } from 'svelte';
  import { app } from '../lib/appState.svelte';
  import { createPdfPreview } from '../lib/pdfPreview.svelte';
  import { displayNames } from '../lib/names';
  import type { CardSize, ItemMode } from '../lib/pdfFlashcards';
  import PasteModal from './PasteModal.svelte';
  import Toasts from './Toasts.svelte';
  import ClassSwitcher from './ClassSwitcher.svelte';
  import SyncMenu from './SyncMenu.svelte';
  import EmptyState from './EmptyState.svelte';
  import PdfPreview from './PdfPreview.svelte';
  import SampleBanner from './SampleBanner.svelte';
  import Icon from './Icon.svelte';
  import ToolBoundary from './ToolBoundary.svelte';
  import ShareActions from './ShareActions.svelte';
  import { flashcardsPdfFilename } from '../lib/filenames';

  app.load();

  let pasteMode = $state<'new' | 'add' | null>(null);
  let mode = $state<ItemMode>('names');
  let nameStyle = $state<'first' | 'full'>('first');
  let skipAbsent = $state(false);
  let customText = $state(app.activeClass?.wordLists.flashcards ?? '');
  let size = $state<CardSize>('jumbo');
  let cornerLabel = $state('');
  let paper = $state<'letter' | 'a4'>('letter');
  let showCutLines = $state(true);
  let inkSaver = $state(false);

  let wordListEl = $state<HTMLTextAreaElement | null>(null);

  const preview = createPdfPreview();
  let generating = $state(true);
  let error = $state('');
  let pages = $state(0);
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cls = $derived(app.activeClass);

  // The saved word list travels with the class: reload it on class switch ONLY.
  // Reading wordLists.flashcards reactively would make every keystroke (which
  // writes it back via setWordList) re-run this effect and stomp the textarea,
  // so the read is untracked and guarded on the class id.
  let seededFor: string | null = app.activeClassId;
  $effect(() => {
    const id = app.activeClassId;
    if (id === seededFor) return;
    seededFor = id;
    customText = untrack(() => app.activeClass?.wordLists.flashcards ?? '');
  });

  // Cards carry text only — names built here, never any other roster field.
  const items: string[] = $derived.by(() => {
    if (mode === 'custom') {
      // One card per line; blank lines dropped; duplicates KEPT on purpose
      // (same rules as parseItems in pdfFlashcards.ts).
      return customText
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
    }
    const pool = (cls?.students ?? []).filter((s) => !(skipAbsent && s.absent));
    if (nameStyle === 'full') return pool.map((s) => `${s.first} ${s.last}`.trim());
    // First names, disambiguated like on screen ("Maya L." / "Maya P.").
    const names = displayNames(pool);
    return pool.map((s) => names.get(s.id) ?? s.first);
  });

  const sizeLabel: Record<CardSize, string> = {
    jumbo: 'jumbo — 2 per page',
    large: 'classic — 4 per page',
    small: 'pocket — 8 per page',
  };

  /** jumbo prints on a landscape sheet; classic and pocket stay portrait. */
  const portraitSheet = $derived(size !== 'jumbo');

  function focusWordList() {
    wordListEl?.focus();
  }

  function opts() {
    return { paper, size, showCutLines, cornerLabel, inkSaver };
  }

  async function generate(): Promise<Uint8Array | null> {
    if (!app.activeClass) {
      error = 'No class yet — paste your class list first';
      generating = false;
      return null;
    }
    if (items.length === 0) {
      preview.clear();
      error = '';
      pages = 0;
      generating = false;
      return null;
    }
    generating = true;
    error = '';
    try {
      const [{ renderFlashcardsPdf }, { loadCertFonts }] = await Promise.all([
        import('../lib/pdfFlashcards'),
        import('../lib/pdfFonts'),
      ]);
      const fonts = await loadCertFonts();
      const result = await renderFlashcardsPdf(items, opts(), fonts);
      pages = result.pages;
      preview.show(result.bytes);
      return result.bytes;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not build the PDF';
      return null;
    } finally {
      generating = false;
    }
  }

  $effect(() => {
    void [mode, nameStyle, skipAbsent, items.join('\0'), size, cornerLabel, paper, showCutLines, inkSaver, app.activeClassId];
    generating = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => generate(), 350);
    return () => {
      if (timer) clearTimeout(timer);
    };
  });


  // Rebuilt on demand rather than reusing the preview's bytes, so an option
  // changed while the preview was still rendering cannot ship a stale sheet.
  async function buildPdf(): Promise<Uint8Array> {
    const bytes = await generate();
    if (!bytes) throw new Error(error || 'Could not build the PDF');
    return bytes;
  }

  const filename = $derived(flashcardsPdfFilename(cls?.name || 'Class', mode));

</script>
<ToolBoundary tool="flashcard maker">


<div class="tool-frame">
  <div class="tool-toolbar">
    <div class="tool-cluster">
      <ClassSwitcher onnew={() => (pasteMode = 'new')} />
    </div>
    <div class="tool-cluster">
      <SyncMenu />
    </div>
  </div>

  {#if app.isSample}
    <SampleBanner onreplace={() => (pasteMode = 'new')}>
      Preview the card set, then replace it with your own roster.
    </SampleBanner>
  {/if}

  {#if !cls}
    <EmptyState title="No class yet" actionLabel="Paste your class list" onaction={() => (pasteMode = 'new')}>
      Paste your class list once — a card for every student, and your word lists save with the class.
    </EmptyState>
  {:else}
    <!-- One empty state per reason, shown in the preview pane. The note above the
         download button says the same thing in one line; neither invents a second. -->
    {#snippet nothingToPrint()}
      {#if mode === 'custom'}
        <EmptyState
          compact
          title="Your word list is empty"
          actionLabel="Start your word list"
          onaction={focusWordList}
        >
          Every line becomes one card — sight words, vocabulary, math facts. Blank lines are
          skipped, repeats are kept so you can print a word twice.
        </EmptyState>
      {:else if (cls?.students.length ?? 0) === 0}
        <EmptyState
          compact
          title="No students on this roster"
          actionLabel="Paste your class list"
          onaction={() => (pasteMode = 'new')}
        >
          Name cards are built from your roster, spelled exactly as you typed them. Paste the list
          once, or set “Cards from” to your own word list instead.
        </EmptyState>
      {:else}
        <EmptyState compact icon="alert" title="Everyone is marked absent" href="/seating-chart/" actionLabel="Review attendance">
          “Skip students marked absent” is on and nobody is left to print. Turn it off above, or
          update today's attendance first.
        </EmptyState>
      {/if}
    {/snippet}

    <div class="print-grid">
      <div class="print-options">
        <label class="print-opt">
          Cards from
          <select bind:value={mode}>
            <option value="names">Student names</option>
            <option value="custom">My own word list</option>
          </select>
        </label>
        {#if mode === 'names'}
          <label class="print-opt">
            Name style
            <select bind:value={nameStyle}>
              <option value="first">First names only</option>
              <option value="full">First + last name</option>
            </select>
          </label>
          <label class="print-check">
            <input type="checkbox" bind:checked={skipAbsent} />
            Skip students marked absent
          </label>
        {:else}
          <label class="print-opt">
            Your word list (one card per line)
            <textarea
              class="word-list"
              bind:this={wordListEl}
              bind:value={customText}
              oninput={(e) => app.setWordList('flashcards', e.currentTarget.value)}
              rows="8"
              placeholder={'sun\nmoon\nbecause\n7 × 8'}
            ></textarea>
          </label>
          <p class="print-note">Saved automatically with {cls.name} — on this device only.</p>
        {/if}
        <label class="print-opt">
          Card size
          <select bind:value={size}>
            <option value="jumbo">Jumbo — 2 per page (word wall, name jar)</option>
            <option value="large">Classic — 4 per page (flashcards)</option>
            <option value="small">Pocket — 8 per page (card rings)</option>
          </select>
        </label>
        <label class="print-opt">
          Corner label (optional)
          <input bind:value={cornerLabel} placeholder={cls.name} maxlength="40" />
        </label>
        <label class="print-opt">
          Paper
          <select bind:value={paper}>
            <option value="letter">Letter (US)</option>
            <option value="a4">A4</option>
          </select>
        </label>
        <label class="print-check">
          <input type="checkbox" bind:checked={showCutLines} />
          Card borders &amp; cut guides
        </label>
        <label class="print-check">
          <input type="checkbox" bind:checked={inkSaver} />
          Ink saver (B/W)
        </label>
        {#if items.length > 0}
          <p class="print-note">
            {items.length} cards ({sizeLabel[size]}) ·
            {generating ? '…' : pages} page{pages === 1 && !generating ? '' : 's'}, one PDF.
          </p>
        {:else if mode === 'custom'}
          <p class="print-note">
            Type one word or phrase per line above — each line prints as its own card.
          </p>
        {:else if cls.students.length === 0}
          <p class="print-note warn">
            <Icon name="alert" size={14} />
            <span>No students yet — paste your class list, or switch to your own word list.</span>
          </p>
        {:else}
          <p class="print-note warn">
            <Icon name="alert" size={14} />
            <span>Everyone is marked absent — no cards to print.</span>
          </p>
        {/if}
        <ShareActions
          getBytes={buildPdf}
          downloadLabel={`Download ${items.length} cards`}
          {filename}
          label="flashcards"
          disabled={generating || !!error || items.length === 0}
          onerror={(e) => (error = e instanceof Error ? e.message : 'Could not build the PDF')}
        />
      </div>
      <PdfPreview
        label="flashcard"
        previewUrl={preview.url}
        {generating}
        {error}
        canPreview={preview.canPreview}
        onretry={() => generate()}
        portrait={portraitSheet}
        blocked={items.length === 0 ? nothingToPrint : undefined}
      />
    </div>
  {/if}
</div>

{#if pasteMode}
  <PasteModal mode={pasteMode} onclose={() => (pasteMode = null)} />
{/if}
<Toasts />
</ToolBoundary>

<style>
  /* rows="8" sets the height; the floor keeps it usable if the rows hint is ignored.
     font-weight resets the 700 inherited from the .print-opt label. */
  .word-list {
    min-height: 8rem;
    font-weight: 400;
  }

  /* .print-note.warn is a flex row: keep the leading icon from squashing. */
  .print-note.warn :global(svg) {
    flex: none;
    margin-top: var(--space-1);
  }
</style>
