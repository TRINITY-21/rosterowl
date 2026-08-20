import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const out = '/tmp/rosterowl-shots3';
const base = process.env.BASE_URL ?? 'http://localhost:4321';
const errors = [];
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chromium' });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(base + '/group-maker/', { waitUntil: 'networkidle' });
await page.waitForSelector('.gcard', { timeout: 15000 });
const groupsBefore = await page.locator('.gcard').count();
await page.screenshot({ path: `${out}/01-groups.png` });

await page.getByLabel(/groups of/i).selectOption('3');
await page.waitForTimeout(300);
const groupsAfter = await page.locator('.gcard').count();

await page.getByRole('button', { name: /shuffle groups/i }).click();
await page.waitForTimeout(200);
await page.screenshot({ path: `${out}/02-groups-of-3.png` });

const firstName = await page.locator('.gcard li').first().textContent();
assert.ok(groupsBefore > 0, 'sample class should produce groups');
assert.ok(groupsAfter > groupsBefore, 'smaller groups should create more piles');
assert.ok((firstName ?? '').trim().length > 0, 'group cards should show student names');
assert.deepEqual(errors, [], `browser console/page errors: ${errors.join('\n')}`);
console.log(JSON.stringify({ groupsBefore, groupsAfter, firstName: firstName?.trim(), consoleErrors: errors }, null, 2));
await browser.close();
