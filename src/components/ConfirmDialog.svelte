<script lang="ts">
  import { fade, fly } from 'svelte/transition';
  import { dialog, popScrollLock, pushScrollLock } from '../lib/dialog.svelte';
  import Icon from './Icon.svelte';

  let modalEl: HTMLDivElement | undefined = $state();
  let downOnScrim = false;
  const titleId = `confirm-title-${Math.random().toString(36).slice(2)}`;
  const bodyId = `confirm-body-${Math.random().toString(36).slice(2)}`;

  function onkeydown(e: KeyboardEvent) {
    if (!dialog.current) return;
    if (e.key === 'Escape') {
      // stopImmediatePropagation, not stopPropagation: Modal listens on the
      // same window node and would otherwise still see this Escape and close.
      e.stopImmediatePropagation();
      dialog.settle(false);
      return;
    }
    if (e.key === 'Tab' && modalEl) {
      const focusables = modalEl.querySelectorAll<HTMLElement>('button');
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  // Focus is captured when the dialog opens and restored only when it closes.
  // Restoring on every effect re-run (e.g. when modalEl binds a tick later)
  // would yank focus back to the opener — which is the destructive button.
  let opener: HTMLElement | null = null;

  $effect(() => {
    if (!dialog.current) return;
    pushScrollLock();
    return popScrollLock;
  });

  $effect(() => {
    const open = dialog.current !== null;
    if (!open) {
      if (opener) {
        opener.focus?.();
        opener = null;
      }
      return;
    }
    if (!opener) opener = document.activeElement as HTMLElement | null;
    const el = modalEl;
    if (!el) return;
    requestAnimationFrame(() => {
      // Focus the safe action first so Enter never destroys data by accident.
      if (dialog.current) el.querySelector<HTMLElement>('[data-initial-focus]')?.focus();
    });
  });
</script>

<svelte:window onkeydown={onkeydown} />

{#if dialog.current}
  <div
    class="scrim"
    transition:fade={{ duration: 120 }}
    onpointerdown={(e) => (downOnScrim = e.target === e.currentTarget)}
    onclick={(e) => {
      if (downOnScrim && e.target === e.currentTarget) dialog.settle(false);
      downOnScrim = false;
    }}
    role="presentation"
  >
    <div
      class="dialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      tabindex="-1"
      bind:this={modalEl}
      transition:fly={{ y: 10, duration: 160 }}
    >
      <div class="badge" class:danger={dialog.current.tone === 'danger'} aria-hidden="true">
        <Icon name={dialog.current.tone === 'danger' ? 'alert' : 'info'} size={22} />
      </div>
      <h2 id={titleId}>{dialog.current.title}</h2>
      <div class="copy" id={bodyId}>
        <p>{dialog.current.message}</p>
        {#if dialog.current.detail}
          <p class="detail">{dialog.current.detail}</p>
        {/if}
      </div>
      <div class="actions">
        <button class="btn" data-initial-focus onclick={() => dialog.settle(false)}>
          {dialog.current.cancelLabel ?? 'Cancel'}
        </button>
        <button
          class="btn primary"
          class:danger-fill={dialog.current.tone === 'danger'}
          onclick={() => dialog.settle(true)}
        >
          {dialog.current.confirmLabel ?? 'Confirm'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 240;
    display: grid;
    place-items: center;
    padding: 1rem;
    background: var(--scrim);
    backdrop-filter: blur(2px);
  }
  .dialog {
    width: min(94vw, 420px);
    max-height: min(92vh, 34rem);
    overflow-y: auto;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius-l);
    box-shadow: var(--shadow-2);
    padding: var(--space-5);
    text-align: center;
  }
  .dialog:focus {
    outline: none;
  }
  .badge {
    display: grid;
    place-items: center;
    width: 3rem;
    height: 3rem;
    margin: 0 auto var(--space-3);
    border-radius: 50%;
    background: var(--brand-soft);
    color: var(--brand-strong);
  }
  .badge.danger {
    background: var(--danger-soft);
    color: var(--danger);
  }
  h2 {
    font-size: var(--text-xl);
    margin-bottom: var(--space-2);
  }
  .copy p {
    margin: 0;
    color: var(--muted);
    font-size: var(--text-sm);
    line-height: 1.55;
  }
  .copy .detail {
    margin-top: var(--space-2);
    font-size: var(--text-xs);
  }
  .actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
    margin-top: var(--space-5);
  }
  .actions:has(> :only-child) {
    grid-template-columns: 1fr;
  }
</style>
