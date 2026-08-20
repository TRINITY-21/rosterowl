import { spawn } from 'node:child_process';

const port = 4331;
const base = `http://127.0.0.1:${port}`;

// Every browser test gets a wall-clock budget.
//
// Individual Playwright calls mostly carry their own timeouts, but not all of
// them do — browser.newContext() and browser.newPage() have no timeout option
// at all, and when the machine is loaded enough that Chromium never answers the
// command that creates the page, they wait forever. That is not hypothetical:
// it is what turned a five-second smoke test into a thirty-nine-minute stall
// with no output, and then did it again to smoke-groups.mjs, which had a
// timeout on every call it makes and hung on line 10 regardless.
//
// So the bound lives here rather than at the call sites. A per-script budget
// covers every wait a test can perform, including the ones Playwright gives us
// no way to bound and the ones nobody has written yet.
const DEFAULT_BUDGET_MS = 180_000;

/** Scripts that legitimately need longer than the default. */
const BUDGETS = {
  // Builds the same PDF twice — once online, once with the network cut — and
  // waits out the precache in between.
  'tests/smoke-offline.mjs': 300_000,
};

const preview = spawn('npm', ['run', 'preview', '--', '--host', '127.0.0.1', '--port', String(port)], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: process.env,
});

let output = '';
preview.stdout.on('data', (chunk) => (output += chunk));
preview.stderr.on('data', (chunk) => (output += chunk));

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (preview.exitCode !== null) throw new Error(`Preview exited early.\n${output}`);
    try {
      const response = await fetch(base);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Preview did not start in time.\n${output}`);
}

async function run(script) {
  const budget = BUDGETS[script] ?? DEFAULT_BUDGET_MS;
  const started = Date.now();
  const child = spawn(process.execPath, [script], {
    stdio: 'inherit',
    env: { ...process.env, BASE_URL: base },
    // Its own process group, so killing it takes the browsers it spawned with
    // it. Without this the runner moves on and the orphaned Chromiums stay
    // behind to slow down — or hang — everything after them.
    detached: true,
  });

  let timedOut = false;
  const watchdog = setTimeout(() => {
    timedOut = true;
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {}
    // SIGTERM first so Playwright gets a chance to close cleanly; SIGKILL if it
    // does not, because a wedged browser will not answer either.
    setTimeout(() => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {}
    }, 5000);
  }, budget);

  const exitCode = await new Promise((resolve) => child.once('exit', resolve));
  clearTimeout(watchdog);

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (timedOut) {
    process.exitCode = 1;
    throw new Error(
      `${script} exceeded its ${budget / 1000}s budget and was killed. ` +
        'It did not fail an assertion — it stopped making progress, most likely ' +
        'waiting on a Playwright call with no timeout of its own ' +
        '(browser.newContext and browser.newPage have none).',
    );
  }
  if (exitCode !== 0) {
    process.exitCode = exitCode ?? 1;
    throw new Error(`${script} failed with ${exitCode} after ${seconds}s`);
  }
  console.log(`✓ ${script} (${seconds}s)`);
}

try {
  await waitForServer();
  for (const script of [
    'tests/smoke.mjs',
    'tests/smoke-groups.mjs',
    'tests/smoke-certs.mjs',
    'tests/smoke-checklist.mjs',
    'tests/smoke-nametags.mjs',
    'tests/smoke-jobs.mjs',
    'tests/smoke-bingo.mjs',
    'tests/smoke-flashcards.mjs',
    'tests/smoke-attendance.mjs',
    'tests/smoke-share.mjs',
    // Cloud sync against a stubbed API — including the conflict path, which is
    // the one place a teacher's work could be lost if the client is wrong.
    'tests/smoke-sync.mjs',
    // The only Safari-engine coverage. It was already headless and BASE_URL-
    // driven like the rest; it sat outside CI only because it had the dev
    // server's port hard-coded and so could not be pointed at this build.
    'tests/smoke-webkit.mjs',
    // Registers a service worker, so it gets its own browser context and runs
    // after the tests that assume a plain network.
    'tests/smoke-offline.mjs',
    // Serves dist under the generated _headers on its own port; the preview
    // server can't be used because it does not apply them.
    'tests/smoke-csp.mjs',
  ]) {
    await run(script);
  }
} finally {
  preview.kill('SIGTERM');
}
