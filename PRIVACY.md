# Privacy

TabOS is local-first. There is no TabOS server, account, analytics or telemetry.

## What TabOS stores, and where

All data lives in your browser profile on this device:

- **Tab records:** URL, title, site, favicon URL, timestamps, state, workspace, and window position for restore.
- **Workspaces, snapshots and the undo history.**
- **Settings**, including any API keys you enter.
- **Page descriptions**, only if you turn on "Read page descriptions": the `<meta name="description">`, keywords and site name. Never page text.
- **Embedding cache**, only if you connect a remote AI provider: vectors for tab titles and URLs, so they aren't re-sent.

Incognito tabs are never seen; the extension cannot run in incognito.

Recently closed tabs are removed after the retention period you choose (60 days by default). Archived tabs and snapshots you save are never deleted unless you delete them.

## What leaves your device

Nothing, by default.

If you connect an AI provider **and** tick the consent box, TabOS sends that provider the **titles and URLs** of the tabs involved (plus meta descriptions, if collected) when you use Organize, Search or Related tabs. It never sends page contents, cookies or browsing history, and never sends tabs matching your exclusion patterns. Ollama running on `localhost` stays on your device.

## Sites TabOS never reads

Even with site access granted, page descriptions are never read on AI chat apps (ChatGPT, Gemini, Copilot, Perplexity and similar), email, messaging, banking, payment or sign-in pages, or any site you exclude.

## Exports

Exports are JSON files saved where you choose. API keys are always removed from exports.

## Removing everything

Remove the extension from `chrome://extensions`. Chrome deletes all of its data with it.
