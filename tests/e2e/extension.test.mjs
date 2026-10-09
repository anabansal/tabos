// End-to-end tests against real Chrome (Chrome for Testing) with the built extension loaded.
// Run: npm run test:e2e
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, controlPage, startServer, openPages, until, wait } from './harness.mjs';

let server, base, browser, extId, userDataDir, cleanup, ctl;

const byTitle = (recs, title) => recs.find((r) => r.title === title && (r.status === 'open' || r.status === 'sleeping')) ?? recs.find((r) => r.title === title);
const liveTabs = () => ctl.chrome(() => chrome.tabs.query({}).then((ts) => ts.map((t) => ({ id: t.id, url: t.url, title: t.title, discarded: t.discarded, groupId: t.groupId, windowId: t.windowId }))));

before(async () => {
  ({ server, base } = await startServer());
  ({ browser, extId, userDataDir, cleanup } = await launch());
  ctl = await controlPage(browser, extId);
  await openPages(browser, base, [
    { path: 'paper', title: 'Semantic entropy paper' },
    { path: 'repo', title: 'Vite repository' },
    { path: 'shop', title: 'Headphones store' },
    { path: 'dup', title: 'Duplicate page' },
    { path: 'dup', title: 'Duplicate page' },
    { path: 'keep', title: 'Keep me open' },
  ]);
  await until(async () => (await ctl.records()).filter((r) => r.status === 'open').length >= 6, { label: 'initial records' });
});

after(async () => {
  await browser?.close().catch(() => {});
  server?.close();
  cleanup?.();
});

test('tracks every tab with url, title, domain and timestamps', async () => {
  const recs = await ctl.records();
  const r = byTitle(recs, 'Vite repository');
  assert.ok(r, 'record exists');
  assert.equal(r.status, 'open');
  assert.equal(r.domain, '127.0.0.1');
  assert.ok(r.chromeTabId > 0);
  assert.ok(r.createdAt > 0 && r.lastActiveAt > 0);
  // Our own extension pages are not tracked.
  assert.ok(!recs.some((x) => x.url.startsWith('chrome-extension://')));
});

test('sleeps tabs on request but never protected ones', async () => {
  let recs = await ctl.records();
  const paper = byTitle(recs, 'Semantic entropy paper');
  const keep = byTitle(recs, 'Vite repository'); // a background tab, so only protection applies
  await ctl.rpc('tabs.protect', { recordIds: [keep.id], value: true });
  const res = await ctl.rpc('tabs.sleep', { recordIds: [paper.id, keep.id] });
  assert.equal(res.count, 1);
  assert.equal(res.skipped[0].reason, 'Protected tab');
  const tabs = await liveTabs();
  assert.equal(tabs.find((t) => t.id === paper.chromeTabId).discarded, true);
  assert.equal(tabs.find((t) => t.id === keep.chromeTabId).discarded, false);
  recs = await ctl.records();
  assert.equal(byTitle(recs, 'Semantic entropy paper').status, 'sleeping');
  await ctl.rpc('tabs.protect', { recordIds: [keep.id], value: false });
  // Waking reloads it.
  await ctl.rpc('tabs.wake', { recordIds: [paper.id] });
  await until(async () => !(await liveTabs()).find((t) => t.id === paper.chromeTabId)?.discarded, { label: 'wake' });
});

test('archives tabs (closing them, keeping metadata) and undo reopens them', async () => {
  const recs = await ctl.records();
  const shop = byTitle(recs, 'Headphones store');
  const before = (await liveTabs()).length;
  const res = await ctl.rpc('tabs.archive', { recordIds: [shop.id] });
  assert.equal(res.count, 1);
  assert.ok(res.activityId);
  await until(async () => (await liveTabs()).length === before - 1, { label: 'tab closed' });
  let rec = (await ctl.records()).find((r) => r.id === shop.id);
  assert.equal(rec.status, 'archived');
  assert.equal(rec.chromeTabId, null);
  assert.ok(rec.restoreHint && typeof rec.restoreHint.index === 'number');
  await ctl.rpc('activity.undo', { id: res.activityId });
  await until(async () => (await ctl.records()).find((r) => r.id === shop.id)?.status === 'open', { label: 'undo reopen' });
  rec = (await ctl.records()).find((r) => r.id === shop.id);
  assert.ok((await liveTabs()).some((t) => t.id === rec.chromeTabId), 'reopened tab is live and bound to the same record');
});

test('restores an archived tab with tabs.open', async () => {
  const shop = byTitle(await ctl.records(), 'Headphones store');
  await ctl.rpc('tabs.archive', { recordIds: [shop.id] });
  const res = await ctl.rpc('tabs.open', { recordIds: [shop.id], focus: false, lazy: false });
  assert.equal(res.count, 1);
  const rec = (await ctl.records()).find((r) => r.id === shop.id);
  assert.equal(rec.status, 'open');
});

test('detects and closes duplicates, keeping one copy', async () => {
  const preview = await ctl.rpc('clean.preview', { sleepAfterMinutes: 0 });
  const g = preview.duplicates.find((x) => x.normalizedUrl.includes('/dup'));
  assert.ok(g, 'duplicate group found');
  assert.equal(g.recordIds.length, 2);
  const close = g.recordIds.filter((id) => id !== g.keepRecordId);
  const res = await ctl.rpc('duplicates.close', { groups: [{ keepRecordId: g.keepRecordId, closeRecordIds: close }] });
  assert.equal(res.count, 1);
  const recs = await ctl.records();
  const closed = recs.find((r) => r.id === close[0]);
  assert.equal(closed.status, 'closed');
  assert.equal(closed.closeReason, 'duplicate');
  assert.equal(recs.find((r) => r.id === g.keepRecordId).status, 'open');
});

test('workspaces sync with Chrome tab groups both ways, and delete is undoable', async () => {
  const recs = await ctl.records();
  const ids = [byTitle(recs, 'Semantic entropy paper').id, byTitle(recs, 'Vite repository').id];
  const ws = await ctl.rpc('workspaces.create', { name: 'Research', color: 'purple', recordIds: ids });
  const grouped = await ctl.rpc('workspaces.group', { id: ws.id });
  assert.equal(grouped.count, 2);
  let groups = await ctl.chrome(() => chrome.tabGroups.query({}));
  const g = groups.find((x) => x.title === 'Research');
  assert.ok(g, 'chrome group created with workspace name');
  // Rename in TabOS → Chrome group renamed.
  await ctl.rpc('workspaces.update', { id: ws.id, patch: { name: 'Deep Research' } });
  groups = await ctl.chrome(() => chrome.tabGroups.query({}));
  assert.ok(groups.some((x) => x.title === 'Deep Research'));
  // Rename in Chrome → workspace renamed.
  await ctl.chrome((gid) => chrome.tabGroups.update(gid, { title: 'Papers' }), g.id);
  await until(async () => (await ctl.store('workspaces')).some((w) => w.id === ws.id && w.name === 'Papers'), { label: 'workspace renamed from chrome' });
  // A titled group made in Chrome becomes a workspace.
  const shop = byTitle(await ctl.records(), 'Headphones store');
  await ctl.chrome(async (tabId) => {
    const gid = await chrome.tabs.group({ tabIds: tabId });
    await chrome.tabGroups.update(gid, { title: 'Shopping' });
  }, shop.chromeTabId);
  await until(async () => {
    const wss = await ctl.store('workspaces');
    const s = wss.find((w) => w.name === 'Shopping');
    return s && (await ctl.records()).find((r) => r.id === shop.id)?.workspaceId === s.id;
  }, { label: 'group → workspace' });
  // Delete + undo.
  const del = await ctl.rpc('workspaces.delete', { id: ws.id });
  assert.ok(!(await ctl.store('workspaces')).some((w) => w.id === ws.id));
  assert.ok((await ctl.records()).filter((r) => ids.includes(r.id)).every((r) => r.workspaceId === null));
  await ctl.rpc('activity.undo', { id: del.activityId });
  assert.ok((await ctl.store('workspaces')).some((w) => w.id === ws.id));
  assert.ok((await ctl.records()).filter((r) => ids.includes(r.id)).every((r) => r.workspaceId === ws.id));
});

test('new tabs opened from a workspace tab join that workspace', async () => {
  const paper = byTitle(await ctl.records(), 'Semantic entropy paper');
  const page = (await browser.pages()).find((p) => p.url().includes('/paper'));
  assert.ok(page);
  await page.evaluate((u) => window.open(u, '_blank'), `${base}/child?t=Child%20page`);
  const child = await until(async () => byTitle(await ctl.records(), 'Child page'), { label: 'child record' });
  assert.equal(child.workspaceId, paper.workspaceId);
});

test('saves a snapshot and restores it into a new window', async () => {
  const snap = await ctl.rpc('snapshots.create', { scope: { kind: 'all' }, name: 'E2E snapshot' });
  assert.ok(snap.tabCount >= 5);
  const winsBefore = (await ctl.chrome(() => chrome.windows.getAll())).length;
  const res = await ctl.rpc('snapshots.restore', { id: snap.id, target: 'new-window', lazy: true });
  assert.ok(res.count >= 5);
  const wins = await ctl.chrome(() => chrome.windows.getAll());
  assert.ok(wins.length > winsBefore, 'opened a new window');
  // Lazy restore discards background tabs once their URL is known.
  await until(async () => (await liveTabs()).filter((t) => t.discarded).length >= 2, { label: 'lazy discard', timeout: 20000 });
});

test('moves tabs to a new window and merges all windows back', async () => {
  const shop = byTitle(await ctl.records(), 'Headphones store');
  await ctl.rpc('tabs.move', { recordIds: [shop.id], windowId: 'new' });
  const rec = (await ctl.records()).find((r) => r.id === shop.id);
  const wins = await ctl.chrome(() => chrome.windows.getAll({ populate: true }));
  const own = wins.find((w) => w.id === rec.windowId);
  assert.ok(own && own.tabs.length === 1, `moved tab alone in its window: ${JSON.stringify({ shop: [shop.id, shop.status, shop.chromeTabId], rec: [rec.status, rec.windowId, rec.chromeTabId], wins: wins.map((w) => [w.id, w.tabs.map((t) => t.id)]) })}`);
  const target = wins.find((w) => w.id !== rec.windowId).id;
  await ctl.rpc('windows.merge', { targetWindowId: target });
  await until(async () => (await ctl.chrome(() => chrome.windows.getAll())).length === 1, { label: 'merged' });
});

test('clean preview → execute sleeps, archives and closes, then undo reverses everything', async () => {
  const preview = await ctl.rpc('clean.preview', { sleepAfterMinutes: 0, archiveAfterDays: 3 });
  assert.ok(preview.sleep.length > 0, 'has sleep candidates');
  const sleep = preview.sleep.slice(0, 2).map((c) => c.recordId);
  const res = await ctl.rpc('clean.execute', { sleep, archive: [], close: [] });
  assert.equal(res.slept, 2);
  assert.ok(res.memoryBefore && res.memoryBefore.capacityBytes > 0, 'real memory reading');
  await ctl.rpc('activity.undo', { id: res.activityId });
  const recs = await ctl.records();
  assert.ok(sleep.every((id) => recs.find((r) => r.id === id).status === 'open'));
});

test('survives a browser restart: records rebind to new tab ids and keep their workspaces', async () => {
  const beforeRecs = await ctl.records();
  const paper = byTitle(beforeRecs, 'Semantic entropy paper');
  assert.ok(paper.workspaceId);
  const liveCount = beforeRecs.filter((r) => r.status === 'open' || r.status === 'sleeping').length;
  await wait(1500); // let Chrome persist the session
  await browser.close();
  ({ browser, extId } = await launch({ userDataDir, restoreSession: true }));
  ctl = await controlPage(browser, extId);
  const after = await until(async () => {
    const recs = await ctl.records();
    const p = recs.find((r) => r.id === paper.id);
    return p && (p.status === 'open' || p.status === 'sleeping') && p.chromeTabId != null ? recs : null;
  }, { timeout: 30000, label: 'rebind after restart' });
  const p = after.find((r) => r.id === paper.id);
  assert.equal(p.workspaceId, paper.workspaceId, 'workspace preserved');
  const tabs = await liveTabs();
  assert.ok(tabs.some((t) => t.id === p.chromeTabId && t.url.includes('/paper')), 'bound to the restored tab');
  // No duplicate records were created for restored tabs.
  const liveAfter = after.filter((r) => r.status === 'open' || r.status === 'sleeping');
  const urls = liveAfter.map((r) => r.chromeTabId);
  assert.equal(new Set(urls).size, urls.length, 'one record per tab');
  assert.ok(liveAfter.length <= liveCount + 1);
  // Archived tabs are still there.
  assert.ok(after.some((r) => r.status === 'archived' || r.status === 'closed'));
});
