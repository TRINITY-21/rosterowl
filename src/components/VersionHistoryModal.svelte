<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import { confirmDialog } from '../lib/dialog.svelte';
  import { timeAgo, versionTitle, type VersionEntry } from '../lib/versions';
  import Icon from './Icon.svelte';
  import Modal from './Modal.svelte';

  let { onclose }: { onclose: () => void } = $props();

  let label = $state('');

  function saveNamed() {
    app.saveVersion(label.trim() || null);
    label = '';
  }

  async function restore(entry: VersionEntry) {
    const ok = await confirmDialog({
      title: 'Restore this version?',
      message: `Your rooms and classes will go back to “${versionTitle(entry)}” from ${timeAgo(entry.ts)}.`,
      detail: 'The current state is saved as a version first, so you can always come back.',
      confirmLabel: 'Restore version',
    });
    if (!ok) return;
    app.restoreVersion(entry.id);
    onclose();
  }

  async function remove(entry: VersionEntry) {
    const ok = await confirmDialog({
      title: 'Delete this version?',
      message: `“${versionTitle(entry)}” from ${timeAgo(entry.ts)} will be removed from your history.`,
      confirmLabel: 'Delete version',
      tone: 'danger',
    });
    if (ok) app.deleteVersion(entry.id);
  }
</script>

<Modal title="Version history" {onclose} wide>
  <p class="lede">
    Snapshots of all your rooms and classes, kept privately in this browser. RosterOwl saves one
    automatically while you work — or save a named version before a big change.
  </p>

  <form
    class="save-row"
    onsubmit={(e) => {
      e.preventDefault();
      saveNamed();
    }}
  >
    <input
      type="text"
      placeholder="Version name (optional) — e.g. Before parent night"
      aria-label="Version name"
      maxlength="60"
      bind:value={label}
    />
    <button class="btn primary" type="submit">
      <Icon name="plus" size={16} />
      Save version
    </button>
  </form>

  {#if app.versions.length === 0}
    <div class="empty">
      <span class="empty-icon"><Icon name="history" size={26} /></span>
      <h3>No versions yet</h3>
      <p>Save one above, or keep working — automatic snapshots will appear here.</p>
    </div>
  {:else}
    <ul class="versions">
      {#each app.versions as entry (entry.id)}
        <li class="version">
          <span class="mark {entry.kind}" aria-hidden="true">
            <Icon name={entry.kind === 'manual' ? 'check' : 'history'} size={15} />
          </span>
          <div class="info">
            <span class="name">{versionTitle(entry)}</span>
            <span class="meta">
              <time datetime={new Date(entry.ts).toISOString()} title={new Date(entry.ts).toLocaleString()}>
                {timeAgo(entry.ts)}
              </time>
              · {entry.summary}
            </span>
          </div>
          <div class="row-actions">
            <button class="btn small" onclick={() => restore(entry)}>
              <Icon name="restore" size={15} />
              Restore
            </button>
            <button
              class="btn small quiet icon-only"
              aria-label={`Delete version “${versionTitle(entry)}”`}
              title="Delete version"
              onclick={() => remove(entry)}
            >
              <Icon name="trash" size={15} />
            </button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</Modal>

<style>
  .lede {
    margin: 0 0 var(--space-4);
    color: var(--muted);
    font-size: var(--text-sm);
  }
  .save-row {
    display: flex;
    gap: var(--space-2);
    margin-bottom: var(--space-4);
  }
  .save-row input {
    flex: 1;
    min-width: 0;
  }
  .empty {
    text-align: center;
    padding: var(--space-6) var(--space-4);
    border: 1px dashed var(--line-strong);
    border-radius: var(--radius-m);
  }
  .empty-icon {
    display: inline-grid;
    place-items: center;
    width: 3rem;
    height: 3rem;
    border-radius: 50%;
    background: var(--brand-soft);
    color: var(--brand-strong);
    margin-bottom: var(--space-2);
  }
  .empty h3 {
    font-size: var(--text-lg);
  }
  .empty p {
    color: var(--muted);
    font-size: var(--text-sm);
    margin: var(--space-1) 0 0;
  }
  .versions {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .version {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-2);
    border-top: 1px solid var(--line);
  }
  .mark {
    flex: none;
    display: grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
    border-radius: 50%;
    background: var(--surface-2);
    color: var(--muted);
  }
  .mark.manual {
    background: var(--brand-soft);
    color: var(--brand-strong);
  }
  .info {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 0.1rem;
  }
  .name {
    font-weight: 700;
    line-height: 1.3;
  }
  .meta {
    color: var(--muted);
    font-size: var(--text-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row-actions {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .icon-only {
    padding-inline: 0.5rem;
    color: var(--muted);
  }
  .icon-only:hover {
    color: var(--danger);
  }
  @media (max-width: 520px) {
    .save-row {
      flex-direction: column;
    }
    .version {
      flex-wrap: wrap;
    }
    .info {
      flex-basis: calc(100% - 2rem - var(--space-3));
    }
    .row-actions {
      margin-left: calc(2rem + var(--space-3));
    }
  }
</style>
