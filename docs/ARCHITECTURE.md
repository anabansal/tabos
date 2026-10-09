# Architecture

TabOS is a Manifest V3 extension built with Vite, React 18 and TypeScript. One build produces three entry points in `dist/`:

| Entry | Role |
|---|---|
| `background.js` | Module service worker. The single writer of all state. |
| `popup.html` | Toolbar popup: quick search, current tab, workspaces. |
| `dashboard.html` | Full dashboard. Hash-routed views (`#/tabs`, `#/organize`, `#/clean`, …). |

## Data

| Store | Holds |
|---|---|
| IndexedDB (`tabos`, via Dexie) | `tabs` (one record per page, whatever its state), `workspaces`, `snapshots`, `activity` (undo log), `embeddings` (cache for remote providers), `kv`. |
| `chrome.storage.local` | Settings. Every context listens to `storage.onChanged`. |
| `chrome.storage.session` | Browser-session facts: tab-group ↔ workspace links, group cache, restart marker. Cleared on browser restart, exactly like Chrome's tab and group ids. |

A **tab record** outlives its Chrome tab. `status` moves between `open`, `sleeping`, `archived` and `closed`, and `chromeTabId` is set only while the tab is live.

## One writer, one queue

Extension pages never write to the database. They read it live (Dexie `liveQuery`) and send mutations to the worker through a typed RPC (`src/shared/messages.ts`). The worker runs every mutation **and** every Chrome event through one serial queue (`background/queue.ts`). That removes a whole class of races, for example an `onCreated` event arriving while a restore is binding the same tab to its record.

## Surviving restarts

Chrome assigns new tab ids after a browser restart, and the MV3 worker itself stops and starts constantly. On every worker start, `reconcile` (`core/reconcile.ts`, pure and unit-tested) re-matches records to live tabs:

1. same tab id (and, across browser sessions, same URL),
2. same URL, preferring similar strip position,
3. revive records whose window closed recently (browser shutdown),
4. anything left gets a new record.

Right after a browser start, records are not declared missing until a delayed second pass, because session restore may still be adding tabs. Late tabs and Ctrl+Shift+T reopenings are revived individually by `findReviveCandidate`. Workspaces, protection and history therefore stick to pages across restarts. The e2e suite verifies this with a real restart.

## Safety rules

- Protection is evaluated in one place (`core/rules.ts`): visible, audible, pinned (configurable), protected tab, protected site, protected workspace, exclusion patterns, and Chrome's own `autoDiscardable=false`.
- Archiving and closing mark records *before* removing tabs, verify afterwards, and roll back any tab that refused to close. They never close the last tab of the last window.
- Every reversible operation returns an undo payload that is stored in the activity log. Composite actions such as Clean undo in reverse order.
- Automatic archiving is opt-in and always posts a notification with Undo. Archived records and manual snapshots are never pruned.

## AI layer

`src/ai/providers.ts` defines two replaceable capabilities:

```ts
interface EmbeddingProvider { embed(items): Promise<number[][]>; thresholds; local; ... }
interface LanguageProvider  { nameGroups(groups): Promise<{ key, name, summary }[]>; local; ... }
```

`resolveProviders(settings.ai)` returns the configured providers, or falls back to the built-in ones (with a visible warning) when a key or the user's consent is missing. Remote vectors are cached by `(provider, model, text hash)`.

Organize (`ai/organize.ts`) produces a *proposal* only:

1. Tabs similar to an existing workspace are proposed for it.
2. Tabs with a confident topic (taxonomy: most-specific site rule plus keyword evidence) are grouped by topic.
3. The rest are clustered with average-linkage agglomerative clustering (`ai/cluster.ts`).
4. Groups are named by the built-in heuristics or the configured language model, then merged by name.

Semantic search (`ai/semanticSearch.ts`) parses the query (`ai/queryParser.ts`) into topic terms, kind of page, time range and state, then ranks by lexical match, embedding similarity, kind match and a soft time factor, and explains every result.
