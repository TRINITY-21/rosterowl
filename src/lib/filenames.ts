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
