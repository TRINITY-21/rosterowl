<script lang="ts">
  import { fly } from 'svelte/transition';
  import { app } from '../lib/appState.svelte';
  import Icon from './Icon.svelte';

  const glyphs = { info: 'info', ok: 'check', warn: 'alert' } as const;
</script>

<div class="toasts" role="status" aria-live="polite">
  {#each app.toasts as t (t.id)}
    <div class="toast {t.kind}" transition:fly={{ y: 12, duration: 160 }}>
      <span class="glyph" aria-hidden="true"><Icon name={glyphs[t.kind]} size={14} stroke={2.4} /></span>
      <span class="msg">{t.message}</span>
      {#if t.action}
        <button
          class="btn small primary"
          onclick={() => {
            t.action?.run();
            app.dismissToast(t.id);
          }}>{t.action.label}</button
        >
      {/if}
      <button class="icon-btn dismiss" aria-label="Dismiss notification" onclick={() => app.dismissToast(t.id)}>
        <Icon name="close" size={14} />
      </button>
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    bottom: calc(1.2rem + env(safe-area-inset-bottom));
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    z-index: 220;
    pointer-events: none;
    width: max-content;
    max-width: min(92vw, 480px);
  }
  .toast {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 0.7rem;
    background: var(--surface);
    color: var(--ink);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-m);
    box-shadow: var(--shadow-2);
    padding: 0.55rem 0.6rem 0.55rem 0.7rem;
    max-width: 100%;
    font-size: var(--text-sm);
    font-weight: 700;
  }
  .glyph {
    flex: none;
    display: grid;
    place-items: center;
    width: 1.5rem;
    height: 1.5rem;
    border-radius: 50%;
    background: var(--info-soft);
    color: var(--info);
  }
  .toast.ok .glyph {
    background: var(--brand-soft);
    color: var(--ok);
  }
  .toast.warn .glyph {
    background: var(--warn-soft);
    color: var(--warn);
  }
  .msg {
    min-width: 0;
  }
  .dismiss {
    flex: none;
  }
</style>
