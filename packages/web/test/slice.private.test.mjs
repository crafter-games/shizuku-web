// Plays the vertical slice in a real browser: new game -> the rooftop choice,
// then saves. Uses `pnpm dev`, which loads the developer's own disks from the
// private dump; skipped when the dump is not there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const disks = process.env.SHIZUKU_DISKS ?? new URL('../../../../pc98/fixtures/private/shizuku/', import.meta.url).pathname;
const skip = existsSync(`${disks}/sizuku_a.hdm`) ? false : 'no private Shizuku dump';
const PORT = 5299;

test('new game reaches the first choice and saves', { skip, timeout: 300_000 }, async () => {
  const server = spawn('pnpm', ['exec', 'vite', '--port', String(PORT), '--strictPort'], { cwd: new URL('..', import.meta.url).pathname, stdio: 'pipe' });
  await new Promise((resolve) => server.stdout.on('data', (d) => /ready in/.test(String(d)) && resolve()));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://localhost:${PORT}/`);
    // First launch: the opening plays; a click skips to the title.
    await page.waitForSelector('.opening', { timeout: 60_000 });
    await page.waitForTimeout(1500);
    await page.click('.opening');
    await page.click('text=Nueva partida', { timeout: 10_000 });
    let presses = 0;
    while (!(await page.$('.choices')) && presses < 2000) {
      await page.keyboard.press('Enter');
      await page.waitForTimeout(60);
      presses++;
    }
    const options = await page.$$eval('.choices button', (b) => b.map((x) => x.textContent));
    assert.equal(options.length, 2, `expected the rooftop choice after ${presses} presses`);
    assert.deepEqual(errors, []);

    await page.click('text=Guardar');
    await page.click('.slot >> nth=0');
    await page.waitForFunction(() => !document.querySelector('.slot')?.textContent?.includes('Vacía'), null, { timeout: 5000 });
    assert.match(await page.textContent('.slot >> nth=0'), /Ranura 1.*\d/);
  } finally {
    await browser.close();
    server.kill();
  }
});
