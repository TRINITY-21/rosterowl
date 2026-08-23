// The one place the tool suite is described. The header panel, the landing page
// index, and the footer all read this, so a new tool is added once and appears
// in all three — and the three can never drift apart again.
import type { IconName } from '../components/Icon.svelte';

export interface Tool {
  href: string;
  /** Short label: header panel, footer, breadcrumbs. */
  label: string;
  /** Full name: the landing page index. */
  title: string;
  icon: IconName;
  /** One line, header-panel length — what the teacher walks away with. */
  blurb: string;
  /** The longer landing-page description. */
  copy: string;
}

export interface ToolGroup {
  /** Used as an id fragment, so keep it slug-safe. */
  key: string;
  label: string;
  tools: Tool[];
}

/** The flagship. Called out on its own everywhere it appears. */
export const SEATING: Tool = {
  href: '/seating-chart/',
  label: 'Seating chart',
  title: 'Seating chart maker',
  icon: 'grid',
  blurb: 'Match your real room, keep the chatty kids apart',
  copy: 'Rebuild your real room — table groups, stray pairs, gaps and all — set keep-apart rules, and shuffle. Prints perfectly on one page.',
};

/** Pre-configured seating pages. Each is a working tool, not a doorway page. */
export const SEATING_VARIANTS = [
  { href: '/seating-chart/table-groups-of-4/', label: 'Table groups of 4' },
  { href: '/seating-chart/u-shape/', label: 'U-shape / horseshoe' },
  { href: '/seating-chart/keep-students-apart/', label: 'Keep students apart' },
  { href: '/seating-chart/for-substitutes/', label: 'For substitutes' },
  { href: '/seating-chart/templates/', label: 'Blank seating charts' },
] as const;

/**
 * Pre-configured attendance pages, added after Search Console showed the tool
 * ranking for "attendance roster" — a phrase the page never used — while its
 * own "attendance sheet" wording earned nothing. Same rule as the seating
 * variants: each is a working tool answering a different situation, not a
 * doorway page with a swapped heading.
 */
export const ATTENDANCE_VARIANTS = [
  { href: '/attendance/blank-attendance-roster/', label: 'Blank attendance roster' },
  { href: '/attendance/class-attendance-roster/', label: 'One roster per class' },
  { href: '/attendance/for-substitutes/', label: 'For substitutes' },
] as const;

/** The blank-printables hub. Linked wherever the variants are. */
export const PRINTABLES = { href: '/printables/', label: 'Blank printables' } as const;

export const TOOL_GROUPS: ToolGroup[] = [
  {
    key: 'plan',
    label: 'Plan the room',
    tools: [SEATING],
  },
  {
    key: 'split',
    label: 'Split the class',
    tools: [
      {
        href: '/group-maker/',
        label: 'Group maker',
        title: 'Group maker',
        icon: 'users',
        blurb: 'Balanced teams that honor your keep-apart rules',
        copy: 'Split the class into balanced groups that honor your keep-apart rules.',
      },
      {
        href: '/picker/',
        label: 'Student picker',
        title: 'Student picker',
        icon: 'shuffle',
        blurb: 'Fair cold-calling, nobody picked twice',
        copy: "Fair cold-calling: no repeats until everyone's had a turn, absent students skipped.",
      },
      {
        href: '/jobs-chart/',
        label: 'Jobs chart',
        title: 'Classroom jobs chart',
        icon: 'restore',
        blurb: 'Class jobs that rotate fairly, every week',
        copy: 'Assign class jobs and rotate fairly — every job changes hands, everyone gets equal turns.',
      },
    ],
  },
  {
    key: 'print',
    label: 'Print & hand out',
    tools: [
      {
        href: '/certificates/',
        label: 'Certificates',
        title: 'Award certificates',
        icon: 'sparkle',
        blurb: 'One PDF, a certificate for every student',
        copy: 'One click: a certificate for every student on your roster, as a single PDF.',
      },
      {
        href: '/name-tags/',
        label: 'Name tags',
        title: 'Name tags & desk plates',
        icon: 'tag',
        blurb: 'Desk plates and Avery-style badge sheets',
        copy: 'A tag for every student in one PDF — desk plates or Avery-style badge sheets, cut guides included.',
      },
      {
        href: '/checklist/',
        label: 'Checklist',
        title: 'Class checklist',
        icon: 'check',
        blurb: 'Names down the side, your columns across',
        copy: 'Names down the side, your columns across the top — the grid you keep rebuilding in Excel, in one click.',
      },
      {
        href: '/attendance/',
        label: 'Attendance',
        title: 'Attendance roster',
        icon: 'printer',
        blurb: "The month's real school days, pre-built",
        copy: "The month's real school days across the top, your class down the side — the attendance roster, rebuilt in one click.",
      },
      {
        href: '/bingo/',
        label: 'Bingo cards',
        title: 'Bingo cards',
        icon: 'hash',
        blurb: 'A unique card for every player',
        copy: "A unique card for every student from classmate names or your own word list — caller's list included.",
      },
      {
        href: '/flashcards/',
        label: 'Flashcards',
        title: 'Flashcards & name cards',
        icon: 'layers',
        blurb: 'Names or word lists as bold printable cards',
        copy: 'Names or any word list as bold printable cards in three sizes — name jar, word wall, sight words.',
      },
    ],
  },
];

/** Flat list, in menu order. */
export const ALL_TOOLS: Tool[] = TOOL_GROUPS.flatMap((g) => g.tools);

/**
 * The tool a pathname belongs to, for `aria-current`. Sub-pages count as their
 * parent tool (/seating-chart/u-shape/ marks the seating chart active), but the
 * bare "/" never does — every href would prefix-match it.
 */
export function activeToolHref(pathname: string): string | null {
  return ALL_TOOLS.find((t) => pathname.startsWith(t.href))?.href ?? null;
}
