// Shared E2E harness: launches Chrome for Testing with the built extension (dist/), serves local
// test pages, and talks to the service worker through the same RPC channel the UI uses.
import puppeteer from 'puppeteer';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DIST = join(root, 'dist');

export function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const title = url.searchParams.get('t') || url.pathname.slice(1) || 'Home';
    const desc = url.searchParams.get('d') || '';
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><head><title>${title}</title><meta name="description" content="${desc}"></head><body><h1>${title}</h1><p>${url.pathname}</p></body></html>`);
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, base: `http://127.0.0.1:${server.address().port}` })));
}

export async function launch({ userDataDir, headless = true, restoreSession = false } = {}) {
  const dir = userDataDir ?? mkdtempSync(join(tmpdir(), 'tabos-e2e-'));
  const args = [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, '--no-first-run', '--no-default-browser-check'];
  if (restoreSession) args.push('--restore-last-session');
  const browser = await puppeteer.launch({ headless, userDataDir: dir, args, pipe: true, enableExtensions: true, defaultViewport: null });
  const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('background.js'), { timeout: 20000 });
  const extId = new URL(swTarget.url()).host;
  return { browser, extId, userDataDir: dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** An extension page used as a control channel (RPC + raw IndexedDB reads). */
export async function controlPage(browser, extId) {
  const page = await browser.newPage();
  await page.goto(`chrome-extension://${extId}/popup.html#control`);
  return {
    page,
    rpc: (type, req = {}) =>
      page.evaluate(
        (type, req) =>
          chrome.runtime.sendMessage({ __tabos: 1, type, req }).then((r) => {
            if (!r?.ok) throw new Error(r?.error || 'no reply');
            return r.data;
          }),
        type,
        req,
      ),
    records: () =>
      page.evaluate(
        () =>
          new Promise((ok, fail) => {
            const open = indexedDB.open('tabos');
            open.onerror = () => fail(open.error);
            open.onsuccess = () => {
              const tx = open.result.transaction('tabs', 'readonly');
              const all = tx.objectStore('tabs').getAll();
              all.onsuccess = () => {
                ok(all.result);
                open.result.close();
              };
            };
          }),
      ),
    store: (name) =>
      page.evaluate(
        (name) =>
          new Promise((ok) => {
            const open = indexedDB.open('tabos');
            open.onsuccess = () => {
              const all = open.result.transaction(name, 'readonly').objectStore(name).getAll();
              all.onsuccess = () => {
                ok(all.result);
                open.result.close();
              };
            };
          }),
        name,
      ),
    chrome: (fn, ...args) => page.evaluate(fn, ...args),
  };
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function until(fn, { timeout = 10000, interval = 200, label = 'condition' } = {}) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    last = await fn();
    if (last) return last;
    await wait(interval);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

export async function openPages(browser, base, specs) {
  const pages = [];
  for (const s of specs) {
    const p = await browser.newPage();
    await p.goto(`${base}/${s.path}?t=${encodeURIComponent(s.title)}${s.desc ? `&d=${encodeURIComponent(s.desc)}` : ''}`);
    pages.push(p);
  }
  return pages;
}

/** Open a page at a real-looking URL, served offline by request interception (no network needed). */
export async function openFakeSite(browser, url, title) {
  const p = await browser.newPage();
  await p.setRequestInterception(true);
  p.on('request', (req) => {
    if (req.isNavigationRequest()) req.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: `<!doctype html><meta charset="utf-8"><title>${title}</title><h1>${title}</h1>` });
    else req.respond({ status: 404, body: '' });
  });
  await p.goto(url);
  return p;
}
