// Structured-data helpers. Every tool page emits the same SoftwareApplication
// shape; only the name, url, and description differ, so the constant 12 lines
// live here once instead of being copy-pasted into each page.

export const SITE_URL = 'https://rosterowl.com';

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
  a: string;
}

/** FAQPage structured data so the tool FAQs can win rich results. */
export function faqJsonLd(entries: FaqEntry[]): string {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: entries.map((e) => ({
      '@type': 'Question',
      name: e.q,
      acceptedAnswer: { '@type': 'Answer', text: e.a },
    })),
  });
}
