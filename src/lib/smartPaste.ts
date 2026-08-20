// Smart paste: turn ANY pasted roster text — a Google Classroom People page,
// a gradebook column, an email list, an SIS export — into ParsedName rows.
// Framework-free; csv.ts reuses the exported helpers.

export interface ParsedName {
  first: string;
  last: string;
  /** The original text this entry was parsed from. */
  raw: string;
}

// ---------------------------------------------------------------------------
// Case normalization
// ---------------------------------------------------------------------------

/** Capitalize the first letter and any letter following an apostrophe or hyphen. */
function titleCaseWord(word: string): string {
  return word.toLowerCase().replace(/(^|['’-])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}

/**
 * ALLCAPS / all-lowercase words become Title Case; mixed-case words are kept
 * verbatim so intentional interior capitals (McKenna, DiAngelo, O'Brien) survive.
 */
export function normalizeCase(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((w) => {
      if (!/\p{L}/u.test(w)) return w;
      if (w === w.toUpperCase() || w === w.toLowerCase()) return titleCaseWord(w);
      return w;
    })
    .join(' ');
}

// ---------------------------------------------------------------------------
// Name splitting
// ---------------------------------------------------------------------------

/** "Mary Jane Watson" -> first "Mary", last "Jane Watson". Single token -> last ''. */
export function splitFullName(text: string): { first: string; last: string } {
  const tokens = normalizeCase(text).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { first: '', last: '' };
  return { first: tokens[0], last: tokens.slice(1).join(' ') };
}

/** True for "Word, Word(s)" — a single word, one comma, then at least one word. */
export function looksLastFirst(text: string): boolean {
  const parts = text.split(',');
  if (parts.length !== 2) return false;
  const left = parts[0].trim();
  const right = parts[1].trim();
  return left.length > 0 && !/\s/.test(left) && /\p{L}/u.test(left) && /\p{L}/u.test(right);
}

/** "Watson, Mary Jane" -> first "Mary Jane", last "Watson". */
export function swapLastFirst(text: string): { first: string; last: string } {
  const i = text.indexOf(',');
  return {
    first: normalizeCase(text.slice(i + 1)),
    last: normalizeCase(text.slice(0, i)),
  };
}

// ---------------------------------------------------------------------------
// Emails
// ---------------------------------------------------------------------------

export function isEmail(token: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(token);
}

/** "jane.doe2@school.org" -> { first: "Jane", last: "Doe" }. */
export function nameFromEmail(email: string): { first: string; last: string } {
  const local = (email.split('@')[0] ?? '').replace(/^mailto:/i, '');
  const parts = local
    .split(/[._+\-]+/)
    .map((p) => p.replace(/\d+/g, ''))
    .filter(Boolean);
  if (parts.length === 0) return { first: '', last: '' };
  return { first: titleCaseWord(parts[0]), last: parts.slice(1).map(titleCaseWord).join(' ') };
}

/** Does this email's local part plausibly belong to the given name? */
function emailMatchesName(email: string, n: { first: string; last: string }): boolean {
  const letters = (s: string): string => s.toLowerCase().replace(/[^a-z]/g, '');
  const local = letters(email.split('@')[0] ?? '');
  const f = letters(n.first);
  const l = letters(n.last);
  if (!local || !f) return false;
  const candidates = [f + l, l + f, f, f[0] + l, l ? f + l[0] : ''];
  return candidates.some((c) => c !== '' && c === local);
}

// ---------------------------------------------------------------------------
// Header rows and junk cells
// ---------------------------------------------------------------------------

const HEADER_WORDS = new Set([
  'name', 'first', 'last', 'student', 'students', 'full', 'middle', 'initial',
  'email', 'emails', 'e-mail', 'mail', 'id', 'ids', 'no', 'num', 'number', '#',
  'grade', 'level', 'period', 'homeroom', 'room', 'class', 'teacher', 'section',
  'dob', 'gender', 'notes',
]);

/** True when every filled cell reads as a column header ("Name", "Student ID", …). */
export function isHeaderRow(cells: string[]): boolean {
  const filled = cells.map((c) => c.trim()).filter(Boolean);
  if (filled.length === 0) return false;
  let sawWord = false;
  for (const cell of filled) {
    const words = cell
      .toLowerCase()
      .split(/\s+/)
      .map((w) => w.replace(/[^a-z#-]/g, ''))
      .filter(Boolean);
    if (words.length === 0) return false;
    for (const w of words) {
      if (!HEADER_WORDS.has(w)) return false;
      sawWord = true;
    }
  }
  return sawWord;
}

/** A single token that is an id, date, grade ("3rd", "P2", "B+") or letterless noise. */
function isJunkToken(tok: string): boolean {
  if (!/\p{L}/u.test(tok)) return true;
  if (/\d/.test(tok)) return true;
  if (/^[A-Fa-f][+-]$/.test(tok)) return true;
  return false;
}

/**
 * Strip junk tokens from one comma-segment and return what is left, or '' when
 * the segment carried no name at all.
 *
 * Filtering per TOKEN rather than per segment matters: gradebooks routinely
 * paste "Ava Martinez 10231", where a single space separates the name from the
 * student id. A segment-level digit test would discard that whole line and the
 * student would vanish silently.
 *
 * A segment whose surviving words are all column-header vocabulary ("Grade 4",
 * "Homeroom 12") is still junk — otherwise stripping the number would promote
 * the label itself into a name.
 */
function cleanSegment(seg: string): string {
  const kept = seg
    .trim()
    .split(/\s+/)
    .filter((tok) => tok !== '' && !isJunkToken(tok));
  if (kept.length === 0) return '';
  const allHeaderish = kept.every((tok) => {
    const word = tok.toLowerCase().replace(/[^a-z#-]/g, '');
    return word === '' || HEADER_WORDS.has(word);
  });
  return allHeaderish ? '' : kept.join(' ');
}

/** "1.", "12)", "(3)", "-", "•", "*" prefixes. */
const LIST_MARKER = /^(?:\(?#?\d{1,4}\s*[.):\]]\s*|[•●◦▪·*]+\s*|[-–—]\s+)/;

// ---------------------------------------------------------------------------
// parseRoster
// ---------------------------------------------------------------------------

interface PreparedLine {
  raw: string;
  kind: 'text' | 'email';
  value: string;
}

export function parseRoster(text: string): ParsedName[] {
  const prepared: PreparedLine[] = [];

  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    const line = trimmed.replace(LIST_MARKER, '').trim();
    if (!line) continue;
    if (isHeaderRow(line.split(/[,;\t]+|\s{2,}/))) continue;

    // Columns are tab- or multi-space-separated; single spaces stay inside a cell.
    const cells = line.split(/\t+|\s{2,}/);
    const nameCells: string[] = [];
    const emails: string[] = [];
    for (const cell of cells) {
      const keptTokens: string[] = [];
      for (const tok of cell.split(/\s+/)) {
        const bare = tok
          .replace(/^[<("'[]+/, '')
          .replace(/[>)"'\],;]+$/, '')
          .replace(/^mailto:/i, '');
        if (bare.includes('@')) {
          if (isEmail(bare)) emails.push(bare);
          continue;
        }
        if (tok) keptTokens.push(tok);
      }
      const cellText = keptTokens.join(' ').trim();
      if (!cellText) continue;
      // Junk is filtered token by token inside each comma-segment, so a student
      // id one space away from the name can never discard the student.
      const segs = cellText
        .split(',')
        .map((s) => cleanSegment(s))
        .filter((s) => s !== '');
      if (segs.length > 0) nameCells.push(segs.join(', '));
    }

    if (nameCells.length > 0) prepared.push({ raw: trimmed, kind: 'text', value: nameCells.join(' ') });
    else if (emails.length > 0) prepared.push({ raw: trimmed, kind: 'email', value: emails[0] });
  }

  // Corpus-level vote: majority of comma-bearing lines shaped "Word, Word(s)"
  // means the whole paste is "Last, First".
  const commaLines = prepared.filter((p) => p.kind === 'text' && p.value.includes(','));
  const lfCount = commaLines.filter((p) => looksLastFirst(p.value)).length;
  const lastFirstMode = lfCount > 0 && lfCount * 2 > commaLines.length;

  const out: ParsedName[] = [];
  let prevLineNames: { first: string; last: string }[] = [];
  let prevLineKind: 'text' | 'email' | null = null;

  for (const p of prepared) {
    if (p.kind === 'email') {
      // An email right after a matching name line is that student's address
      // (Google Classroom pastes), not a new student.
      if (prevLineKind === 'text' && prevLineNames.some((m) => emailMatchesName(p.value, m))) continue;
      const n = nameFromEmail(p.value);
      if (!n.first && !n.last) continue;
      out.push({ ...n, raw: p.raw });
      prevLineNames = [n];
      prevLineKind = 'email';
      continue;
    }

    const names: ParsedName[] = [];
    if (lastFirstMode && looksLastFirst(p.value)) {
      names.push({ ...swapLastFirst(p.value), raw: p.raw });
    } else if (p.value.includes(',')) {
      // "John Smith, Jane Doe, Ali Khan" — a comma-separated list of full names.
      for (const seg of p.value.split(',')) {
        const t = seg.trim();
        if (t) names.push({ ...splitFullName(t), raw: t });
      }
    } else {
      names.push({ ...splitFullName(p.value), raw: p.raw });
    }
    out.push(...names);
    prevLineNames = names;
    prevLineKind = 'text';
  }

  return out;
}
