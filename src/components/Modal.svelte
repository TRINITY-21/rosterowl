<script lang="ts">
  import type { Snippet } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { dialog, popScrollLock, pushScrollLock } from '../lib/dialog.svelte';
  import Icon from './Icon.svelte';

  let {
    title,
    onclose,
    wide = false,
    children,
  }: { title: string; onclose: () => void; wide?: boolean; children: Snippet } = $props();

  let modalEl: HTMLDivElement | undefined = $state();
  const titleId = `dialog-title-${Math.random().toString(36).slice(2)}`;
  // Scrim click closes only if the press ALSO started on the scrim — otherwise
  // a text-selection drag that ends past the modal edge would nuke the dialog.
  let downOnScrim = false;

  function onkeydown(e: KeyboardEvent) {
    // A confirm dialog stacked on top owns the keyboard.
    if (dialog.current) return;
    if (e.key === 'Escape') {
      onclose();
      return;
    }
    // Minimal focus trap.
    if (e.key === 'Tab' && modalEl) {
      // Disabled and display:none matches are not focusable — including them
      // let Tab walk straight out of the dialog.
      const focusables = [
        ...modalEl.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        ),
      ].filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
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

  $effect(() => {
    pushScrollLock();
    return popScrollLock;
  });

  $effect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const scrim: HTMLElement | null | undefined = modalEl?.parentElement;
    const siblings: Array<{ element: HTMLElement; wasInert: boolean }> = [];
    let branch: HTMLElement | null | undefined = scrim;
    while (branch?.parentElement) {
      for (const sibling of Array.from(branch.parentElement.children)) {
        if (sibling === branch || !(sibling instanceof HTMLElement)) continue;
        siblings.push({ element: sibling, wasInert: sibling.inert });
        sibling.inert = true;
      }
      if (branch.parentElement === document.body) break;
      branch = branch.parentElement;
    }
    requestAnimationFrame(() => {
      // Focus lands a frame late, by which time a fast typist (or a paste into
      // a different field) may already be somewhere inside the dialog. Stealing
      // focus then would redirect their keystrokes to the wrong input.
      if (modalEl?.contains(document.activeElement)) return;
      const preferred = modalEl?.querySelector<HTMLElement>('[autofocus]');
      const first = [
        ...(modalEl?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        ) ?? []),
      ].find((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
      (preferred ?? first ?? modalEl)?.focus();
    });
    return () => {
      for (const { element, wasInert } of siblings) element.inert = wasInert;
      prev?.focus?.();
    };
  });
</script>

<svelte:window {onkeydown} />

<div
  class="scrim"
  transition:fade={{ duration: 120 }}
  onpointerdown={(e) => (downOnScrim = e.target === e.currentTarget)}
  onclick={(e) => {
    if (downOnScrim && e.target === e.currentTarget) onclose();
    downOnScrim = false;
  }}
  role="presentation"
>
  <div
    class="modal"
    class:wide
    role="dialog"
    aria-modal="true"
    aria-labelledby={titleId}
    tabindex="-1"
    bind:this={modalEl}
    transition:fly={{ y: 14, duration: 160 }}
  >
    <header>
      <h2 id={titleId}>{title}</h2>
      <button class="btn quiet small" onclick={onclose} aria-label="Close">
        <Icon name="close" size={17} />
      </button>
    </header>
    <div class="body">
      {@render children()}
    </div>
  </div>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: var(--scrim);
    backdrop-filter: blur(2px);
    display: grid;
    place-items: center;
    padding: 1rem;
    z-index: 200;
  }
  .modal {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius-l);
    box-shadow: var(--shadow-2);
    width: min(96vw, 560px);
    max-height: min(92vh, 780px);
    display: flex;
    flex-direction: column;
  }
  .modal.wide {
    width: min(96vw, 760px);
  }
  .modal:focus {
    outline: none;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-5) var(--space-2);
  }
  h2 {
    font-size: var(--text-xl);
  }
  .body {
    padding: var(--space-2) var(--space-5) var(--space-5);
    overflow-y: auto;
  }
</style>
