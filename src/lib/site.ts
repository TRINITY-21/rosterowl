// The non-tool pages, in one place — the same job tools.ts does for the suite.
// The footer and the header both read this, so adding a page is one edit and the
// two can never drift apart.

/** Split so the address can be reassembled in the page and skipped by scrapers. */
export const CONTACT = { user: 'hello', domain: 'rosterowl.com' } as const;
export const CONTACT_EMAIL = `${CONTACT.user}@${CONTACT.domain}`;

export interface SitePage {
  href: string;
  label: string;
}

/** Shown in the footer's last column and in the header's Tools panel foot. */
export const SITE_PAGES: SitePage[] = [
  { href: '/about/', label: 'About' },
  { href: '/privacy/', label: 'Privacy Policy' },
  { href: '/contact/', label: 'Contact' },
  { href: '/terms/', label: 'Terms' },
];
