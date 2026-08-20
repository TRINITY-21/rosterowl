// CSV roster import. Papaparse handles delimiter auto-detection (comma,
// semicolon, tab) and quoting; column selection and name normalization
// reuse the smartPaste helpers so both importers behave identically.

import { parse } from 'papaparse';
import type { ParsedName } from './smartPaste';
import {
  isHeaderRow,
  looksLastFirst,
  nameFromEmail,
  normalizeCase,
  parseRoster,
  splitFullName,
  swapLastFirst,
} from './smartPaste';

export function parseCsvRoster(text: string): ParsedName[] {
  const src = text.replace(/^\uFEFF/, '').trim();
  if (!src) return [];

  const result = parse<string[]>(src, { skipEmptyLines: 'greedy' });
  const rows = result.data
    .map((r) => r.map((c) => (c ?? '').trim()))
    .filter((r) => r.some((c) => c !== ''));
  if (rows.length === 0) return [];

  const header = isHeaderRow(rows[0]) ? rows[0].map((c) => c.toLowerCase()) : null;
  if (!header) {
    // No header — the smart-paste pipeline already handles bare rows.
    return parseRoster(rows.map((r) => r.join('\t')).join('\n'));
  }

  const data = rows.slice(1);
  const firstIdx = header.findIndex((c) => c.includes('first'));
  const lastIdx = header.findIndex((c) => c.includes('last'));
  const nameIdx = header.findIndex(
    (c) =>
      (/(^|\s)name\b/.test(c) && !c.includes('first') && !c.includes('last')) ||
      c === 'student' ||
      c === 'students',
  );
  const emailIdx = header.findIndex((c) => c.includes('mail'));

  const out: ParsedName[] = [];
  const cell = (row: string[], i: number): string => (i >= 0 ? (row[i] ?? '').trim() : '');
  const pushEmail = (row: string[]): void => {
    const e = cell(row, emailIdx);
    if (!e) return;
    const n = nameFromEmail(e);
    if (n.first || n.last) out.push({ ...n, raw: e });
  };

  if (firstIdx >= 0 && lastIdx >= 0) {
    for (const row of data) {
      const f = cell(row, firstIdx);
      const l = cell(row, lastIdx);
      if (!f && !l) {
        pushEmail(row);
        continue;
      }
      out.push({ first: normalizeCase(f), last: normalizeCase(l), raw: [f, l].filter(Boolean).join(' ') });
    }
    return out;
  }

  if (nameIdx >= 0) {
    const values = data.map((row) => cell(row, nameIdx));
    // Same corpus-level "Last, First" vote as smartPaste, over the name column.
    const commaVals = values.filter((v) => v.includes(','));
    const lfCount = commaVals.filter(looksLastFirst).length;
    const lastFirstMode = lfCount > 0 && lfCount * 2 > commaVals.length;
    values.forEach((v, i) => {
      if (!v) {
        pushEmail(data[i]);
        return;
      }
      if (lastFirstMode && looksLastFirst(v)) out.push({ ...swapLastFirst(v), raw: v });
      else out.push({ ...splitFullName(v), raw: v });
    });
    return out;
  }

  if (emailIdx >= 0) {
    for (const row of data) pushEmail(row);
    return out;
  }

  // Header recognized but no usable columns — fall back to the paste parser.
  return parseRoster(data.map((r) => r.join('\t')).join('\n'));
}
