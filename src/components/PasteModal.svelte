<script lang="ts">
  import Icon from './Icon.svelte';
  import Modal from './Modal.svelte';
  import { app } from '../lib/appState.svelte';
  import { parseRoster, type ParsedName } from '../lib/smartPaste';
  import { parseCsvRoster } from '../lib/csv';

  let { mode, onclose }: { mode: 'new' | 'add'; onclose: () => void } = $props();

  let text = $state('');
  let className = $state('');
  let fileError = $state('');
  const fileId = `csv-file-${Math.random().toString(36).slice(2)}`;

  const parsed: ParsedName[] = $derived(parseRoster(text));

  async function onFile(e: Event) {
    fileError = '';
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const names = parseCsvRoster(await file.text());
      if (names.length === 0) throw new Error('No names found in that file');
      text = names.map((n) => (n.last ? `${n.first} ${n.last}` : n.first)).join('\n');
    } catch (err) {
      fileError = err instanceof Error ? err.message : 'Could not read that file';
    } finally {
      // Allow re-selecting the same file after a fix.
      input.value = '';
    }
  }

  function confirm() {
    if (parsed.length === 0) return;
    if (mode === 'new') {
      app.createClass(className, parsed);
      app.shuffle();
    } else {
      app.addStudents(parsed);
      app.toast(`Added ${parsed.length} student${parsed.length === 1 ? '' : 's'}`, 'ok');
    }
    onclose();
  }
</script>

<Modal title={mode === 'new' ? 'Set up your class' : 'Add students'} {onclose} wide>
  {#if mode === 'new'}
    <label class="field">
      Class name
      <input
        bind:value={className}
        autofocus
        placeholder="e.g. Period 3 — English, Ms Rivera's 4th grade"
      />
    </label>
  {/if}

  <label class="field">
    Paste your class list
    <textarea
      bind:value={text}
      autofocus={mode !== 'new'}
      rows="9"
      placeholder={'One student per line — paste from Google Classroom, your gradebook, or anywhere.\n\nAll of these work:\n  Maya Larsen\n  Larsen, Maya\n  3. Maya Larsen  maya.larsen@school.org'}
    ></textarea>
  </label>

  <div class="filerow">
    <label class="btn small upload" for={fileId}>
      <Icon name="upload" size={15} />
      Or upload a CSV
    </label>
    <input id={fileId} class="sr-only" type="file" accept=".csv,.txt" onchange={onFile} />
    {#if fileError}<span class="err" role="alert">{fileError}</span>{/if}
    <span class="privacy">Names stay in this browser — nothing is uploaded.</span>
  </div>

  {#if parsed.length > 0}
    <div class="preview">
      <h3>Found {parsed.length} student{parsed.length === 1 ? '' : 's'}</h3>
      <div class="chips">
        {#each parsed.slice(0, 30) as p}
          <span class="chip">{p.first}{p.last ? ` ${p.last}` : ''}</span>
        {/each}
        {#if parsed.length > 30}
          <span class="chip more">+{parsed.length - 30} more</span>
        {/if}
      </div>
      <p class="fix">Someone missing or mangled? Edit the text above — the list updates live.</p>
    </div>
  {/if}

  <div class="actions">
    <button class="btn quiet" onclick={onclose}>Cancel</button>
    <button class="btn primary" disabled={parsed.length === 0} onclick={confirm}>
      {parsed.length === 0
        ? mode === 'new'
          ? 'Create class'
          : 'Add students'
        : mode === 'new'
          ? `Create class with ${parsed.length} student${parsed.length === 1 ? '' : 's'}`
          : `Add ${parsed.length} student${parsed.length === 1 ? '' : 's'}`}
    </button>
  </div>
</Modal>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--muted);
    margin-bottom: var(--space-4);
  }
  textarea {
    resize: vertical;
    font-size: 0.95rem;
    font-weight: 400;
    line-height: 1.5;
  }
  .filerow {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
    margin-bottom: var(--space-4);
  }
  .upload {
    cursor: pointer;
  }
  .filerow .privacy {
    font-size: var(--text-xs);
    color: var(--muted);
  }
  .err {
    color: var(--danger);
    font-size: var(--text-xs);
    font-weight: 700;
  }
  .preview {
    background: var(--surface-2);
    border: 1px solid var(--line);
    border-radius: var(--radius-m);
    padding: var(--space-3);
    margin-bottom: var(--space-4);
  }
  .preview h3 {
    font-size: var(--text-sm);
    margin: 0 0 var(--space-2);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    max-height: 9.5rem;
    overflow-y: auto;
  }
  .chip {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius-pill);
    padding: 0.12rem 0.55rem;
    font-size: var(--text-xs);
    font-weight: 700;
  }
  .chip.more {
    color: var(--muted);
    border-style: dashed;
  }
  .fix {
    font-size: var(--text-xs);
    color: var(--muted);
    margin: var(--space-2) 0 0;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
  @media (max-width: 520px) {
    .actions {
      flex-direction: column-reverse;
    }
    .actions .btn {
      width: 100%;
    }
  }
</style>
