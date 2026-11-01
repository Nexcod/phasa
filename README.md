# Phasa

Chrome extension (Manifest V3) that turns YouTube videos with Thai subtitles into study material:
interactive Thai subtitles, word lookups with romanization and tones, known-word tracking, difficulty
estimates, optional AI explanations via Sign in with ChatGPT.

## Status

| Phase (docs/plan.md §12)    | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0 — spikes and decisions    | **Accepted 2026-10-16**: captions source (ADR 0002), Sign in with ChatGPT via a DNR redirect (ADR 0003), data sources (ADR 0004), segmentation baseline (ADR 0005) — see [docs/spikes.md](docs/spikes.md)                                                                                                                                                                                                                                                                      |
| 1 — scaffold                | **Accepted 2026-10-16**: loads unpacked in Chrome, an empty overlay mounts on youtube.com watch pages, the toolbar button opens the side panel, unit + e2e tests and CI are green; the `dev` script builds and serves the dev extension                                                                                                                                                                                                                                        |
| 2 — captions and rendering  | **Accepted 2026-10-28** after the [manual checklist](docs/manual-checklist.md) in Chrome and the local network e2e (ADR 0009): Thai + English subtitles over the player from the player's own PoToken (ADR 0007), cached per video; Noto Sans Thai Looped; side-panel transcript; hotkeys A/D/S/Space/T; auto-pause. Live run: Thai ready 0.5–1.7 s after the player loads (docs/spikes.md §1 run 3)                                                                           |
| 3 — words                   | **Accepted 2026-11-01** after the [manual checklist](docs/manual-checklist.md) in Chrome and the local network e2e: Wiktionary dictionary + TNC ranks (ADR 0010), tokenizer (F1 0.963 on 249 real cues from 13 videos, 0.966 overall; native-speaker review of the gold set after phase 7), word popup (15 ms in e2e) with romanization, tones, TTS, statuses, phrases, boundary fixes; keys W/Q/E, 1–4/K/X; saved words with context in the side panel and options            |
| 4 — analysis and onboarding | **Accepted 2026-11-01** after the [manual checklist](docs/manual-checklist.md) in Chrome and the local network e2e: badge under the title and in the side panel — level estimate, share of known words, distinct new words (ADR 0011, 0012) — with details, top new words, add top 10 to learning, mark all as known; onboarding with particles, top-N review and TXT/CSV/Anki import. 20-minute video analyzed in 79 ms; level calibration on hand-rated videos after phase 7 |

**After phase 7**, with the owner's or a native speaker's input: native-speaker review of the
segmentation gold set ([guide](docs/segmentation-review/GUIDE.md)), level calibration on 30–50
hand-rated videos (`tests/fixtures/levels.csv`, ADR 0011), Volubilis as a second dictionary
(ADR 0010).

## Development

Requirements: Node ≥ 22.12 (see `.nvmrc`) and npm ≥ 11.19 for the install-script and release-age
policy in `.npmrc` ([ADR 0008](docs/decisions/0008-npm.md)).

```sh
npm install
npm run dev        # dev build with HMR into .output/chrome-mv3-dev
npm run build      # production build into .output/chrome-mv3
npm run zip        # store-ready zip
```

Load the build: `chrome://extensions` → Developer mode → **Load unpacked** → `.output/chrome-mv3`
(or `-dev`). Open a YouTube watch page with Thai captions; the toolbar button opens the side panel.
Live captions can't be tested under automation; [docs/manual-checklist.md](docs/manual-checklist.md)
lists the checks done by hand.

| Command                                           | What it does                                                                                                                |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint` / `npm run format`                 | ESLint (type-aware) / Prettier                                                                                              |
| `npm run typecheck`                               | `tsc --noEmit`                                                                                                              |
| `npm test`                                        | Vitest unit tests                                                                                                           |
| `npm run test:e2e`                                | Build (with dev-only test pages) + Playwright e2e against a fake youtube.com (first run: `npx playwright install chromium`) |
| `npm run test:e2e:network`                        | e2e against real youtube.com (`@network`); run locally, YouTube blocks CI runners (ADR 0009)                                |
| `npm run spike:seg [file]`                        | Segmentation baseline: `Intl.Segmenter` vs a gold file                                                                      |
| `npm run seg:eval`                                | The tokenizer with the built dictionary vs `tests/fixtures/segmentation.tsv`, with mismatches                               |
| `npm run seg:review:export` / `seg:review:import` | Spreadsheet for a native-speaker check of the gold set and applying the result ([guide](docs/segmentation-review/GUIDE.md)) |
| `npm run data:freq` / `data:dict`                 | Rebuild `data/build/` from the sources (cached in `data/raw/`; `-- --refresh` downloads again; ADR 0010)                    |
| `npm run fonts:fetch`                             | Re-download the bundled Thai fonts into `public/fonts/` (committed; see its README)                                         |

## Layout

```
entrypoints/   background (SW), youtube.content (overlay, title badge), youtube-main.content
               (MAIN world), sidepanel, options, fonts-test (dev/test builds only)
src/           captions (parsers, processing, track choice; main/ = MAIN-world fetcher),
               content (overlay state, playback sync, hotkeys, panel link, word data),
               messaging (typed Port protocols), db (Dexie schema + migrations), background
               (SW handlers, tokenizing and lookups, analysis, onboarding), settings, thai
               (normalization, tokenizer, segmentation convention, romanization), dictionary
               (kaikki conversion, store, pronunciation, frequency list), analysis (coverage,
               level, top new words), vocab (saved words, contexts, segmentation rules, bulk
               changes, word-list import), i18n, ui
data/build/    built dictionary and frequency list (committed, CC BY-SA 4.0, ATTRIBUTION.md)
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
