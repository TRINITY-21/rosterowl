// Starting points, not rules. Every preset drops straight into the tool's own
// fields so a teacher can edit it afterwards — the point is to never land on an
// empty form and have to invent the setup from scratch.

export interface Preset<T> {
  key: string;
  label: string;
  /** One line explaining when a teacher would reach for it. */
  hint: string;
  value: T;
}

// ---- checklist column sets -------------------------------------------------
// Headers are capped at 14 characters by the tool, and 1–12 columns.

export const CHECKLIST_PRESETS: Preset<string[]>[] = [
  {
    key: 'weekdays',
    label: 'Mon–Fri',
    hint: 'A column per school day',
    value: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
  },
  {
    key: 'homework',
    label: 'Homework',
    hint: 'Six assignments across a unit',
    value: ['HW 1', 'HW 2', 'HW 3', 'HW 4', 'HW 5', 'HW 6'],
  },
  {
    key: 'reading-log',
    label: 'Reading log',
    hint: 'Books finished, one column each',
    value: ['Book 1', 'Book 2', 'Book 3', 'Book 4', 'Book 5'],
  },
  {
    key: 'permission',
    label: 'Permission slips',
    hint: 'Field-trip paperwork and fees',
    value: ['Sent home', 'Signed', 'Returned', 'Fee paid'],
  },
  {
    key: 'supplies',
    label: 'Supplies',
    hint: 'Start-of-year materials check',
    value: ['Folder', 'Pencils', 'Notebook', 'Glue', 'Scissors'],
  },
  {
    key: 'weeks',
    label: 'Weekly checks',
    hint: 'A running six-week tracker',
    value: ['Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5', 'Week 6'],
  },
];

// ---- classroom job sets ----------------------------------------------------

export const JOB_PRESETS: Preset<string[]>[] = [
  {
    key: 'classics',
    label: 'The classics',
    hint: 'Ten jobs found in almost every classroom',
    value: [
      'Line Leader',
      'Door Holder',
      'Paper Passer',
      'Materials Manager',
      'Board Eraser',
      'Light Monitor',
      'Class Librarian',
      'Messenger',
      'Plant Waterer',
      'Caboose',
    ],
  },
  {
    key: 'early',
    label: 'Early grades',
    hint: 'Simple, concrete jobs for K–2',
    value: [
      'Line Leader',
      'Caboose',
      'Door Holder',
      'Snack Helper',
      'Calendar Helper',
      'Weather Watcher',
      'Pencil Sharpener',
      'Book Buddy',
      'Table Washer',
      'Lights',
    ],
  },
  {
    key: 'upper',
    label: 'Upper grades',
    hint: 'More responsibility, for 3–6',
    value: [
      'Tech Helper',
      'Attendance Monitor',
      'Homework Collector',
      'Recycling Monitor',
      'Whiteboard Manager',
      'Supply Manager',
      'Timekeeper',
      'Substitute Helper',
      'Class Reporter',
      'Line Leader',
    ],
  },
  {
    key: 'large',
    label: 'Large class',
    hint: 'Twenty jobs so everyone has one',
    value: [
      'Line Leader',
      'Caboose',
      'Door Holder',
      'Paper Passer',
      'Paper Collector',
      'Materials Manager',
      'Supply Manager',
      'Board Eraser',
      'Whiteboard Manager',
      'Light Monitor',
      'Class Librarian',
      'Book Buddy',
      'Messenger',
      'Tech Helper',
      'Plant Waterer',
      'Table Washer',
      'Recycling Monitor',
      'Calendar Helper',
      'Timekeeper',
      'Class Reporter',
    ],
  },
];

// ---- bingo word lists ------------------------------------------------------
// Stored newline-separated because that is exactly what the bingo tool's
// custom-list field parses. All three are long enough to fill a 5×5 grid.

/** Dolch pre-primer sight words. */
const SIGHT_PRE_PRIMER = [
  'a', 'and', 'away', 'big', 'blue', 'can', 'come', 'down', 'find', 'for',
  'funny', 'go', 'help', 'here', 'I', 'in', 'is', 'it', 'jump', 'little',
  'look', 'make', 'me', 'my', 'not', 'one', 'play', 'red', 'run', 'said',
  'see', 'the', 'three', 'to', 'two', 'up', 'we', 'where', 'yellow', 'you',
];

/** Dolch primer sight words. */
const SIGHT_PRIMER = [
  'all', 'am', 'are', 'at', 'ate', 'be', 'black', 'brown', 'but', 'came',
  'did', 'do', 'eat', 'four', 'get', 'good', 'have', 'he', 'into', 'like',
  'must', 'new', 'no', 'now', 'on', 'our', 'out', 'please', 'pretty', 'ran',
  'ride', 'saw', 'say', 'she', 'so', 'soon', 'that', 'there', 'they', 'this',
  'too', 'under', 'want', 'was', 'well', 'went', 'what', 'white', 'who',
  'will', 'with', 'yes',
];

const US_STATES = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado',
  'Connecticut', 'Delaware', 'Florida', 'Georgia', 'Hawaii', 'Idaho',
  'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine',
  'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi',
  'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey',
  'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio',
  'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina',
  'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia',
  'Washington', 'West Virginia', 'Wisconsin', 'Wyoming',
];

export const WORD_LIST_PRESETS: Preset<string>[] = [
  {
    key: 'sight-pre-primer',
    label: 'Sight words — pre-primer',
    hint: '40 Dolch pre-primer words',
    value: SIGHT_PRE_PRIMER.join('\n'),
  },
  {
    key: 'sight-primer',
    label: 'Sight words — primer',
    hint: '52 Dolch primer words',
    value: SIGHT_PRIMER.join('\n'),
  },
  {
    key: 'us-states',
    label: 'US states',
    hint: 'All fifty, for geography review',
    value: US_STATES.join('\n'),
  },
];

// ---- certificate awards ----------------------------------------------------

export const AWARD_PRESETS: string[] = [
  'Certificate of Achievement',
  'Star Reader Award',
  'Kindness Award',
  'Perfect Attendance',
  'Most Improved',
  'Math Star',
  'Super Scientist',
  'Outstanding Effort',
  // End-of-year set — the May/June push.
  'Student of the Year',
  'Great Attitude Award',
  'Best Team Player',
  'Creative Thinker',
];
