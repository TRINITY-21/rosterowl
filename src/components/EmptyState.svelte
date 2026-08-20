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
    icon = 'users',
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
    <span class="empty-icon" aria-hidden="true"><Icon name={icon} size={compact ? 22 : 28} stroke={1.7} /></span>
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
    <button class="btn primary" type="button" onclick={onaction}>{actionLabel}</button>
  {/if}
</div>

<style>
  /* The glyph on its own. A tinted circle behind it added decoration without
     adding meaning, and echoed the icon chips the rest of the site dropped. */
  .empty-icon {
    display: block;
    margin-bottom: var(--space-3);
    color: var(--brand);
    line-height: 0;
  }

  .compact .empty-icon {
    margin-bottom: var(--space-2);
  }

  h3 {
    font-size: var(--text-xl);
  }
</style>
