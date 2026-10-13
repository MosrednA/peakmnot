// Runs the perf probe (peak/dev/perf.js) headless on this computer, while the dev server is running, and prints its
// table (docs/performance.md).
//   node tools/perf.mjs [--igpu] [--size 1512x945] [--dpr 2] [--out run.json] [--url http://127.0.0.1:5280/]
// --igpu asks the browser for the low-power GPU (on a laptop or a desktop with an integrated one). Set PLAYWRIGHT to
// Playwright's index.mjs if it isn't installed here, and CHROME to a browser to use instead of Playwright's own.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : args[i + 1];
};
const [width, height] = option('size', '1280x760').split('x').map(Number);
const url = new URL('peak.html?manual&perf', option('url', 'http://127.0.0.1:5280/')).href;
const { chromium } = await import(process.env.PLAYWRIGHT ? pathToFileURL(process.env.PLAYWRIGHT).href : 'playwright');

const browser = await chromium.launch({
  executablePath: process.env.CHROME || undefined,
  args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu',
    ...(args.includes('--igpu') ? ['--force_low_power_gpu'] : [])],
});
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: Number(option('dpr', 1)) });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  await page.route('https://stats.mosredna.eu/**', route => route.abort());   // the stats script, stopped on purpose
  console.log(`Running ${url} at ${width}×${height}…`);
  await page.goto(url);
  await page.waitForFunction(() => window.peakPerf, null, { polling: 500, timeout: 600000 });
  const run = await page.evaluate(() => window.peakPerf);
  console.log(run.text ?? run.error);
  if (errors.length) console.log(`\nPage errors:\n${errors.join('\n')}`);
  const out = option('out');
  if (out) writeFileSync(out, JSON.stringify({ date: new Date().toISOString(), url, errors, ...run }, null, 1));
} finally {
  await browser.close();
}
