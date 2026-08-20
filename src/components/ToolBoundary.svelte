<script lang="ts">
  // Wraps a tool's markup so a render or effect that throws shows a recovery
  // panel instead of a blank rectangle. A tool dying silently during someone's
  // prep period is the failure that loses a teacher permanently — and because
  // every tool is a client:only island, an uncaught throw leaves nothing on
  // screen at all, with the roster still sitting safe in localStorage unseen.
  import type { Snippet } from 'svelte';
  import { app } from '../lib/appState.svelte';
  import Icon from './Icon.svelte';

  let { tool, children }: { tool: string; children: Snippet } = $props();

  let details = $state('');
</script>

<svelte:boundary
  onerror={(error) => {
    details = error instanceof Error ? error.message : String(error);
    console.error(`[RosterOwl] ${tool} failed:`, error);
  }}
>
  {@render children()}

  {#snippet failed(_error, reset)}
    <div class="tool-frame">
      <div class="tool-empty" role="alert">
        <span class="empty-icon" aria-hidden="true"><Icon name="alert" size={28} stroke={1.7} /></span>
        <h2>The {tool} hit a problem</h2>
        <div class="copy">
          <p>
            <strong>Your class list is safe.</strong> It's stored in this browser, not in the part
            that broke. Try again — and if it keeps happening, save a backup file first, then
            <a href="/contact/">tell us what you were doing</a> so we can fix it.
          </p>
          {#if details}
            <p class="details"><code>{details}</code></p>
          {/if}
        </div>
        <div class="actions">
          <button class="btn primary" onclick={() => { details = ''; reset(); }}>Try again</button>
          <button class="btn" onclick={() => app.downloadBackup()}>Save backup file</button>
          <button class="btn" onclick={() => location.reload()}>Reload the page</button>
        </div>
      </div>
    </div>
  {/snippet}
</svelte:boundary>

<style>
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    justify-content: center;
  }

  .details code {
    font-size: var(--text-xs);
    color: var(--muted);
    word-break: break-word;
  }
</style>
