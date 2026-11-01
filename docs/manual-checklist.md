# Manual checklist

Automation cannot load real captions (YouTube returns empty timedtext bodies to automated browsers,
docs/spikes.md §1), so these checks run by hand in a normal Chrome profile with the unpacked build
(`npm run build` → `chrome://extensions` → Load unpacked → `.output/chrome-mv3`). Videos:
`tests/e2e/videos.ts`. Open DevTools on the YouTube tab and filter the console by `[phasa]`.

## Every phase

- [ ] **Network e2e.** `npm run test:e2e:network` passes. Run it from a home connection: YouTube
      shows datacenter IPs, including CI runners, a bot check instead of the video
      ([ADR 0009](decisions/0009-network-e2e-runs-locally.md)).

## Phase 4 — analysis and onboarding

Start from a fresh install (remove and load the unpacked build again) so the vocabulary is empty.
Use 3–4 of the acceptance videos, one of them long (`SVj46JwYnB4`).

All items passed on 2026-11-01, together with the network e2e (Every phase).

- [x] **Badge.** Under the video title: `B1 · 0% known · N new words`, red border (too hard)
      on a fresh install. In YouTube's dark theme it is readable too. On `jNQXAC9IVRw` it says "No
      Thai subtitles" in grey. Navigating to another video through recommendations, the badge
      follows without a reload.
- [x] **Speed.** On the long video, DevTools → Elements → the badge's `data-analysis-ms`
      (`phasa-badge` shadow root → `[data-testid="phasa-analysis"]`) is under 500.
- [x] **Live.** Mark a word known in the subtitles (click it, K): the badge's percentage goes up at
      once. Set it back to new (side panel → My words → Delete): it goes down.
- [x] **Details.** Click the badge: comprehension sentence, level and measures, the status bar,
      "Top new words to learn first" with meanings. "Learn" on one word: it turns yellow in the
      subtitles and side panel → My words lists it with its line. "Add top 10 to learning": 10
      more. "Mark all new words as known" asks first; after confirming, "0 new" and the subtitles
      have no blue underlines left except the learning words.
- [x] **Side panel.** The same badge above the tabs; "Only lines with new words" shows only those
      lines and follows status changes.
- [x] **Onboarding: particles and top N.** Options → Known words: "Mark these 9 particles as
      known". Then most frequent 1000 → "Review the list": the list shows Thai, romanization,
      meaning; the particles show as Known and can't be ticked. Untick two words, "Mark as known
      (…)". The counts line and the badge on an open video tab (without reloading it) change.
- [x] **Onboarding: import.** Import a TXT file with one word per line, and an Anki deck exported
      as "Notes in Plain Text" (.txt) whose first field is Thai: the "Entries with Thai" count is
      right, "Mark them as known" changes the counts and the badge of an open video tab right away
      — also after leaving the options page idle for a minute first (the service worker sleeps).

## Phase 3 — words

Do these on 3–4 of the acceptance videos (one manual-Thai, one auto-generated, one long). The first
video after installing loads the dictionary into IndexedDB; words become clickable a few seconds
after the subtitles appear.

All items passed on 2026-11-01, together with the network e2e (Every phase).

- [x] **Gold set.** `tests/fixtures/segmentation.tsv` has ≥ 200 real cues from ≥ 10 videos (manual and asr), captured per its README and reviewed against the convention; `npm test` still passes (F1 ≥ 0.90) and `npm run seg:eval` reports the numbers for the acceptance note. Done 2026-11-01: 249 real cues from 13 videos, F1 0.963 (ADR 0010); native-speaker review open.
- [x] **Words.** Thai subtitles are split into words: the line reads exactly as before, nothing is
      cut inside a stacked mark (น้ำ, ที่). With side panel → Word boundaries, "Thin gaps" and
      "Alternating underline" mark the words; "None" doesn't.
- [x] **Popup speed.** Click 10 different words: each popup appears at once (< 100 ms; the popup's
      `data-open-ms` attribute in DevTools shows the time).
- [x] **Popup content.** For a common word: Paiboon romanization with tone colors and diacritics,
      "Pronounced: …" syllables, part of speech, glosses, the classifier of a noun, the frequency
      rank. For a word the dictionary lacks: "Made of" parts or an "approximate" romanization. The
      🔊 button reads the word with a Thai voice, or says no Thai voice is installed.
- [x] **Pause.** Clicking a word while the video plays pauses it; Esc, × or a click outside closes the popup and playback continues. A click on the video only closes the popup: playback must not stop again a moment later. With "Pause when I open a word" off, it keeps playing.
- [x] **Status keys.** In the popup, 1–4, 5/K and X set learning 1–4, known and ignored; YouTube
      doesn't seek (digits) or pause (K). The word's highlight changes in the subtitles at once.
- [x] **Context.** Side panel → My words lists the saved words with the line, its translation and
      "Open at m:ss"; clicking it seeks in the same video or opens the other video at that time.
      The options page lists them too; changing a status or deleting there updates the subtitles.
- [x] **Phrases.** Pause the video first (Space), so the line stays on screen.
  1. In the Thai line, press the mouse on the first of 2–3 neighbouring words, drag to the last one
     and release. A phrase popup opens: the selected text, its romanization and, under "Words", each
     word with its meaning.
  2. Press 1 (or click "1"): the phrase is saved. In the subtitles it now shows as one highlighted
     piece (saved phrases become one unit, plan §5.3), and side panel → My words lists it with the
     line it came from.
  3. Select 2–3 other words with no space between them and click "Make it one word": they become
     one word in this line, in any other line with the same words, and after a page reload. Undo:
     click that word → "Wrong word boundaries?" → click between the letters where the boundary was.
- [x] **Boundary fixes.** "Wrong word boundaries?" → join with the next word, and split a word by
      clicking between its letters: the subtitles and the popup follow at once, also after a reload.
- [x] **Romanization.** R shows romanization over the words (side panel: above / below, Paiboon+ /
      RTGS); R again hides it. Fullscreen and theater mode keep the popup inside the player.
- [x] **Keyboard.** W opens the popup of the first word of the line; Q / E move it to the previous / next word; 1–4 / K / X set the status of the word reached; W or Esc closes. YouTube's own keys (J, L, arrows, F, M) still work while no popup is open.

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
