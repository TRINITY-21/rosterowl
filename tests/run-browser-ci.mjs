import { spawn } from 'node:child_process';

const port = 4331;
const base = `http://127.0.0.1:${port}`;
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
  const child = spawn(process.execPath, [script], {
    stdio: 'inherit',
    env: { ...process.env, BASE_URL: base },
  });
  const exitCode = await new Promise((resolve) => child.once('exit', resolve));
  if (exitCode !== 0) {
    process.exitCode = exitCode ?? 1;
    throw new Error(`${script} failed with ${exitCode}`);
  }
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
