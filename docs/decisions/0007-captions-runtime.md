# 0007. Captions runtime: fetch, choose, cache, render, sync

- Status: Accepted
- Date: 2026-10-16
- Evidence: docs/plan.md §4, §5.1–5.2, §12 phase 2; docs/spikes.md §1 run 3; unit and e2e tests

## Context

ADR 0002 fixed the captions source: the player's own timedtext request supplies a PoToken, and we
refetch the tracks we need with it. Phase 2 turns that into the product pipeline. Run 3 against live
YouTube (docs/spikes.md §1) added facts the spike had not covered.

## Decision

**MAIN world** (`src/captions/main/`, no extension APIs, no user data):

1. Patch `fetch`/XHR at `document_start` and log timedtext requests per video with status and body.
2. Report a video only when the URL's `v` and `getPlayerResponse().videoDetails.videoId` agree.
3. On a fetch request:
   - Wait for the player to report that video (≤ 3 s), because it can briefly report the previous
     one after an SPA switch.
   - Take the PoToken from a **completed, non-empty** player request. Wait up to 1.5 s for one
     (0.4 s once this tab needed a forced load).
   - Otherwise force it: wait out a pre-roll ad, hide native captions, call `setOption` with Thai,
     restore the previous track and both caption keys byte for byte.
4. Build each track URL from its `baseUrl` plus **every** parameter of the captured request except
   `lang`/`kind`/`tlang`/`fmt`/`name`. `pot` alone returns an empty body; `c`, `cver` and the rest
   must travel with it. Reuse the player's own json3 body when it is the requested track. Retry an
   empty 200 twice.

**Bridge** (`src/captions/bridge.ts`): `window.postMessage` with a per-load nonce chosen by the
isolated script. Both sides validate every message. The nonce separates our traffic from other
`message` events; it is not a secret.

**Choice of tracks** (`src/captions/tracks.ts`):

- Thai: the manual track, unless its on-screen coverage is below half of the auto-generated
  track's. Live, two "manual" tracks held 2 and 5 cues for whole songs.
- English line: a manual `en*` track if present, otherwise `tlang=en` of the chosen Thai track.
- "No Thai subtitles" is decided from the track list alone (`th`/`th-*`).

**Processing in the service worker** (`src/captions/process.ts`, `src/background/captions.ts`):

- Parse json3/srv3/srv1/VTT. The XML formats use small regex readers, because a service worker
  has no `DOMParser`.
- Strip `[…]` sound tags and normalize (NFC, zero-width characters → boundary hints, typing fixes,
  whitespace), keeping an offset map.
- One cue at a time: cues that start together are joined, and an overlapping cue ends where the
  next one starts.
- Merge auto-generated Thai fragments shorter than 1 s with fewer than 3 words.
- Keep the raw text and hints only for Thai.
- Cache in `captions` by `[videoId+trackKey]`. A translation's key is `<vssId>>en`. Rows carry
  `processingVersion`; older rows are ignored and refetched. The `videos` row records title,
  channel, duration and the chosen kind.

**Rendering and sync** (`src/content/`, `entrypoints/youtube.content/`):

- A shadow-root overlay inside `#movie_player`. Theater mode and fullscreen need no remounting:
  the player, or an ancestor of it, is what goes fullscreen. Subtitle size follows the player
  through CSS container units.
- Native captions are hidden only while our subtitles are live.
- Sync: `requestVideoFrameCallback` plus media events. Frames presented during a seek are ignored.
- Auto-pause fires 80 ms before the end of a cue reached by playing. It does not re-fire when
  playback resumes at that point.
- Hotkeys use `KeyboardEvent.code`, so they work with a Thai layout. They are consumed in the
  capture phase, so YouTube does not also act on them. **T therefore no longer toggles theater
  mode while Phasa shows subtitles**: the plan assigns T to the translation line.

**Fonts**: Noto Sans Thai Looped and Noto Sans Thai, Thai subset, variable 100–900, OFL 1.1, in
`public/fonts/`. They are declared on the page under "Phasa …" family names, so youtube.com's own
text never changes. `fonts-test.html` is built only in dev and test builds (`PHASA_TEST_PAGES=1`).

**Side panel ↔ tab**: a direct `tabs.connect` port (`src/messaging/panel.ts`) carries the
transcript, the playing cue, seeks and retries. It is live page state and must not depend on the
service worker being awake. No database access or credentials cross it.

**Settings** (`src/settings/`): one row per key in the Dexie `settings` table. Changes are
broadcast by the SW as `settings/changed`. The side panel also pushes changes straight to its tab,
because a content script's SW port may be asleep.

## Deferred

- **Transcript-panel fallback** (plan §4.1 step 8, InnerTube `get_transcript`). The
  `fetchTracks` bridge call is the seam where a second source plugs in. It is not built: the
  primary path worked on 12/12 live videos, and the fallback cannot be exercised under automation.
  Revisit if YouTube changes PoToken handling.
- **R hotkey and romanization line**: phase 3, together with romanization.
- **"Lines with new words" filter** in the side panel: needs word statuses (phases 3–4).
- **Cache eviction** for `captions`: about 0.5–1 MB per watched Thai video under
  `unlimitedStorage`. Add an LRU or age limit in phase 6.
- **Skipping the natural wait** when the player response says
  `captionsInitialState: CAPTIONS_INITIAL_STATE_OFF_*`. It would save about 1 s on the first
  video of a page, but sticky user preferences can still turn captions on, so it needs its own
  check.

## Consequences

- Time from the player reporting a video to Thai cues ready, measured live: 0.5–1.7 s with
  captions off and 0.07–0.3 s with captions on. Processing adds about 5 ms for a 30-minute track.
- The user's caption preference (both keys and the CC state) is left exactly as found. Videos
  whose uploader requires captions (`CAPTIONS_INITIAL_STATE_ON_REQUIRED`) keep YouTube's own
  behaviour.
- E2E tests run against a fake watch page that reproduces the observed player behaviour
  (`tests/e2e/fake-youtube.ts`). Live captions remain impossible under automation (ADR 0002).
