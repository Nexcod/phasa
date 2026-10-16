# Phase 0 spike kits

Throwaway, plain-JS MV3 extensions for the experiments in [`docs/spikes.md`](../docs/spikes.md).
No build step: `chrome://extensions` → Developer mode → **Load unpacked** → pick the folder.
They are not part of the product build. Record results in `docs/spikes.md`, then the kit can go.

## Captions

`spikes/captions-extension/` — MAIN-world `document_start` script on `www.youtube.com`.

- Open any `/watch` page; console filter `[phasa-spike]`.
- Automatic per video: track list → wait 2 s for the player's own Thai request → otherwise
  `enableThai()` + hide native captions → probe URL variants with the captured `pot` → print a JSON
  report.
- Console API: `phasaSpike.tracks()`, `.enableThai()`, `.hideNative(true|false)`, `.probe()`,
  `.report()`, `.save()` (downloads the Thai json3 body; keep it under `captures/`, git-ignored).
- Disable the automatic run: `localStorage.setItem('phasa-spike:auto', 'off')`.
- Must run in a normal Chrome window: under Playwright/automation YouTube returns empty timedtext
  bodies.
- **Side effect:** `enableThai()` uses `setOption`, which makes YouTube remember Thai as the sticky
  caption language (captions on every video, machine-translated Thai where no Thai track exists).
  Afterwards: remove `yt-player-caption-sticky-language` from youtube.com localStorage and switch CC
  off with the player button.

## Sign in with ChatGPT

`spikes/siwc-extension/` — click the toolbar icon to open the spike page.

- Sign in via **A1** (DNR redirect) or **A2** (webNavigation), list models, stream plain /
  `json_schema` / long responses from the service worker, refresh, sign out, forget.
- Tokens stay in the SW and `chrome.storage.local` of this spike extension; the log masks them.
  Use **Forget everything** and remove the extension when done.
- Needs a ChatGPT Plus/Pro account.
