import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function checkDemo(browser, base) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  try {
    const page = await context.newPage();
    await page.goto(`${base}/?demo=1`);
    const video = page.locator('video');
    await video.waitFor();
    const media = await video.evaluate(async v => {
      v.load();
      if (v.readyState < 1) await new Promise((resolve, reject) => {
        v.addEventListener('loadedmetadata', resolve, { once: true });
        v.addEventListener('error', () => reject(new Error('Demo could not be decoded')), { once: true });
      });
      v.muted = true;
      await v.play();
      await new Promise(resolve => setTimeout(resolve, 500));
      const canvas = document.createElement('canvas');
      canvas.width = 128; canvas.height = 72;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(v, 0, 0, 128, 72);
      const pixels = ctx.getImageData(0, 0, 128, 72).data;
      const colors = new Set();
      for (let i = 0; i < pixels.length; i += 4) colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
      const result = { duration: v.duration, width: v.videoWidth, height: v.videoHeight,
        playing: v.currentTime > 0, colors: colors.size, decoded: !v.error };
      v.pause();
      return result;
    });
    assert.equal(media.decoded, true);
    assert.equal(media.playing, true);
    assert.equal(media.width, 1280);
    assert.equal(media.height, 720);
    assert.ok(media.duration >= 29 && media.duration <= 32, 'Expected a 30-second interface demo');
    assert.ok(media.colors > 40, 'Demo frame must not be blank');
    const out = path.join(root, 'docs/reports/browser');
    fs.mkdirSync(out, { recursive: true });
    await page.screenshot({ path: path.join(out, 'home-with-video.png'), fullPage: true });
    fs.writeFileSync(path.join(out, 'video.json'), JSON.stringify({
      checkedAt: new Date().toISOString(), ...media,
      realWallet: false, note: 'Labelled fictional interface demo, not the final real-wallet submission video.',
    }, null, 2) + '\n');
    return media;
  } finally { await context.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const req = createRequire(import.meta.url);
  let chromium;
  try { ({ chromium } = req('playwright')); }
  catch { ({ chromium } = req('/Users/lyh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try { console.log(JSON.stringify(await checkDemo(browser, process.env.PARLEY_TEST_URL || 'http://127.0.0.1:4207'))); }
  finally { await browser.close(); }
}
