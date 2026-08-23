// Post-deploy checks against the real origin.
//
// This suite exists because of a bug no local test could have caught. Sign-in
// was answered with the 404 page while every local test passed, because the
// failure lived in Cloudflare's asset router rather than in any of our code:
// with `not_found_handling: "404-page"`, a request matching no static asset is
// served dist/404.html *and the Worker is never invoked* — but only when the
// request is a navigation, which the router recognises by Sec-Fetch-Mode.
//
// That is why it hid so well. /api/me over fetch() reached the Worker and
// worked. curl reached the Worker and worked. Only a real browser click — a
// navigation — failed, and it failed identically to an earlier service-worker
// bug that had already been found and fixed, which made the symptom look like
// a known, solved problem.
//
// So: send the header that distinguishes them, against the deployed site.
//
//   npm run verify:live            (against https://rosterowl.com)
//   BASE_URL=... npm run verify:live
import assert from 'node:assert/strict';

const base = (process.env.BASE_URL ?? 'https://rosterowl.com').replace(/\/$/, '');

/** A request shaped like a browser navigation, which is what broke. */
const asNavigation = {
  redirect: 'manual',
  headers: {
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-dest': 'document',
    'sec-fetch-site': 'none',
  },
};

const checks = [];
const check = (name, fn) => checks.push({ name, fn });

check('sign-in redirects to Google', async () => {
  const r = await fetch(`${base}/api/auth/google/start?next=%2Fseating-chart%2F`, asNavigation);
  assert.equal(
    r.status,
    302,
    `expected a redirect to Google, got ${r.status}. If this is 404, the Worker was ` +
      'never invoked — check assets.run_worker_first in wrangler.jsonc.',
  );
  const location = r.headers.get('location') ?? '';
  assert.ok(
    location.startsWith('https://accounts.google.com/'),
    `redirect should point at Google, got ${location.slice(0, 80)}`,
  );
  // A wrong client id or redirect_uri here is a working redirect that fails on
  // Google's side with an error page, which looks like our bug but is not.
  assert.match(location, /[?&]client_id=\d+-[a-z0-9]+\.apps\.googleusercontent\.com/);
  assert.ok(
    decodeURIComponent(location).includes(`${base}/api/auth/google/callback`),
    'redirect_uri must match the URI registered on the OAuth client',
  );
});

check('the callback hop reaches the Worker too', async () => {
  // Google navigates the browser back here, so it fails the same way. Bad
  // params are fine — anything except the asset router's 404 proves the point.
  const r = await fetch(`${base}/api/auth/google/callback?code=probe&state=probe`, asNavigation);
  assert.notEqual(r.status, 404, 'the callback was answered by the asset router, not the Worker');
});

check('the session endpoint answers JSON', async () => {
  const r = await fetch(`${base}/api/me`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') ?? '', /application\/json/);
  assert.deepEqual(await r.json(), { signedIn: false });
});

check('pages and files are still served by the asset router', async () => {
  for (const path of ['/', '/seating-chart/', '/attendance/', '/sitemap-0.xml', '/robots.txt']) {
    const r = await fetch(base + path, asNavigation);
    assert.equal(r.status, 200, `${path} should be 200, got ${r.status}`);
  }
});

check('a missing page still 404s', async () => {
  const r = await fetch(`${base}/no-such-page/`, asNavigation);
  assert.equal(r.status, 404);
});

check('slashless URLs redirect permanently', async () => {
  const r = await fetch(`${base}/terms`, asNavigation);
  assert.equal(r.status, 301, 'a 307 here leaks ranking signal on every inbound link');
  // Cloudflare answers with a root-relative Location; both forms are valid.
  const to = new URL(r.headers.get('location') ?? '', base).href;
  assert.equal(to, `${base}/terms/`);
});

let failed = 0;
for (const { name, fn } of checks) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`  ✗ ${name}\n    ${e.message}`);
  }
}
console.log(`smoke-live: ${checks.length - failed}/${checks.length} passed against ${base}`);
if (failed) process.exit(1);
