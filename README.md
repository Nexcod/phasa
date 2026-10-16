# Phasa

Chrome extension (Manifest V3) that turns YouTube videos with Thai subtitles into study material:
interactive Thai subtitles, word lookups with romanization and tones, known-word tracking, difficulty
estimates, optional AI explanations via Sign in with ChatGPT.

## Status

| Phase (docs/plan.md §12)   | Status                                                                                                                                                                                                                            |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 — spikes and decisions   | **Accepted 2026-10-16**: captions source (ADR 0002), Sign in with ChatGPT via a DNR redirect (ADR 0003), data sources (ADR 0004), segmentation baseline (ADR 0005) — see [docs/spikes.md](docs/spikes.md)                         |
| 1 — scaffold               | **Accepted 2026-10-16**: loads unpacked in Chrome, an empty overlay mounts on youtube.com watch pages, the toolbar button opens the side panel, unit + e2e tests and CI are green; `pnpm dev` builds and serves the dev extension |
| 2 — captions and rendering | Not started                                                                                                                                                                                                                       |

## Development

Requirements: Node ≥ 22.12 (see `.nvmrc`), pnpm via corepack (`corepack enable`).

```sh
pnpm install
pnpm dev            # dev build with HMR into .output/chrome-mv3-dev
pnpm build          # production build into .output/chrome-mv3
pnpm zip            # store-ready zip
```

Load the build: `chrome://extensions` → Developer mode → **Load unpacked** → `.output/chrome-mv3`
(or `-dev`). Open a YouTube watch page; the toolbar button opens the side panel.

| Command                     | What it does                                                                                                               |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint` / `pnpm format` | ESLint (type-aware) / Prettier                                                                                             |
| `pnpm typecheck`            | `tsc --noEmit`                                                                                                             |
| `pnpm test`                 | Vitest unit tests                                                                                                          |
| `pnpm test:e2e`             | Build + Playwright e2e with the extension loaded, youtube.com stubbed (first run: `pnpm exec playwright install chromium`) |
| `pnpm test:e2e:network`     | e2e against real youtube.com (`@network`, nightly in CI)                                                                   |
| `pnpm spike:seg [file]`     | Segmentation baseline: `Intl.Segmenter` vs a gold file                                                                     |

## Layout

```
entrypoints/   background (SW), youtube.content (overlay), youtube-main.content (MAIN world),
               sidepanel, options
src/           messaging (typed Port protocol), db (Dexie schema + migrations), background,
               thai, captions, dictionary, i18n, ui
tests/         unit (Vitest), e2e (Playwright), fixtures
spikes/        phase-0 experiment kits (not shipped)
docs/          plan.md, spikes.md, decisions/ (ADRs)
```

Architecture rules (also in `AGENTS.md`): IndexedDB only in extension-origin contexts; content
scripts talk to the service worker through `src/messaging`; OpenAI tokens never leave the service
worker. The first two are enforced by ESLint and a runtime guard.

## License

Copyright (C) 2026 Phasa contributors.

Phasa is free software: you can redistribute it and/or modify it under the terms of the
[GNU Affero General Public License](LICENSE) as published by the Free Software Foundation, either
version 3 of the License, or (at your option) any later version (`AGPL-3.0-or-later`). It is
distributed WITHOUT ANY WARRANTY; see the license for details. This covers the extension and any
future server code in this repository; see [ADR 0006](docs/decisions/0006-license.md).

Dictionary and frequency data in `data/build/` are licensed separately (CC BY-SA 4.0 and others),
see [data/build/ATTRIBUTION.md](data/build/ATTRIBUTION.md). Contributions: [CONTRIBUTING.md](CONTRIBUTING.md).

Phasa is not affiliated with YouTube or OpenAI.
