<script lang="ts">
  /**
   * The account control for optional cloud sync.
   *
   * Quiet by design. Signed out it is a single outline-cloud button that
   * explains itself before it asks for anything — the site's promise is that it
   * works with no account, and a permanent "Sign in" call to action in the
   * toolbar would contradict that on every page. Signed in it becomes a status
   * dot, because the only thing a teacher wants from sync is to know it worked.
   */
  import { app } from '../lib/appState.svelte';
  import { sync } from '../lib/sync.svelte';
  import Icon from './Icon.svelte';

  let open = $state(false);
  let menu = $state<HTMLDetailsElement | null>(null);
  /**
   * Confirmation is inline rather than a modal. ConfirmDialog has a single host
   * component and only the seating chart renders one, so calling it from here
   * would do nothing on the other nine tools — and adding a second host would
   * stack two modals over the same pending request.
   */
  let confirmingDelete = $state(false);

  const label = $derived.by(() => {
    switch (sync.status) {
      case 'syncing':
        return 'Syncing…';
      case 'offline':
        return 'Offline — will sync when you reconnect';
      case 'error':
        return "Couldn't reach sync — your work is safe on this device";
      case 'idle':
        return sync.lastSyncedAt ? `Synced ${relative(sync.lastSyncedAt)}` : 'Synced';
      default:
        return 'Sync across your devices';
    }
  });

  function relative(ts: number): string {
    const secs = Math.round((Date.now() - ts) / 1000);
    if (secs < 60) return 'just now';
    const mins = Math.round(secs / 60);
    if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
    const hours = Math.round(mins / 60);
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }

  function close() {
    open = false;
    confirmingDelete = false;
    if (menu) menu.open = false;
  }

  async function deleteCloudCopy() {
    confirmingDelete = false;
    close();
    await sync.forgetCloud();
  }
</script>

<details class="sync" bind:this={menu} bind:open>
  <summary
    class="btn quiet"
    class:on={sync.signedIn}
    data-status={sync.status}
    title={label}
    aria-label={label}
  >
    <Icon name={sync.status === 'offline' || sync.status === 'error' ? 'cloud-off' : 'cloud'} size={17} />
    {#if sync.signedIn}
      <span class="dot" aria-hidden="true"></span>
    {/if}
  </summary>

  <div class="pop">
    {#if sync.signedIn}
      <p class="who">{sync.email}</p>
      <p class="state">{label}</p>
      <hr />
      <button class="item" onclick={() => { close(); void sync.pull(); }}>
        <Icon name="restore" size={15} /> Sync now
      </button>
      <button class="item" onclick={() => { close(); void sync.signOut(); }}>
        <Icon name="upload" size={15} /> Sign out of sync
      </button>
      <hr />
      {#if confirmingDelete}
        <p class="fine">
          Your classes stay on this device — this only removes the copy used to sync. Other
          devices keep whatever they already have.
        </p>
        <div class="confirm">
          <button class="btn small danger-fill" onclick={deleteCloudCopy}>Delete cloud copy</button>
          <button class="btn small" onclick={() => (confirmingDelete = false)}>Cancel</button>
        </div>
      {:else}
        <button class="item danger" onclick={() => (confirmingDelete = true)}>
          <Icon name="trash" size={15} /> Delete cloud copy
        </button>
      {/if}
    {:else}
      <p class="pitch">
        <strong>Continue on another computer.</strong>
        Sign in and RosterOwl keeps a copy of your classes, so the chart you started at school
        is waiting for you at home.
      </p>
      <p class="fine">
        Optional. Without it, everything stays on this device and nothing is uploaded —
        <a href="/privacy/">what gets stored</a>.
      </p>
      <button class="btn primary full" onclick={() => sync.signIn()}>
        Continue with Google
      </button>
      <button
        class="item"
        onclick={() => {
          close();
          app.downloadBackup();
        }}
      >
        <Icon name="download" size={15} /> Or save a backup file instead
      </button>
    {/if}
  </div>
</details>

<style>
  .sync {
    position: relative;
  }
  summary {
    list-style: none;
    position: relative;
    color: var(--muted);
  }
  summary::-webkit-details-marker {
    display: none;
  }
  summary.on {
    color: var(--brand);
  }
  /* The whole status readout: green settled, amber in flight, grey unreachable. */
  .dot {
    position: absolute;
    right: 5px;
    bottom: 5px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--ok);
    box-shadow: 0 0 0 2px var(--surface);
  }
  summary[data-status='syncing'] .dot {
    background: var(--accent);
  }
  summary[data-status='offline'] .dot,
  summary[data-status='error'] .dot {
    background: var(--line-strong);
  }

  .pop {
    position: absolute;
    right: 0;
    top: calc(100% + 0.4rem);
    z-index: 30;
    width: 19rem;
    padding: var(--space-3);
    border: var(--rule-strong);
    border-radius: var(--radius-m);
    background: var(--surface);
    box-shadow: var(--shadow-2);
    text-align: left;
  }
  .who {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: 700;
    overflow-wrap: anywhere;
  }
  .state,
  .fine {
    margin: 0.15rem 0 0;
    font-size: var(--text-xs);
    color: var(--muted);
  }
  .pitch {
    margin: 0 0 var(--space-2);
    font-size: var(--text-sm);
    color: var(--muted);
  }
  .pitch strong {
    display: block;
    color: var(--ink);
  }
  .fine {
    margin-bottom: var(--space-3);
  }
  .full {
    width: 100%;
  }
  hr {
    height: 0;
    margin: var(--space-2) 0;
    border: none;
    border-top: var(--rule);
  }
  .item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.5rem;
    margin-top: 0.15rem;
    border: none;
    border-radius: var(--radius-s);
    background: none;
    color: var(--ink);
    font: inherit;
    font-size: var(--text-sm);
    text-align: left;
    cursor: pointer;
  }
  .item:hover {
    background: var(--surface-2);
  }
  .item.danger {
    color: var(--danger);
  }
  .item.danger:hover {
    background: var(--danger-soft);
  }
  .confirm {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }
</style>
