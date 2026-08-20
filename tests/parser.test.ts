import { describe, expect, it } from 'vitest';
import { parseRoster, nameFromEmail, normalizeCase, splitFullName } from '../src/lib/smartPaste';
import { parseCsvRoster } from '../src/lib/csv';

const names = (r: { first: string; last: string }[]) => r.map((n) => `${n.first}|${n.last}`);

describe('parseRoster — plain lists', () => {
  it('parses a plain newline list, order preserved', () => {
    const r = parseRoster('John Smith\nJane Doe\nAli Khan');
    expect(names(r)).toEqual(['John|Smith', 'Jane|Doe', 'Ali|Khan']);
    expect(r[0].raw).toBe('John Smith');
  });

  it('handles CRLF and blank/whitespace-only lines', () => {
    const r = parseRoster('John Smith\r\n\r\n   \nJane Doe\r\n');
    expect(names(r)).toEqual(['John|Smith', 'Jane|Doe']);
  });

  it('single token -> first only, empty last', () => {
    expect(parseRoster('Cher')[0]).toMatchObject({ first: 'Cher', last: '' });
  });

  it('multi-word name: first token = first, remainder = last', () => {
    expect(parseRoster('Mary Jane Watson')[0]).toMatchObject({ first: 'Mary', last: 'Jane Watson' });
  });

  it('never dedupes — twins with identical names are kept', () => {
    const r = parseRoster('Jose Garcia\nJose Garcia');
    expect(names(r)).toEqual(['Jose|Garcia', 'Jose|Garcia']);
  });
});

describe('parseRoster — Last, First detection', () => {
  it('swaps when the majority of comma lines look like "Word, Word(s)"', () => {
    const r = parseRoster('Smith, John\nDoe, Jane\nKhan, Ali');
    expect(names(r)).toEqual(['John|Smith', 'Jane|Doe', 'Ali|Khan']);
  });

  it('keeps multi-word remainder as the first name when swapping', () => {
    const r = parseRoster('Watson, Mary Jane\nSmith, John');
    expect(r[0]).toMatchObject({ first: 'Mary Jane', last: 'Watson' });
  });

  it('a single line with multiple commas is a list of full names', () => {
    const r = parseRoster('John Smith, Jane Doe, Ali Khan');
    expect(names(r)).toEqual(['John|Smith', 'Jane|Doe', 'Ali|Khan']);
  });

  it('one comma but multi-word sides -> list of full names, not a swap', () => {
    const r = parseRoster('John Smith, Jane Doe');
    expect(names(r)).toEqual(['John|Smith', 'Jane|Doe']);
  });

  it('mixed paste: comma-free lines stay natural order in Last-First mode', () => {
    const r = parseRoster('Smith, John\nDoe, Jane\nMary Jane Watson');
    expect(names(r)).toEqual(['John|Smith', 'Jane|Doe', 'Mary|Jane Watson']);
  });
});

describe('parseRoster — emails', () => {
  it('Google-Classroom-style paste: name lines kept, their email lines skipped', () => {
    const text = 'John Smith\njohn.smith@school.org\nJane Doe\njane.doe@school.org';
    expect(names(parseRoster(text))).toEqual(['John|Smith', 'Jane|Doe']);
  });

  it('recognizes flastname-style addresses as belonging to the previous line', () => {
    const text = 'John Smith\njsmith@school.org\nJane Doe\njdoe22@school.org';
    expect(names(parseRoster(text))).toEqual(['John|Smith', 'Jane|Doe']);
  });

  it('an email-only list derives names from the local parts', () => {
    const r = parseRoster('jane.doe@school.org\nali.khan2@school.org');
    expect(names(r)).toEqual(['Jane|Doe', 'Ali|Khan']);
    expect(r[0].raw).toBe('jane.doe@school.org');
  });

  it('drops an email token that sits next to a name on the same line', () => {
    const r = parseRoster('Jane Doe <jane.doe@school.org>');
    expect(names(r)).toEqual(['Jane|Doe']);
  });

  it('an unrelated email-only line still becomes a student', () => {
    const text = 'John Smith\nali.khan@school.org';
    expect(names(parseRoster(text))).toEqual(['John|Smith', 'Ali|Khan']);
  });
});

describe('parseRoster — columns and junk', () => {
  it('tab-separated gradebook: drops ID and grade columns, swaps Last, First', () => {
    const text = 'Student\tID\tGrade\nSmith, John\t10231\t3rd\nDoe, Jane\t10232\t3rd';
    expect(names(parseRoster(text))).toEqual(['John|Smith', 'Jane|Doe']);
  });

  it('drops dates, "Grade 4", "P2" style tokens', () => {
    const text = 'Jane Doe\tGrade 4\t01/02/2015\nAli Khan\tP2\t9912';
    expect(names(parseRoster(text))).toEqual(['Jane|Doe', 'Ali|Khan']);
  });

  it('skips header rows (Name / First Last / comma-separated)', () => {
    expect(names(parseRoster('Name\nJohn Smith'))).toEqual(['John|Smith']);
    expect(names(parseRoster('First Name\tLast Name\nJane\tDoe'))).toEqual(['Jane|Doe']);
    expect(names(parseRoster('first,last,id\nJohn Smith'))).toEqual(['John|Smith']);
  });

  it('multi-space separated columns work like tabs', () => {
    expect(names(parseRoster('Jane Doe    10231    3rd'))).toEqual(['Jane|Doe']);
  });

  // Regression: junk used to be filtered per comma-segment, so a student id a
  // SINGLE space away from the name discarded the whole student.
  it('keeps the student when an id sits one space after the name', () => {
    expect(names(parseRoster('Ava Martinez 10231'))).toEqual(['Ava|Martinez']);
    expect(names(parseRoster('Liam O’Brien 44'))).toEqual(['Liam|O’Brien']);
    expect(names(parseRoster('Zoë Chen 7B'))).toEqual(['Zoë|Chen']);
  });

  it('keeps "Last, First" intact when a bracketed id trails the first name', () => {
    expect(names(parseRoster('Martinez, Ava (10231)'))).toEqual(['Ava|Martinez']);
  });

  it('still discards label-plus-number segments that carry no name', () => {
    expect(names(parseRoster('Homeroom 12'))).toEqual([]);
    expect(names(parseRoster('Grade 4'))).toEqual([]);
    expect(names(parseRoster('Jane Doe\tHomeroom 12'))).toEqual(['Jane|Doe']);
  });
});

describe('parseRoster — list numbering', () => {
  it('strips "1.", "12)", "-", "•", "*" prefixes', () => {
    const text = '1. John Smith\n2. Jane Doe\n12) Ali Khan\n- Sam Lee\n• Kim Park\n* Bo Tran';
    expect(names(parseRoster(text))).toEqual([
      'John|Smith', 'Jane|Doe', 'Ali|Khan', 'Sam|Lee', 'Kim|Park', 'Bo|Tran',
    ]);
  });
});

describe('parseRoster — casing', () => {
  it('ALLCAPS gets Title Case', () => {
    expect(names(parseRoster('JOHN SMITH\nJANE DOE'))).toEqual(['John|Smith', 'Jane|Doe']);
  });

  it('all-lowercase gets Title Case', () => {
    expect(names(parseRoster('ali khan'))).toEqual(['Ali|Khan']);
  });

  it("preserves interior capitals: McKenna, DiAngelo, O'Brien", () => {
    const r = parseRoster("Kate McKenna\nMia DiAngelo\nLiam O'Brien");
    expect(names(r)).toEqual(["Kate|McKenna", 'Mia|DiAngelo', "Liam|O'Brien"]);
  });

  it("title-cases around apostrophes and hyphens in ALLCAPS input", () => {
    const r = parseRoster("LIAM O'BRIEN\nMARY-KATE OLSEN");
    expect(names(r)).toEqual(["Liam|O'Brien", 'Mary-Kate|Olsen']);
  });
});

describe('exported helpers', () => {
  it('normalizeCase leaves mixed case untouched', () => {
    expect(normalizeCase('McKenna')).toBe('McKenna');
    expect(normalizeCase('MCKENNA DOE')).toBe('Mckenna Doe');
  });

  it('splitFullName handles empty input', () => {
    expect(splitFullName('')).toEqual({ first: '', last: '' });
  });

  it('nameFromEmail strips digits and splits on separators', () => {
    expect(nameFromEmail('jane.doe2@school.org')).toEqual({ first: 'Jane', last: 'Doe' });
    expect(nameFromEmail('ali-khan@school.org')).toEqual({ first: 'Ali', last: 'Khan' });
    expect(nameFromEmail('cher@school.org')).toEqual({ first: 'Cher', last: '' });
  });
});

describe('parseCsvRoster', () => {
  it('CSV with First,Last header columns', () => {
    const r = parseCsvRoster('First,Last\nJane,Doe\nJOHN,SMITH');
    expect(names(r)).toEqual(['Jane|Doe', 'John|Smith']);
    expect(r[0].raw).toBe('Jane Doe');
  });

  it('CSV with reversed Last,First header columns maps correctly', () => {
    const r = parseCsvRoster('Last,First\nDoe,Jane');
    expect(names(r)).toEqual(['Jane|Doe']);
  });

  it('CSV with a single Name column holding "Last, First"', () => {
    const r = parseCsvRoster('Name\n"Doe, Jane"\n"Smith, John"');
    expect(names(r)).toEqual(['Jane|Doe', 'John|Smith']);
  });

  it('CSV with a single Name column holding natural-order names', () => {
    const r = parseCsvRoster('Student Name\nJane Doe\nJohn Smith');
    expect(names(r)).toEqual(['Jane|Doe', 'John|Smith']);
  });

  it('semicolon-delimited CSV', () => {
    const r = parseCsvRoster('First;Last;Grade\nJane;Doe;3\nJohn;Smith;3');
    expect(names(r)).toEqual(['Jane|Doe', 'John|Smith']);
  });

  it('strips a UTF-8 BOM', () => {
    const r = parseCsvRoster('\uFEFFFirst,Last\nJane,Doe');
    expect(names(r)).toEqual(['Jane|Doe']);
  });

  it('ignores ID and grade columns when headers name them', () => {
    const r = parseCsvRoster('ID,First,Last,Grade\n10231,Jane,Doe,4\n10232,John,Smith,4');
    expect(names(r)).toEqual(['Jane|Doe', 'John|Smith']);
  });

  it('derives names from an email-only column', () => {
    const r = parseCsvRoster('Email\njane.doe@school.org\nali.khan@school.org');
    expect(names(r)).toEqual(['Jane|Doe', 'Ali|Khan']);
  });

  it('headerless CSV falls back to the smart-paste pipeline', () => {
    const r = parseCsvRoster('Jane,Doe,10231\nJohn,Smith,10232');
    expect(names(r)).toEqual(['Jane|Doe', 'John|Smith']);
  });

  it('normalizes case like smartPaste does', () => {
    const r = parseCsvRoster("First,Last\nLIAM,O'BRIEN\nkate,McKenna");
    expect(names(r)).toEqual(["Liam|O'Brien", 'Kate|McKenna']);
  });

  it('empty input yields an empty roster', () => {
    expect(parseCsvRoster('')).toEqual([]);
    expect(parseCsvRoster('\uFEFF\n\n')).toEqual([]);
  });
});
