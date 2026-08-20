// Display-name disambiguation: shortest name that tells classmates apart.

import type { Id, Student } from './types';

/**
 * Unique first name -> "First". Duplicate firsts -> "First L.", extending the
 * last-name prefix letter by letter until unique, or the full "First Last" if
 * never unique. Students without a last name stay "First". Comparison is
 * case-insensitive; output keeps original casing.
 */
export function displayNames(students: Student[]): Map<Id, string> {
  const out = new Map<Id, string>();

  const byFirst = new Map<string, Student[]>();
  for (const s of students) {
    const key = s.first.trim().toLowerCase();
    const group = byFirst.get(key);
    if (group) group.push(s);
    else byFirst.set(key, [s]);
  }

  for (const group of byFirst.values()) {
    if (group.length === 1) {
      out.set(group[0].id, group[0].first);
      continue;
    }
    // Only students that actually have a last name can be disambiguated.
    const lasts = group
      .filter((s) => s.last.trim().length > 0)
      .map((s) => ({ s, lower: s.last.trim().toLowerCase() }));

    for (const s of group) {
      const last = s.last.trim();
      if (last.length === 0) {
        out.set(s.id, s.first);
        continue;
      }
      const lower = last.toLowerCase();
      const others = lasts.filter((e) => e.s !== s).map((e) => e.lower);

      let name = `${s.first} ${last}`; // fallback: never unique
      for (let k = 1; k <= lower.length; k++) {
        const prefix = lower.slice(0, k);
        if (!others.some((o) => o.slice(0, k) === prefix)) {
          name = k < last.length ? `${s.first} ${last.slice(0, k)}.` : `${s.first} ${last}`;
          break;
        }
      }
      out.set(s.id, name);
    }
  }

  return out;
}
