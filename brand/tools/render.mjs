// Renders every element with a data-out attribute in an HTML file to a PNG.
// Usage: node brand/tools/render.mjs brand/directions/a-lens.html [outDir] [scale]
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const puppeteer = require(process.env.PUPPETEER_CORE || '/Users/mac/Documents/Hacks/zecathon/stowaway-video/node_modules/puppeteer-core');

const file = path.resolve(process.argv[2]);
const outDir = path.resolve(process.argv[3] || path.join(path.dirname(file), '..', 'out'));
const scale = Number(process.argv[4] || 1);
fs.mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--allow-file-access-from-files'],
});
const page = await browser.newPage();
await page.setViewport({ width: 3400, height: 9000, deviceScaleFactor: scale });
await page.goto('file://' + file, { waitUntil: 'networkidle0' });
await page.evaluate(() => document.fonts.ready);
const els = await page.$$('[data-out]');
for (const el of els) {
  const name = await el.evaluate((n) => n.getAttribute('data-out'));
  const transparent = await el.evaluate((n) => n.hasAttribute('data-transparent'));
  const out = path.join(outDir, name + '.png');
  await el.screenshot({ path: out, omitBackground: transparent });
  console.log(out);
}
await browser.close();
