<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon, { type IconName } from './Icon.svelte';

  let {
    title,
    compact = false,
    actionLabel,
    onaction,
    href,
    /** Icon shown above the title. Set to null for a bare empty state. */
    icon = 'info',
    /**
     * Heading level to render. Defaults to 2; pass 3 when this sits inside a
     * section that already owns an h2, so heading order stays legal.
     */
    level = 2,
    children,
  }: {
    title: string;
    compact?: boolean;
    actionLabel?: string;
    onaction?: () => void;
    href?: string;
    icon?: IconName | null;
    level?: 2 | 3;
    children: Snippet;
  } = $props();
</script>

<div class="tool-empty" class:compact>
  {#if icon}
    <span class="empty-icon" aria-hidden="true"><Icon name={icon} size={compact ? 20 : 24} /></span>
  {/if}
  {#if level === 3}
    <h3>{title}</h3>
  {:else}
    <h2>{title}</h2>
  {/if}
  <div class="copy">{@render children()}</div>
  {#if href && actionLabel}
    <a class="btn primary" href={href}>{actionLabel}</a>
  {:else if actionLabel}
    <button class="btn primary" onclick={onaction}>{actionLabel}</button>
  {/if}
</div>

<style>
  .empty-icon {
    display: inline-grid;
    place-items: center;
    width: 3rem;
    height: 3rem;
    margin-bottom: var(--space-3);
    border-radius: 50%;
    background: var(--brand-soft);
    color: var(--brand-strong);
  }

  .compact .empty-icon {
    width: 2.4rem;
    height: 2.4rem;
    margin-bottom: var(--space-2);
  }

  h3 {
    font-size: var(--text-xl);
  }
</style>
