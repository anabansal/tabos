// Walkthrough a first-time user would take, with screenshots of every screen (used for docs/screenshots).
// Run: npm run build && node tests/e2e/walkthrough.mjs docs/screenshots
import { launch, controlPage, startServer, until, wait } from './harness.mjs';
import { mkdirSync } from 'node:fs';
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
const { server } = await startServer();
const { browser, extId, cleanup } = await launch();
const shot = async (page, name, w = 1366, h = 860) => {
  await page.setViewport({ width: w, height: h });
  await wait(500);
  await page.screenshot({ path: `${OUT}/${name}.png` });
};
try {
  const ctl = await controlPage(browser, extId);
  const tabs = [
    ['https://arxiv.org/abs/2302.09664', 'Semantic Uncertainty: Linguistic Invariances for Uncertainty Estimation in Natural Language Generation'],
    ['https://www.nature.com/articles/s41586-024-07421-0', 'Detecting hallucinations in large language models using semantic entropy | Nature'],
    ['https://huggingface.co/meta-llama/Llama-3.1-8B', 'meta-llama/Llama-3.1-8B · Hugging Face'],
    ['https://lilianweng.github.io/posts/2023-06-23-agent/', "LLM Powered Autonomous Agents | Lil'Log"],
    ['https://github.com/facebook/react/issues/123', 'useEffect cleanup runs twice · Issue #123 · facebook/react'],
    ['https://stackoverflow.com/questions/41/how-to-type-react-props', 'How to type React props in TypeScript - Stack Overflow'],
    ['https://developer.mozilla.org/en-US/docs/Web/API/fetch', 'fetch() global function - Web APIs | MDN'],
    ['https://vite.dev/guide/build', 'Building for Production | Vite'],
    ['https://www.amazon.com/dp/B09XS7JWHH', 'Sony WH-1000XM5 Wireless Noise Canceling Headphones : Amazon.com'],
    ['https://www.bestbuy.com/site/bose-quietcomfort-ultra', 'Bose QuietComfort Ultra Headphones - Best Buy'],
    ['https://www.flipkart.com/laptops/pr', 'Buy Laptops Online at Best Prices | Flipkart'],
    ['https://canvas.instructure.com/courses/42/assignments/7', 'Assignment 3: Dynamic Programming - CS 161'],
    ['https://www.gradescope.com/courses/1', 'CS 161 Gradescope'],
    ['https://cs161.stanford.edu/lectures/week5', 'Lecture 5: Graph Algorithms'],
    ['https://www.ycombinator.com/library/4D-how-to-raise-a-seed-round', 'How to Raise a Seed Round : YC Startup Library'],
    ['https://paulgraham.com/startupideas.html', 'How to Get Startup Ideas'],
    ['https://techcrunch.com/2026/10/01/ai-startup-series-a/', 'AI startup raises $20M Series A | TechCrunch'],
    ['https://www.youtube.com/watch?v=kCc8FmEb1nY', "Let's build GPT: from scratch, in code, spelled out. - YouTube"],
    ['https://www.amazon.com/dp/B09XS7JWHH', 'Sony WH-1000XM5 Wireless Noise Canceling Headphones : Amazon.com'],
    ['https://docs.google.com/document/d/1abc/edit', 'Q4 roadmap and sprint planning - Google Docs'],
  ].map(([url, title]) => ({ url, title }));
  for (const t of tabs) {
    const p = await browser.newPage();
    await p.setRequestInterception(true);
    p.on('request', (req) => {
      if (req.isNavigationRequest()) req.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: `<!doctype html><meta charset="utf-8"><title>${t.title}</title><h1>${t.title}</h1>` });
      else req.respond({ status: 404, body: '' });
    });
    await p.goto(t.url);
  }
  await until(async () => (await ctl.records()).filter((r) => r.status === 'open').length >= tabs.length, { label: 'records', timeout: 20000 });
  // Make some tabs look old so Clean has suggestions.
  await ctl.page.evaluate(
    () =>
      new Promise((ok) => {
        const open = indexedDB.open('tabos');
        open.onsuccess = () => {
          const tx = open.result.transaction('tabs', 'readwrite');
          const st = tx.objectStore('tabs');
          st.getAll().onsuccess = (e) => {
            const recs = e.target.result;
            recs.forEach((r, i) => {
              if (i % 3 === 0) {
                r.lastActiveAt = Date.now() - (2 + i) * 86400000;
                st.put(r);
              }
            });
          };
          tx.oncomplete = () => ok();
        };
      }),
  );

  const dash = await browser.newPage();
  const errs = [];
  dash.on('pageerror', (e) => errs.push(e.message));
  dash.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  const go = async (hash, wait_ = 1200) => {
    await dash.goto(`chrome-extension://${extId}/dashboard.html#${hash}`);
    await wait(wait_);
  };
  const click = (text) => dash.evaluate((t) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().includes(t))?.click(), text);

  await go('/welcome', 1500);
  await shot(dash, '01-tabs-first-run');

  const pop = await browser.newPage();
  await pop.goto(`chrome-extension://${extId}/popup.html`);
  await pop.setViewport({ width: 360, height: 590 });
  await wait(800);
  await (await pop.$('.popup-root')).screenshot({ path: `${OUT}/02-popup.png` });
  await pop.type('input', 'headph');
  await wait(400);
  await (await pop.$('.popup-root')).screenshot({ path: `${OUT}/03-popup-search.png` });

  await go('/group-tabs', 800);
  await shot(dash, '04-group-tabs-start');
  await click('Suggest Groups');
  await wait(2500);
  await shot(dash, '05-group-tabs-proposal');
  await click('Apply Groups');
  await wait(2500);
  await go('/', 1500);
  await shot(dash, '06-tabs-grouped');
  await dash.bringToFront(); // hover needs a visible tab
  const row = await dash.$('.tab-row');
  if (row) {
    await row.hover();
    await wait(300);
    await dash.evaluate(() => document.querySelector('.tab-row .actions button[aria-label="More"]')?.click());
    await wait(400);
    await shot(dash, '06b-row-menu');
    await dash.keyboard.press('Escape');
  }
  await go('/?by=window', 1000);
  await shot(dash, '07-tabs-by-window');
  const firstGroup = await dash.evaluate(() => document.querySelector('a[href^="#/group/"]')?.getAttribute('href'));
  if (firstGroup) {
    await go(firstGroup.slice(1), 1000);
    await shot(dash, '08-group');
  }
  await go('/tidy', 1800);
  await shot(dash, '09-tidy');
  await go(`/search?q=${encodeURIComponent('that paper about semantic entropy I opened last week')}`, 2000);
  await shot(dash, '10-search');
  await go('/history', 1000);
  await shot(dash, '11-history');
  await go('/settings', 1000);
  await shot(dash, '12-settings');
  await dash.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await go('/', 1200);
  await shot(dash, '13-tabs-dark');
  await dash.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await go('/', 1000);
  await shot(dash, '14-tabs-narrow', 420, 860);
  console.log('errors:', JSON.stringify(errs));
} finally {
  await browser.close();
  server.close();
  cleanup();
}
