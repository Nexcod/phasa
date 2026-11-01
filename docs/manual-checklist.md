# Manual checklist

Automation cannot load real captions (YouTube returns empty timedtext bodies to automated browsers,
docs/spikes.md §1), so these checks run by hand in a normal Chrome profile with the unpacked build
(`npm run build` → `chrome://extensions` → Load unpacked → `.output/chrome-mv3`). Videos:
`tests/e2e/videos.ts`. Open DevTools on the YouTube tab and filter the console by `[phasa]`.

## Every phase

- [ ] **Network e2e.** `npm run test:e2e:network` passes. Run it from a home connection: YouTube
      shows datacenter IPs, including CI runners, a bot check instead of the video
      ([ADR 0009](decisions/0009-network-e2e-runs-locally.md)).

## Phase 3 — words

Do these on 3–4 of the acceptance videos (one manual-Thai, one auto-generated, one long). The first
video after installing loads the dictionary into IndexedDB; words become clickable a few seconds
after the subtitles appear.

- [x] **Gold set.** `tests/fixtures/segmentation.tsv` has ≥ 200 real cues from ≥ 10 videos (manual and asr), captured per its README and reviewed against the convention; `npm test` still passes (F1 ≥ 0.90) and `npm run seg:eval` reports the numbers for the acceptance note. Done 2026-11-01: 249 real cues from 13 videos, F1 0.963 (ADR 0010); native-speaker review open.
- [ ] **Words.** Thai subtitles are split into words: the line reads exactly as before, nothing is
      cut inside a stacked mark (น้ำ, ที่). With side panel → Word boundaries, "Thin gaps" and
      "Alternating underline" mark the words; "None" doesn't.
- [ ] **Popup speed.** Click 10 different words: each popup appears at once (< 100 ms; the popup's
      `data-open-ms` attribute in DevTools shows the time).
- [ ] **Popup content.** For a common word: Paiboon romanization with tone colors and diacritics,
      "Pronounced: …" syllables, part of speech, glosses, the classifier of a noun, the frequency
      rank. For a word the dictionary lacks: "Made of" parts or an "approximate" romanization. The
      🔊 button reads the word with a Thai voice, or says no Thai voice is installed.
- [ ] **Pause.** Clicking a word while the video plays pauses it; Esc or a click outside closes the
      popup and playback continues. With "Pause when I open a word" off, it keeps playing.
- [ ] **Status keys.** In the popup, 1–4, 5/K and X set learning 1–4, known and ignored; YouTube
      doesn't seek (digits) or pause (K). The word's highlight changes in the subtitles at once.
- [ ] **Context.** Side panel → My words lists the saved words with the line, its translation and
      "Open at m:ss"; clicking it seeks in the same video or opens the other video at that time.
      The options page lists them too; changing a status or deleting there updates the subtitles.
- [ ] **Phrases.** Drag over 2–3 words: the phrase popup shows them with their glosses; saving it
      lists it under My words. "Make it one word" joins them in every line of every video.
- [ ] **Boundary fixes.** "Wrong word boundaries?" → join with the next word, and split a word by
      clicking between its letters: the subtitles and the popup follow at once, also after a reload.
- [ ] **Romanization.** R shows romanization over the words (side panel: above / below, Paiboon+ /
      RTGS); R again hides it. Fullscreen and theater mode keep the popup inside the player.
- [ ] **Keyboard.** Tab moves through the words of the line; Enter opens the popup.

## Phase 2 — captions and rendering

All items passed on 2026-10-28, together with the network e2e (Every phase).

- [x] **Speed.** For each of the 10 acceptance videos, the console shows
      `[phasa] Thai captions ready in N ms` with N < 3000. Do it once with YouTube captions off
      and once with them on.
- [x] **Track choice.** Manual-Thai videos show the manual text: punctuation and sentence-like
      lines. `pBoQcFogon8` and `pxLHURprYuI` show the auto-generated text, and the overlay chip
      says "Auto-generated captions — may contain errors" when the controls are visible.
- [x] **English line.** Present on all 10. On `6FGHJxEx6Ts`, `PoautAigKP8`, `uYEW8BeJ0zY` and
      `0DVrEKzzYEQ` it comes from the uploader's English track, elsewhere from YouTube's
      translation.
- [x] **No Thai.** `jNQXAC9IVRw`: no subtitles. Hovering shows the grey "No Thai subtitles" chip,
      and YouTube's own captions behave as usual.
- [x] **SPA navigation.** Click through 3–4 recommendations without reloading. Subtitles switch
      each time, and the old video's subtitles never show over the new one.
- [x] **Theater and fullscreen.** Toggle theater (YouTube's button) and fullscreen (F). Subtitles
      stay visible, scale with the player and sit above the control bar while it is shown.
- [x] **Hotkeys.** A / D previous / next line, S repeat, Space play/pause, T translation on/off.
      Repeat with the **Thai keyboard layout** active. Typing in the search box and in comments is
      unaffected.
- [x] **Auto-pause.** Side panel → "Pause after each line": playback stops at the end of each line.
      Space continues to the next line.
- [x] **Side panel.** The transcript lists every line, the playing line is highlighted and
      followed, and clicking a line seeks there. Switching to a non-YouTube tab shows the empty
      state.
- [x] **Caption preference untouched.** With YouTube captions off, watch 3 Thai videos, then open
      a non-Thai video: CC is still off. Compare `yt-player-caption-sticky-language` and
      `yt-player-caption-persistence` in youtube.com localStorage before and after: they are
      identical.
- [x] **Cache.** Reopen a video watched earlier: subtitles appear without a forced CC flicker, and
      the Network tab shows no new `timedtext` request.
- [x] **Ads.** On a video with a pre-roll ad, no subtitles show during the ad; they appear after it.
- [x] **Fonts.** In a dev build (`npm run dev`), `chrome-extension://<id>/fonts-test.html` says "all
      checks passed" and no stacked mark (น้ำ, ที่, ปู่, ญี่ปุ่น) is cut. On youtube.com, the
      subtitles use the looped font.
