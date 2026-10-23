<!-- Take attendance for one school day: tap a name to cycle Present → Absent → Late. -->
<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import { dateKey, dayState, flaggedNotMarked, stepSchoolDay, tally } from '../lib/attendance';
  import type { DayState } from '../lib/attendance';
  import { confirmDialog } from '../lib/dialog.svelte';
  import { orderedNames } from '../lib/names';
  import type { NameOrder } from '../lib/names';
  import Icon from './Icon.svelte';

  let { day, nameOrder, onday }: { day: Date; nameOrder: NameOrder; onday: (d: Date) => void } = $props();

  const CHIP: Record<DayState, string> = {
    present: 'Present',
    absent: 'Absent',
    late: 'Late',
    'not-enrolled': 'Not on roster yet',
  };

  const cls = $derived(app.activeClass);
  const key = $derived(dateKey(day));
  const isToday = $derived(key === dateKey(new Date()));
  const dayLabel = $derived(
    day.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
  );
  const prev = $derived(stepSchoolDay(day, -1, new Date()));
  const next = $derived(stepSchoolDay(day, 1, new Date()));
  const rows = $derived(cls ? orderedNames(cls.students, nameOrder) : []);
  const counts = $derived(cls ? tally(cls.attendance, key, cls.students) : null);
  // Only today has an "absent today" flag to reconcile with.
  const flagged = $derived(cls && isToday ? flaggedNotMarked(cls, key) : []);

  async function clear() {
    const ok = await confirmDialog({
      title: `Clear attendance for ${dayLabel}?`,
      message: 'The marks for this day are removed. Other days are untouched.',
      confirmLabel: 'Clear day',
    });
    if (ok) app.clearAttendanceDay(key);
  }
</script>

{#if cls}
  <section class="take-att" aria-labelledby="take-att-heading">
    <div class="att-head">
      <h2 id="take-att-heading">Take attendance</h2>
      <div class="att-day">
        <button
          type="button"
          class="att-step prev"
          aria-label="Previous school day"
          disabled={!prev}
          onclick={() => prev && onday(prev)}
        >
          <Icon name="chevron-down" size={16} />
        </button>
        <span class="att-date">
          {dayLabel}{#if isToday}<span class="att-today">{' · Today'}</span>{/if}
        </span>
        <button
          type="button"
          class="att-step next"
          aria-label="Next school day"
          disabled={!next}
          onclick={() => next && onday(next)}
        >
          <Icon name="chevron-down" size={16} />
        </button>
      </div>
    </div>

    {#if flagged.length > 0}
      <p class="att-hint">
        <span>
          Flagged absent in your other tools:
          {flagged.map((s) => `${s.first} ${s.last}`.trim()).join(', ')}
        </span>
        <button type="button" class="btn small" onclick={() => app.markFlaggedAbsentToday(key)}>
          Mark them absent
        </button>
      </p>
    {/if}

    <ul class="att-list">
      {#each rows as row (row.student.id)}
        {@const state = dayState(cls.attendance, key, row.student.id)}
        <li>
          <button
            type="button"
            class="att-row"
            data-state={state}
            aria-label="{row.label}: {CHIP[state]}. Tap to change."
            onclick={() => app.tapAttendance(key, row.student.id)}
          >
            <span class="att-name">{row.label}</span>
            <span class="att-chip">{CHIP[state]}</span>
          </button>
        </li>
      {/each}
    </ul>

    <div class="att-foot">
      {#if counts?.taken}
        <span class="att-tally" role="status">
          {counts.present} present · {counts.absent} absent · {counts.late} late
        </span>
        <button type="button" class="btn quiet small" onclick={clear}>Clear this day</button>
      {:else}
        <span class="att-note">Not taken yet — tap anyone absent or late, or</span>
        <button type="button" class="btn small" onclick={() => app.markEveryonePresent(key)}>
          Everyone's here
        </button>
      {/if}
    </div>
  </section>
{/if}

<style>
  .take-att {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding-bottom: var(--space-4);
    border-bottom: 1px solid var(--line);
  }

  .att-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  h2 {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--muted);
  }

  .att-day {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .att-date {
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--ink);
    white-space: nowrap;
  }

  .att-today {
    color: var(--muted);
    font-weight: 400;
  }

  .att-step {
    display: inline-grid;
    place-items: center;
    width: 2.75rem;
    height: 2.75rem;
    border: 0;
    border-radius: var(--radius-s);
    background: none;
    color: var(--ink);
    cursor: pointer;
  }

  .att-step.prev :global(svg) {
    transform: rotate(90deg);
  }

  .att-step.next :global(svg) {
    transform: rotate(-90deg);
  }

  .att-step:hover:not(:disabled) {
    background: color-mix(in srgb, var(--ink) 6%, transparent);
  }

  .att-step:disabled {
    color: var(--line-strong);
    cursor: default;
  }

  .att-hint {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border: 1px solid color-mix(in srgb, var(--warn) 40%, var(--line));
    border-radius: var(--radius-s);
    background: var(--warn-soft);
    color: var(--warn);
    font-size: var(--text-xs);
    font-weight: 700;
  }

  .att-list {
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: 1px solid var(--line);
  }

  .att-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    width: 100%;
    min-height: 2.75rem;
    padding: 0.35rem 0.25rem;
    border: 0;
    border-bottom: 1px solid var(--line);
    background: none;
    color: var(--ink);
    font: inherit;
    font-size: var(--text-sm);
    text-align: left;
    cursor: pointer;
  }

  .att-row:hover {
    background: color-mix(in srgb, var(--ink) 4%, transparent);
  }

  .att-name {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .att-chip {
    flex: none;
    padding: 0.1rem 0.5rem;
    border: 1px solid transparent;
    border-radius: 999px;
    font-size: var(--text-xs);
    font-weight: 700;
    color: var(--muted);
  }

  .att-row[data-state='absent'] .att-chip {
    background: color-mix(in srgb, var(--g-coral) 24%, var(--surface));
    border-color: color-mix(in srgb, var(--g-coral) 60%, var(--surface));
    color: var(--ink);
  }

  .att-row[data-state='late'] .att-chip {
    background: color-mix(in srgb, var(--g-gold) 26%, var(--surface));
    border-color: color-mix(in srgb, var(--g-gold) 60%, var(--surface));
    color: var(--ink);
  }

  .att-row[data-state='not-enrolled'] {
    color: var(--muted);
  }

  .att-row[data-state='not-enrolled'] .att-chip {
    border-style: dashed;
    border-color: var(--line-strong);
    font-weight: 400;
  }

  .att-foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-xs);
    color: var(--muted);
  }

  .att-tally {
    font-weight: 700;
    color: var(--ink);
  }
</style>
