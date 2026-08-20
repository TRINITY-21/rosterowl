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
  ]) {
    await run(script);
  }
} finally {
  preview.kill('SIGTERM');
}
