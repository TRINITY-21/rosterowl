// Blank printables: the same renderers the tools use, fed a roster of empty
// rows instead of real students. A teacher who wants to write names in by hand
// gets the identical sheet the tool would have produced — and the download is
// still built in the browser, so nothing is uploaded to make one.
//
// Renderers are imported dynamically so a visitor who only browses the gallery
// never downloads the PDF engine.
import type { CertFonts } from './pdfCerts';
import type { Student } from './types';

export interface BlankSpec {
  key: string;
  /** Gallery card title. */
  label: string;
  /** What is on the sheet. */
  hint: string;
  /** The tool that makes the filled-in version. */
  toolHref: string;
  toolLabel: string;
  /** Downloaded file name, without the extension. */
  filename: string;
  /** Fonts are passed in rather than fetched here, so every blank can be
      rendered and asserted in a plain Node test. */
  render: (fonts: CertFonts) => Promise<Uint8Array>;
}

/** The one font bundle every blank needs — CertFonts is PdfFonts plus display. */
export async function loadBlankFonts(): Promise<CertFonts> {
  const { loadCertFonts } = await import('./pdfFonts');
  return loadCertFonts();
}

/** N nameless students — numbered rows with nothing written in them. */
function blankRoster(n: number): Student[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `blank-${i}`,
    first: '',
    last: '',
    absent: false,
    zonePref: null,
  }));
}

/**
 * One blank attendance roster, described by the handful of things that actually
 * differ between them. Everything else — the numbering, the Mon–Fri columns,
 * the auto-fitting — is the tool's own renderer, so a blank can never drift
 * from the sheet the filled-in version produces.
 */
function attendanceBlank(spec: {
  key: string;
  label: string;
  hint: string;
  filename: string;
  rows: number;
  paper?: 'letter' | 'a4';
  orientation?: 'portrait' | 'landscape';
  inkSaver?: boolean;
}): BlankSpec {
  return {
    key: spec.key,
    label: spec.label,
    hint: spec.hint,
    toolHref: '/attendance/',
    toolLabel: 'attendance roster maker',
    filename: spec.filename,
    render: async (fonts) => {
      const { renderAttendancePdf } = await import('./pdfAttendance');
      const now = new Date();
      const { bytes } = await renderAttendancePdf(
        blankRoster(spec.rows),
        {
          paper: spec.paper ?? 'letter',
          orientation: spec.orientation ?? 'landscape',
          year: now.getFullYear(),
          month: now.getMonth(),
          nameOrder: 'roster',
          inkSaver: spec.inkSaver ?? false,
          showFooter: true,
          subtitle: '',
        },
        fonts
      );
      return bytes;
    },
  };
}

export const BLANKS: BlankSpec[] = [
  attendanceBlank({
    key: 'attendance',
    label: 'Monthly attendance sheet',
    hint: '25 numbered rows and a full month of Mon–Fri columns',
    filename: 'Blank attendance sheet',
    rows: 25,
  }),
  {
    key: 'checklist',
    label: 'Class checklist grid',
    hint: '25 numbered rows and five blank columns to label yourself',
    toolHref: '/checklist/',
    toolLabel: 'checklist maker',
    filename: 'Blank class checklist',
    render: async (fonts) => {
      const { renderChecklistPdf } = await import('./pdfChecklist');
      const { bytes } = await renderChecklistPdf(
        blankRoster(25),
        {
          paper: 'letter',
          orientation: 'portrait',
          title: 'Checklist',
          subtitle: '',
          columns: ['', '', '', '', ''],
          nameOrder: 'roster',
          includeAbsent: true,
          inkSaver: false,
          showFooter: true,
        },
        fonts
      );
      return bytes;
    },
  },
  {
    key: 'desk-plates',
    label: 'Desk name plates',
    hint: 'Two fold-over plates per page, cut guides included',
    toolHref: '/name-tags/',
    toolLabel: 'name tag maker',
    filename: 'Blank desk name plates',
    render: async (fonts) => {
      const { renderNameTagsPdf } = await import('./pdfNameTags');
      const { bytes } = await renderNameTagsPdf(
        blankRoster(8),
        {
          paper: 'letter',
          style: 'desk-plate',
          showLastName: false,
          cornerLabel: '',
          inkSaver: false,
          skipAbsent: false,
          showCutLines: true,
        },
        fonts
      );
      return bytes;
    },
  },
  {
    key: 'badges',
    label: 'Name badges (Avery 5395)',
    hint: 'Eight per sheet, sized to the real label stock',
    toolHref: '/name-tags/',
    toolLabel: 'name tag maker',
    filename: 'Blank name badges',
    render: async (fonts) => {
      const { renderNameTagsPdf } = await import('./pdfNameTags');
      const { bytes } = await renderNameTagsPdf(
        blankRoster(16),
        {
          paper: 'letter',
          style: 'badge-8up',
          showLastName: false,
          cornerLabel: '',
          inkSaver: false,
          skipAbsent: false,
          showCutLines: true,
        },
        fonts
      );
      return bytes;
    },
  },
  {
    key: 'jobs',
    label: 'Classroom jobs poster',
    hint: 'The ten classic jobs, with a blank line under each',
    toolHref: '/jobs-chart/',
    toolLabel: 'jobs chart maker',
    filename: 'Blank classroom jobs chart',
    render: async (fonts) => {
      const [{ renderJobsChartPdf }, { JOB_PRESETS }] = await Promise.all([
        import('./pdfJobs'),
        import('./presets'),
      ]);
      const entries = JOB_PRESETS[0].value.map((title) => ({ title, name: null }));
      const { bytes } = await renderJobsChartPdf(
        entries,
        {
          paper: 'letter',
          title: 'Our Classroom Jobs',
          weekLabel: '',
          inkSaver: false,
          showFooter: true,
        },
        fonts
      );
      return bytes;
    },
  },
  {
    key: 'bingo',
    label: 'Bingo cards (5×5)',
    hint: 'Four blank grids with a free center, ready to fill in',
    toolHref: '/bingo/',
    toolLabel: 'bingo card maker',
    filename: 'Blank bingo cards',
    render: async (fonts) => {
      const { renderBingoPdf } = await import('./pdfBingo');
      const cells = Array.from({ length: 25 }, (_, i) => (i === 12 ? 'FREE' : ''));
      const cards = Array.from({ length: 4 }, () => ({ header: '', cells: [...cells] }));
      const { bytes } = await renderBingoPdf(
        cards,
        {
          paper: 'letter',
          perPage: 1,
          // No pool to call from on a blank sheet, so no caller's list.
          callerList: false,
          items: [],
          inkSaver: false,
          showFooter: true,
        },
        fonts
      );
      return bytes;
    },
  },
];

/**
 * The blank attendance roster in the shapes teachers actually ask for. Kept out
 * of BLANKS on purpose: /printables/ is a gallery of *different sheets*, and
 * five variations on one of them would bury the other five tools. These live on
 * /attendance/blank-attendance-roster/ instead, where the visitor has already
 * said which sheet they want and the only open question is which size.
 */
export const ATTENDANCE_BLANKS: BlankSpec[] = [
  attendanceBlank({
    key: 'attendance',
    label: 'Standard — 25 rows',
    hint: 'Letter, landscape. The everyday sheet: 25 numbered rows, a full month of Mon–Fri columns.',
    filename: 'Blank attendance roster',
    rows: 25,
  }),
  attendanceBlank({
    key: 'attendance-35',
    label: 'Large class — 35 rows',
    hint: 'Letter, landscape. Ten more rows for a lecture section or a combined group, still on one page.',
    filename: 'Blank attendance roster (35 rows)',
    rows: 35,
  }),
  attendanceBlank({
    key: 'attendance-15',
    label: 'Small group — 15 rows',
    hint: 'Letter, landscape. Taller rows with room to write, for a club, an intervention group or a homeroom.',
    filename: 'Blank attendance roster (15 rows)',
    rows: 15,
  }),
  attendanceBlank({
    key: 'attendance-portrait',
    label: 'Portrait — fits a binder',
    hint: 'Letter, upright. The same roster turned to portrait, so it sits in a binder or on a clipboard.',
    filename: 'Blank attendance roster (portrait)',
    rows: 25,
    orientation: 'portrait',
  }),
  attendanceBlank({
    key: 'attendance-a4',
    label: 'A4 — outside the US',
    hint: 'A4, landscape. Identical sheet on the paper the rest of the world prints on.',
    filename: 'Blank attendance roster (A4)',
    rows: 25,
    paper: 'a4',
  }),
  attendanceBlank({
    key: 'attendance-ink-saver',
    label: 'Ink saver — no shading',
    hint: 'Letter, landscape. Lines only, no filled headers — kinder to a staffroom printer running low.',
    filename: 'Blank attendance roster (ink saver)',
    rows: 25,
    inkSaver: true,
  }),
];

/** Every blank the site can build, for lookups by key. */
export const ALL_BLANKS: BlankSpec[] = [
  ...BLANKS,
  ...ATTENDANCE_BLANKS.filter((b) => !BLANKS.some((existing) => existing.key === b.key)),
];
