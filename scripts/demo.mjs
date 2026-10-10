// Opens a separate Chrome (Chrome for Testing) window with TabOS loaded and a set of sample tabs,
// so you can try the extension without touching your own browser profile.
// Run: npm run demo     (close the window to quit)
//      node scripts/demo.mjs --light   opens fewer sample tabs on low-memory machines
import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const profile = join(tmpdir(), 'tabos-demo-profile');
mkdirSync(profile, { recursive: true });

const SAMPLE_TABS = [
  'https://arxiv.org/abs/1706.03762',
  'https://www.nature.com/articles/s41586-024-07421-0',
  'https://huggingface.co/docs/transformers/index',
  'https://github.com/facebook/react',
  'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API',
  'https://vite.dev/guide/',
  'https://www.amazon.com/s?k=noise+cancelling+headphones',
  'https://www.bestbuy.com/site/searchpage.jsp?st=headphones',
  'https://www.ebay.com/sch/i.html?_nkw=airpods',
  'https://www.coursera.org/learn/machine-learning',
  'https://www.khanacademy.org/computing/computer-science/algorithms',
  'https://www.ycombinator.com/library',
  'https://paulgraham.com/startupideas.html',
  'https://www.youtube.com/results?search_query=build+gpt+from+scratch',
  'https://github.com/facebook/react',
];

const browser = await puppeteer.launch({
  headless: false,
  pipe: true,
  enableExtensions: true,
  userDataDir: profile,
  defaultViewport: null,
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`, '--no-first-run', '--no-default-browser-check', '--start-maximized'],
});
const sw = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('background.js'), { timeout: 20000 });
const extId = new URL(sw.url()).host;

const existing = await browser.pages();
if (existing.length <= 2) {
  const light = process.argv.includes('--light');
  const urls = light ? [...new Set(SAMPLE_TABS)].filter((_, i) => i % 2 === 0) : SAMPLE_TABS;
  for (const url of urls) {
    const p = await browser.newPage();
    p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  }
}
const dash = await browser.newPage();
await dash.goto(`chrome-extension://${extId}/dashboard.html#/welcome`);
await dash.bringToFront();

console.log('TabOS demo is running.');
console.log('  • Click the puzzle-piece icon → pin TabOS, then click it for the popup (or Alt+Shift+K).');
console.log('  • The TabOS tab that just opened: try Group Tabs, Tidy Up, and the search bar.');
console.log('  • Close the Chrome window to quit.');
browser.on('disconnected', () => process.exit(0));
