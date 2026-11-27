// Usage: node render.mjs <trailer.html> <outDir> [fps] [--stills t1,t2,...]
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const [html, outDir, fpsArg] = process.argv.slice(2);
const stillsIdx = process.argv.indexOf('--stills');
const stills = stillsIdx > 0 ? process.argv[stillsIdx + 1].split(',').map(Number) : null;
const fps = Number(fpsArg) || 30;
mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--allow-file-access-from-files', '--disable-gpu-vsync', '--hide-scrollbars'],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.goto(pathToFileURL(path.resolve(html)).href + '?render', { waitUntil: 'load' });
await page.evaluate(() => window.ready);
const duration = await page.evaluate(() => window.DURATION);
const times = stills ?? Array.from({ length: Math.round(duration * fps) }, (_, i) => i / fps);
let n = 0;
for (const t of times) {
  await page.evaluate((t) => window.seek(t), t);
  const name = stills ? `still-${String(t).replace('.', '_')}.png` : `f${String(n).padStart(5, '0')}.jpg`;
  await page.screenshot({ path: path.join(outDir, name), type: stills ? 'png' : 'jpeg', quality: stills ? undefined : 94 });
  n++;
  if (!stills && n % 150 === 0) console.log(`${n}/${times.length}`);
}
await browser.close();
console.log(`done ${n} frames`);
