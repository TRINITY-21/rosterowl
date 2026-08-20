// Cloud sync, driven in a real browser against a stubbed API.
//
// The Worker's half is exercised separately against a local D1; what this
// covers is the client's behaviour around it, and specifically the three
// promises that would be expensive to break:
//
//   1. signed out, the site makes no API request at all
//   2. the seeded sample class is never uploaded
//   3. a refused write (409) keeps the local document in version history
//      instead of discarding it
//
// It also catches the class of bug where sync silently never starts — which is
// invisible in the UI except that the menu keeps showing the signed-out state.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.BASE_URL ?? 'http://localhost:4321';
const out = process.argv[2] ?? '/tmp/rosterowl-sync';
await mkdir(out, { recursive: true });

const browser = await chromium.launch();
const errors = [];
const result = {};

/** A context with the sign-in hint cookie and a stubbed API. */
async function signedIn(handlers = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([{ name: 'ro_signed_in', value: '1', url: base }]);
  await ctx.route('**/api/me', (r) =>
    r.fulfill({ json: { signedIn: true, email: 'a.teacher@school.edu' } })
  );
  await ctx.route('**/api/doc', handlers.doc ?? ((r) => r.fulfill({ status: 204, body: '' })));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e)));
  return { ctx, page };
}

/**
 * Seed a real class the way a returning teacher's browser would have it.
 *
 * Written in full rather than patched into whatever is there: the sample class
 * lives only in memory until the app first persists, so there is nothing to
 * read on a fresh profile.
 */
async function seedRoster(page, names) {
  await page.evaluate((list) => {
    const state = {
      version: 1,
      rooms: [{ id: 'r1', name: 'Room 12', desks: [], teacherDesk: null, door: null }],
      classes: [
        {
          id: 'real-class',
          name: 'Period 2',
          roomId: 'r1',
          students: list.map((n, i) => ({
            id: 's' + i,
            first: n,
            last: '',
            absent: false,
            zonePref: null,
          })),
          seating: {},
          locked: [],
          apart: [],
          together: [],
          pickerHistory: [],
          jobs: { titles: [], wheel: [], offset: 0 },
          wordLists: { bingo: '', flashcards: '' },
        },
      ],
      activeClassId: 'real-class',
      settings: {},
    };
    localStorage.setItem('rosterowl:v1', JSON.stringify(state));
  }, names);
}

// --- 1. signed out makes no API request ------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const seen = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/')) seen.push(r.url());
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e)));
  await page.goto(base + '/attendance/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  assert.deepEqual(seen, [], `signed out must not call the API, saw: ${seen.join(', ')}`);
  await page.click('.sync summary');
  await page.waitForTimeout(300);
  assert.ok(
    await page.getByRole('button', { name: /continue with google/i }).isVisible(),
    'signed-out menu should offer sign-in'
  );
  result.signedOutRequests = seen.length;
  await page.screenshot({ path: `${out}/01-signed-out.png` });
  await ctx.close();
}

// --- 2. signed in settles, and never uploads the sample class --------------
{
  let puts = 0;
  const { ctx, page } = await signedIn({
    doc: (r) => {
      if (r.request().method() === 'PUT') {
        puts += 1;
        return r.fulfill({ json: { rev: 1, updatedAt: Date.now() } });
      }
      return r.fulfill({ status: 204, body: '' });
    },
  });
  await page.goto(base + '/attendance/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);
  assert.equal(puts, 0, 'the seeded sample class must never be uploaded');

  await page.click('.sync summary');
  await page.waitForTimeout(300);
  assert.ok(
    await page.getByText('a.teacher@school.edu').isVisible(),
    'signed-in menu should show the account — if this fails, sync never started'
  );
  result.sampleUploads = puts;
  await page.screenshot({ path: `${out}/02-signed-in.png` });
  await ctx.close();
}

// --- 3. a real roster is pushed -------------------------------------------
{
  let pushed = null;
  const { ctx, page } = await signedIn({
    doc: (r) => {
      if (r.request().method() === 'PUT') {
        pushed = JSON.parse(r.request().postData() ?? '{}');
        return r.fulfill({ json: { rev: 1, updatedAt: Date.now() } });
      }
      return r.fulfill({ status: 204, body: '' });
    },
  });
  await page.goto(base + '/attendance/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await seedRoster(page, ['Ava', 'Liam', 'Zoe']);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(4000);
  assert.ok(pushed, 'a real roster should be uploaded');
  assert.equal(pushed.doc.classes[0].name, 'Period 2');
  assert.ok(typeof pushed.device === 'string' && pushed.device.length > 0, 'device label sent');
  result.pushedClass = pushed.doc.classes[0].name;
  result.device = pushed.device;
  await ctx.close();
}

// --- 4. a refused write keeps the local copy in version history -----------
{
  const { ctx, page } = await signedIn({
    doc: (r) => {
      if (r.request().method() === 'PUT') {
        // Another device got there first, and its document differs.
        return r.fulfill({
          status: 409,
          json: {
            error: 'conflict',
            rev: 7,
            updatedAt: Date.now(),
            device: 'Chrome on Windows',
            doc: {
              version: 1,
              rooms: [{ id: 'r1', name: 'Room 12', desks: [], teacherDesk: null, door: null }],
              classes: [
                {
                  id: 'other-class',
                  name: 'From the other laptop',
                  roomId: 'r1',
                  students: [{ id: 'x1', first: 'Mateo', last: '', absent: false, zonePref: null }],
                  seating: {},
                  locked: [],
                  apart: [],
                  together: [],
                  pickerHistory: [],
                  jobs: { titles: [], wheel: [], offset: 0 },
                  wordLists: { bingo: '', flashcards: '' },
                },
              ],
              activeClassId: 'other-class',
              settings: {},
            },
          },
        });
      }
      return r.fulfill({ status: 204, body: '' });
    },
  });
  await page.goto(base + '/attendance/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await seedRoster(page, ['Ava', 'Liam', 'Zoe']);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(4500);

  const state = await page.evaluate(() => ({
    live: JSON.parse(localStorage.getItem('rosterowl:v1')).classes.map((c) => c.name),
    versions: JSON.parse(localStorage.getItem('rosterowl:versions:v1') ?? '[]').map((v) => ({
      kind: v.kind,
      classes: v.state.classes.map((c) => c.name),
    })),
  }));

  assert.ok(
    state.live.includes('From the other laptop'),
    `the server's copy should win the live document, got ${state.live.join(', ')}`
  );
  assert.ok(
    state.versions.some((v) => v.classes.includes('Period 2')),
    'the refused local document must survive in version history, not be discarded'
  );
  result.afterConflict = state.live;
  result.recoverableFromHistory = state.versions
    .filter((v) => v.classes.includes('Period 2'))
    .map((v) => v.kind);
  await page.screenshot({ path: `${out}/03-after-conflict.png` });
  await ctx.close();
}

await browser.close();
result.errors = errors;
console.log(JSON.stringify(result, null, 2));
assert.deepEqual(errors, [], 'browser console/page errors');
