# Contributing to TabOS

Thanks for helping. Bug reports, ideas and pull requests are all welcome.

## Getting started

```bash
git clone https://github.com/anabansal/tabos.git
cd tabos
npm install
npm run dev
```

Load `dist/` at `chrome://extensions` (Developer mode → Load unpacked). After each rebuild, click the reload icon on the TabOS card.

## Before opening a pull request

```bash
npm run build      # typecheck + build
npm test           # unit tests
npm run test:e2e   # end-to-end tests in Chrome for Testing
```

All three should pass.

## Guidelines

- **Safety first.** Never close, discard or delete tabs without the user seeing it, and keep every destructive action undoable. New operations should return an undo payload (see `src/background/activity.ts`).
- **One writer.** UI code reads IndexedDB but sends all mutations to the service worker through `rpc()` (`src/shared/messages.ts`).
- **Keep logic pure and tested.** Rules, matching and ranking live in `src/core` and `src/ai` without Chrome API calls, so they can be unit tested.
- **Privacy.** Nothing leaves the device without explicit opt-in. Don't add permissions to the required list if they can be optional.
- **Fewer, clearer choices in the UI.** Show the one or two actions people need; put the rest behind a menu or "More settings".
- Match the existing code style: TypeScript strict mode, small modules, comments that explain *why*.

## Reporting bugs

Please include your Chrome version, what you did, what you expected, and what happened. Dashboard → Settings → More settings → Data shows the worker status, which is useful to include.
