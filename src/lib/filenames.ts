// One definition of "safe download filename", shared by every PDF module and by
// the components that build a filename inline. Previously this logic existed in
// eight near-identical copies, two of which were missing the control-character
// and leading-dot guards.

/** Characters no mainstream filesystem accepts, plus C0 control codes. */
// eslint-disable-next-line no-control-regex
const UNSAFE = /[/\\:*?"<>|\u0000-\u001f]/g;

/**
 * Strip unsafe characters, collapse whitespace, and refuse a leading dot
 * (which would make a hidden file on Unix).
 *
 * @param fallback returned when the cleaned string is empty.
 */
export function safeFilename(input: string, fallback = 'Class'): string {
  const cleaned = input
    .replace(UNSAFE, '')
    .replace(/\s+/g, ' ')
    .trim()
    // After trimming, so " .Period 1" cannot slip through as a hidden file.
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
    .trim();
  return cleaned.length > 0 ? cleaned : fallback;
}

/*
 * The download name for each tool's PDF.
 *
 * These live here rather than beside their renderers so a component can label a
 * download button without importing pdf-lib. The renderers are dynamically
 * imported precisely to keep that weight off first paint, and a static import
 * for the sake of a filename would have undone it.
 */

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];

export function chartPdfFilename(className: string, date: Date = new Date()): string {
  const base = safeFilename(className, 'Seating chart');
  return `${base} — ${MONTHS_SHORT[date.getMonth()]} ${date.getFullYear()}.pdf`;
}

export function groupsPdfFilename(className: string): string {
  return `${safeFilename(className)} — groups.pdf`;
}

export function jobsPdfFilename(className: string): string {
  return `${safeFilename(className)} — Jobs chart.pdf`;
}

export function bingoPdfFilename(className: string): string {
  return `${safeFilename(className)} — Bingo cards.pdf`;
}

export function certsPdfFilename(className: string, award: string): string {
  return `${safeFilename(className)} — ${safeFilename(award, 'Certificates')}.pdf`;
}

export function checklistPdfFilename(className: string, title: string): string {
  return `${safeFilename(className)} — ${safeFilename(title, 'Checklist')}.pdf`;
}

export function attendancePdfFilename(className: string, year: number, month: number): string {
  return `${safeFilename(className)} — Attendance ${MONTH_NAMES[month] ?? ''} ${year}.pdf`;
}

export function nameTagsPdfFilename(className: string, style: 'desk-plate' | 'badge-8up'): string {
  const label = style === 'desk-plate' ? 'Desk plates' : 'Name tags';
  return `${safeFilename(className)} — ${label}.pdf`;
}

export function flashcardsPdfFilename(className: string, mode: 'names' | 'custom'): string {
  const label = mode === 'names' ? 'Name cards' : 'Flashcards';
  return `${safeFilename(className)} — ${label}.pdf`;
}
