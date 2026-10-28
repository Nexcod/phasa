# Manual checklist

Automation cannot load real captions (YouTube returns empty timedtext bodies to automated browsers,
docs/spikes.md §1), so these checks run by hand in a normal Chrome profile with the unpacked build
(`npm run build` → `chrome://extensions` → Load unpacked → `.output/chrome-mv3`). Videos:
`tests/e2e/videos.ts`. Open DevTools on the YouTube tab and filter the console by `[phasa]`.

## Phase 2 — captions and rendering

- [ ] **Speed.** For each of the 10 acceptance videos, the console shows
      `[phasa] Thai captions ready in N ms` with N < 3000. Do it once with YouTube captions off
      and once with them on.
- [ ] **Track choice.** Manual-Thai videos show the manual text: punctuation and sentence-like
      lines. `pBoQcFogon8` and `pxLHURprYuI` show the auto-generated text, and the overlay chip
      says "Auto-generated captions — may contain errors" when the controls are visible.
- [ ] **English line.** Present on all 10. On `6FGHJxEx6Ts`, `PoautAigKP8`, `uYEW8BeJ0zY` and
      `0DVrEKzzYEQ` it comes from the uploader's English track, elsewhere from YouTube's
      translation.
- [ ] **No Thai.** `jNQXAC9IVRw`: no subtitles. Hovering shows the grey "No Thai subtitles" chip,
      and YouTube's own captions behave as usual.
- [ ] **SPA navigation.** Click through 3–4 recommendations without reloading. Subtitles switch
      each time, and the old video's subtitles never show over the new one.
- [ ] **Theater and fullscreen.** Toggle theater (YouTube's button) and fullscreen (F). Subtitles
      stay visible, scale with the player and sit above the control bar while it is shown.
- [ ] **Hotkeys.** A / D previous / next line, S repeat, Space play/pause, T translation on/off.
      Repeat with the **Thai keyboard layout** active. Typing in the search box and in comments is
      unaffected.
- [ ] **Auto-pause.** Side panel → "Pause after each line": playback stops at the end of each line.
      Space continues to the next line.
- [ ] **Side panel.** The transcript lists every line, the playing line is highlighted and
      followed, and clicking a line seeks there. Switching to a non-YouTube tab shows the empty
      state.
- [ ] **Caption preference untouched.** With YouTube captions off, watch 3 Thai videos, then open
      a non-Thai video: CC is still off. Compare `yt-player-caption-sticky-language` and
      `yt-player-caption-persistence` in youtube.com localStorage before and after: they are
      identical.
- [ ] **Cache.** Reopen a video watched earlier: subtitles appear without a forced CC flicker, and
      the Network tab shows no new `timedtext` request.
- [ ] **Ads.** On a video with a pre-roll ad, no subtitles show during the ad; they appear after it.
- [ ] **Fonts.** In a dev build (`npm run dev`), `chrome-extension://<id>/fonts-test.html` says "all
      checks passed" and no stacked mark (น้ำ, ที่, ปู่, ญี่ปุ่น) is cut. On youtube.com, the
      subtitles use the looped font.
