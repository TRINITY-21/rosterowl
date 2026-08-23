// Structured-data and social-card helpers. Every tool page emits the same
// SoftwareApplication shape; only the name, url, and description differ, so the
// constant 12 lines live here once instead of being copy-pasted into each page.
import { ALL_TOOLS, ATTENDANCE_VARIANTS, PRINTABLES, SEATING_VARIANTS } from './tools';

export const SITE_URL = 'https://rosterowl.com';

/**
 * Routes that get a card of their own. Derived from the tool registry, so a new
 * tool in tools.ts gets a card path here and a rendered card from `npm run og`
 * without either list being edited. Everything else falls back to /og.png.
 */
export const OG_ROUTES: string[] = [
  '/',
  ...ALL_TOOLS.map((t) => t.href),
  ...SEATING_VARIANTS.map((v) => v.href),
  ...ATTENDANCE_VARIANTS.map((v) => v.href),
  PRINTABLES.href,
];

/** "/seating-chart/u-shape/" → "seating-chart-u-shape"; "/" → "home". */
export function ogSlug(path: string): string {
  const trimmed = path.replace(/^\/|\/$/g, '');
  return trimmed === '' ? 'home' : trimmed.replace(/\//g, '-');
}

/** The card for a page: its own if one is rendered, else the site-wide card. */
export function ogImageFor(path: string): string {
  return OG_ROUTES.includes(path) ? `/og/${ogSlug(path)}.png` : '/og.png';
}

export interface ToolSchemaInput {
  /** e.g. "RosterOwl Attendance Sheet Generator" */
  name: string;
  /** Site-absolute path with trailing slash, e.g. "/attendance/" */
  path: string;
  description: string;
}

export function toolJsonLd({ name, path, description }: ToolSchemaInput): string {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name,
    applicationCategory: 'EducationalApplication',
    operatingSystem: 'Any (web browser)',
    url: `${SITE_URL}${path}`,
    description,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  });
}

export interface FaqEntry {
  q: string;
  /** May carry inline emphasis for the rendered page; tags are stripped here. */
  a: string;
}

/**
 * FAQPage structured data so the tool FAQs can win rich results.
 *
 * Fed the same array Faq.astro renders, so the two can never disagree. The
 * answers are written for the page and occasionally carry an <em> or a <strong>;
 * the structured data wants the sentence, not the markup, so tags come out and
 * the whitespace they sat in is collapsed.
 */
export function faqJsonLd(entries: FaqEntry[]): string {
  const plain = (html: string) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: entries.map((e) => ({
      '@type': 'Question',
      name: plain(e.q),
      acceptedAnswer: { '@type': 'Answer', text: plain(e.a) },
    })),
  });
}
