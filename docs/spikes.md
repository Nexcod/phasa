# Phase 0 — spikes

Status as of 2026-10-16. Decisions that follow from these results live in
[`docs/decisions/`](decisions/README.md). Phase 0 acceptance (docs/plan.md §12):
all four spikes concluded, OAuth variant chosen, captions source chosen, data
sources chosen.

**Phase 0 accepted on 2026-10-16.** All four spikes concluded; the open items in the table below are
non-blocking follow-ups. Phase 1 (scaffold) was built in parallel at the owner's request and accepted
the same day (see README → Status).

| #   | Spike                          | Status                           | Blocking item                                        |
| --- | ------------------------------ | -------------------------------- | ---------------------------------------------------- |
| 1   | Captions (timedtext + PoToken) | **Done** — real Chrome, 6 videos | — (pot lifetime > 7 min, logged-out: non-blocking)   |
| 2   | Sign in with ChatGPT           | **Done** — A1 and A2 work live   | —                                                    |
| 3   | Segmentation baseline          | **Done (preliminary)**           | Real-subtitle gold set (≥ 200 cues) in phase 3       |
| 4   | Data licenses                  | **Done** — one item to confirm   | Confirm Volubilis license inside the release archive |

---

## 1. Captions spike

**Kit:** [`spikes/captions-extension/`](../spikes/README.md#captions) — unpacked MV3
extension with a single MAIN-world `document_start` script that records the
player's `/api/timedtext` requests (fetch + XHR), turns Thai captions on via the
player API if the player didn't request them within 2 s, and probes URL variants
with the captured `pot`.

### Questions

1. Does the player request Thai captions without user action? How fast after the player is ready (criterion: < 3 s)?
2. Does `setOption('captions', 'track', …)` reliably trigger the request? Does it change the user's sticky caption preference?
3. Is the captured `pot` reusable for: the same URL; `fmt=json3/srv3/vtt`; `tlang=en`; another track (other `lang`/`kind`); a track's `baseUrl` + the `pot`?
4. How long is a `pot` valid (same video later; another video)?
5. Does hiding `.ytp-caption-window-container` keep the player fetching captions (it must, the overlay relies on it)?

### Run 1 — Playwright Chromium (automation): not usable

Every timedtext response was `200` with an **empty body, including the player's own requests**, and no
captions rendered (checked at the network layer, so not an interception bug). Automated Chromium has
`navigator.webdriver === true`; a regular UA string did not help — the attestation behind `pot` fails
under automation.

**Plan impact (§13 E2E):** Playwright cannot exercise live captions on youtube.com. E2E tests stub
`/api/timedtext` with recorded json3 fixtures (`tests/fixtures/captions/`) via `context.route`; the
`@network` suite checks only page-level behaviour (overlay mount, SPA navigation, "No Thai subtitles"
detection from the player response, which _is_ available under automation).

### Run 2 — real Chrome 154, logged-in profile (2026-10-16, via Claude in Chrome)

Code injected into the MAIN world after page load (same interception as the kit), user's captions
initially **off**. Afterwards the user's caption preference was restored (see "Side effects").

| videoId       | Tracks                      | How the request happened                                                                    | Timing                                                              | Result                                   |
| ------------- | --------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------- |
| `pBoQcFogon8` | th manual, th asr           | `setOption('captions','track', th)`                                                         | request 52 ms after `setOption`                                     | json3 706 B, 5 cues (song)               |
| `uYEW8BeJ0zY` | en manual, th asr           | automatic after `loadVideoById` (sticky `th`)                                               | player ready 489 ms, json3 received 582 ms after load               | 45.7 KB, 117 cues                        |
| `0DVrEKzzYEQ` | en manual, th asr           | automatic on full page load (sticky `th`)                                                   | —                                                                   | th/asr json3, requested twice            |
| `iH31BMKBEdU` | th asr only                 | automatic after **SPA navigation** (click on a recommendation)                              | player ready 1087 ms after click, json3 done **100 ms after ready** | 26.8 KB; same URL re-requested at +2.3 s |
| `pxLHURprYuI` | th manual, th asr           | full page load (sticky `th`)                                                                | not measured — YouTube clears the Resource Timing buffer            | —                                        |
| `jNQXAC9IVRw` | en, de manual — **no Thai** | sticky `th` made the player **auto-translate en→th (`tlang=th`)** and show Thai MT captions | —                                                                   | must count as "No Thai subtitles"        |

**`pot` reuse matrix** (captured on `pBoQcFogon8`, then `uYEW8BeJ0zY`):

| Variant                                                                   | Result                                      |
| ------------------------------------------------------------------------- | ------------------------------------------- |
| Same URL again (also ~7 min later)                                        | ✅ identical body — `pot` is not single-use |
| `fmt=srv3` / `fmt=vtt`                                                    | ✅                                          |
| `tlang=en` (and `tlang=ru`)                                               | ✅ machine translation, 5/5 and 104 cues    |
| Swap `lang`/`kind` to another track of the same video (th asr, en manual) | ✅ 35 and 198 cues                          |
| Track `baseUrl` (from the player response, has no `pot`) + captured `pot` | ✅                                          |
| `pot` without `potc`                                                      | ✅ (`potc` not needed)                      |
| No `pot`                                                                  | ❌ empty `200`                              |
| `pot` of video A on video B (th or en track)                              | ❌ empty — **`pot` is bound to the video**  |

The URL signature covers `sparams=ip,ipbits,expire,v,ei,caps,opi,exp,xoaf` — `lang`, `kind`, `fmt`,
`tlang`, `pot` are not signed, `v` is. `expire` was ~7 h ahead. `pot` length 120–124.

**Side effects of `setOption` (important):** enabling a track programmatically writes
`localStorage['yt-player-caption-sticky-language'] = "th"` and
`localStorage['yt-player-caption-persistence'] = "true"`. From then on, **every** video in every tab
opens with captions on, and videos without Thai get YouTube's machine translation into Thai.
Turning captions off via the player API (`setOption(…, {})`, `unloadModule`) does **not** update these
keys, and another tab's player with captions on rewrote `persistence` to `true`. Clicking the CC button
off writes `persistence = "false"`. Restoring the user's state needed: close the tab with captions on,
remove `sticky-language`, toggle CC off.

**Other observations**

- The player requests `fmt=json3` itself — no format rewrite needed (plan §4.1 step 6).
- It re-requests the same URL 2–3 times per video → dedupe by `v+lang+kind+tlang`.
- It prefetches timedtext for other videos (seen under automation) → always filter by `v`.
- `getOption('captions','tracklist')` after `loadModule` listed only one track; use
  `getPlayerResponse().captions.playerCaptionsTracklistRenderer.captionTracks` for the list.
- Q5 (hiding native captions): the request happens on track selection, so CSS hiding cannot affect it;
  not separately tested.

### Conclusions → [ADR 0002](decisions/0002-captions-source.md) (Accepted)

1. Per video, obtain one `pot` from the player's own request; then fetch Thai (manual > asr) and
   English (`en` manual if present, else `tlang=en`) **ourselves with that `pot`** right away — no
   dependency on `pot` lifetime.
2. If the player hasn't requested captions (user has them off), turn a track on with `setOption`
   while native captions are hidden, take the `pot` from the first request, then **restore the user's
   caption state and both localStorage keys exactly as they were**.
3. "No Thai subtitles" is decided **only** from `captionTracks` (`languageCode === 'th'`); requests
   with `tlang=th` are machine translation and are ignored.
4. Speed: ~1.2 s from a recommendation click to Thai json3 in hand — within the 3 s criterion.
5. Still open (non-blocking): `pot` lifetime beyond ~7 min; logged-out profile; behaviour with ads.

### Run 3 — phase 2 code against live YouTube (2026-10-16, real Chrome, via Claude in Chrome)

The built MAIN-world bundle (`content-scripts/youtube-main.js`) was injected into a logged-in watch
page and driven through the bridge protocol by hand: the isolated side's messages were posted from
the console, and the test moved between videos with YouTube's own SPA navigation (`yt-navigate`).
The user's captions were off throughout.

New facts, now handled in code (ADR 0007):

- **`pot` alone is not enough.** `baseUrl + pot` returned an empty body. `baseUrl + pot + c +
cver` worked, so we copy every parameter of the captured request except the track and format
  ones.
- **The player aborts its own first request** on a fresh page (`status 0`) and sends the same URL
  again ~30 ms later. Our refetch with the same `pot` works even right after the abort.
- **After an SPA switch the player can briefly report the previous video again.** A fetch right
  after the switch returned `stale-video`; the fetcher now waits up to 3 s for the player to settle.
- **Stub manual tracks:** `pxLHURprYuI` has 2 manual cues (4 s) against 30 asr cues (179 s);
  `pBoQcFogon8` has 5 manual cues (16 s) against 35 (161 s). Track choice falls back to asr.
- **`captionsInitialState: CAPTIONS_INITIAL_STATE_ON_REQUIRED`** (both Pinkfong songs): YouTube
  turns captions on by itself, so these videos use the natural path (72–309 ms).
- The user's two caption keys stayed byte-identical through 13 navigations, 10 of them with a
  forced load, and the CC button stayed off wherever YouTube had not turned it on itself.
- Real formats are captured as contract fixtures in `tests/fixtures/captions/`.

| videoId       | Tracks (th/en) | Chosen          | English | Player ready after nav | Thai ready after player | English after Thai |
| ------------- | -------------- | --------------- | ------- | ---------------------: | ----------------------: | -----------------: |
| `wD3NSzYtsMc` | .th a.th       | .th (281 cues)  | tlang   |                 783 ms |                1658 ms¹ |             391 ms |
| `6FGHJxEx6Ts` | .en .th a.th   | .th (245)       | manual  |                 912 ms |                  582 ms |              83 ms |
| `PoautAigKP8` | .en .th a.th   | .th (305)       | manual  |                1000 ms |                  692 ms |              85 ms |
| `1pRtDpRJZdY` | .th            | .th (200)       | tlang   |                 690 ms |                  497 ms |             429 ms |
| `48A9SU6_bQ8` | .th a.th       | .th (347)       | tlang   |                 703 ms |                  491 ms |             385 ms |
| `iH31BMKBEdU` | a.th           | a.th (335)      | tlang   |                 861 ms |                  496 ms |             438 ms |
| `uYEW8BeJ0zY` | .en a.th       | a.th (117)      | manual  |                 811 ms |                  489 ms |              92 ms |
| `0DVrEKzzYEQ` | .en a.th       | a.th (426)      | manual  |                 808 ms |                  531 ms |              62 ms |
| `xV8fgU3Hczk` | a.en a.th      | a.th (372)      | tlang   |                1129 ms |                  494 ms |             462 ms |
| `SVj46JwYnB4` | a.th (31 min)  | a.th (750)      | tlang   |                 797 ms |                  536 ms |             731 ms |
| `pBoQcFogon8` | .th a.th       | a.th (stub .th) | tlang   |                 957 ms |                 309 ms² |             213 ms |
| `pxLHURprYuI` | .th a.th       | a.th (stub .th) | tlang   |                 771 ms |                  72 ms² |             454 ms |
| `jNQXAC9IVRw` | .en            | no Thai         | —       |                 914 ms |                       — |                  — |

¹ First video after the script started: the full 1.5 s wait for a natural request, then a forced
load. Later videos wait 0.4 s. ² The player requested captions itself (`ON_REQUIRED`).

Processing the bodies in the service worker (parse + normalize + merge + align, Node 24) takes
5.4 ms for a 750-cue track and 19 ms for 3000 cues.

### Re-running

Load the kit unpacked in a normal Chrome profile and open watch pages (console filter `[phasa-spike]`).
**The kit calls `setOption` and therefore flips the sticky caption preference** — afterwards remove
`yt-player-caption-sticky-language` from youtube.com localStorage and switch CC off.
`phasaSpike.save()` downloads the Thai json3 for `npm run spike:cues` (§3).

---

## 2. Sign in with ChatGPT spike

**Kit:** [`spikes/siwc-extension/`](../spikes/README.md#sign-in-with-chatgpt) — unpacked MV3 extension:
A1 (DNR session rule redirecting `http://127.0.0.1:1455/auth/callback?…` to `callback.html`) and A2
(`webNavigation.onBeforeNavigate` + `tabs.onUpdated`), PKCE S256, code exchange, ID-token verification
against JWKS with WebCrypto, `/v1/models`, streaming `/v1/responses` from the SW (plain and
`text.format: json_schema`), refresh, sign-out/forget, and a long stream to observe SW lifetime.

### Documentation check (2026-10-16)

The preview docs match plan §8 with these additions/corrections:

| Topic                            | What the docs say                                                                                                                                                                                                                                                                                                                                                                                                                             | Plan impact                                                                                            |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Redirect URI                     | `http://127.0.0.1:<port>/auth/callback`; only the port may vary; no `localhost`; **"Start the listener before opening the browser."**                                                                                                                                                                                                                                                                                                         | Option A has no listener — the docs don't forbid it, but don't describe it either. Risk stands (§8.3). |
| Callback `client_id`             | Returned on first registration; **may be omitted on reauthorization**; if present and different from the saved one → reject.                                                                                                                                                                                                                                                                                                                  | Handle "absent" as "use saved".                                                                        |
| Callback `scope`                 | Returned in the callback.                                                                                                                                                                                                                                                                                                                                                                                                                     | Log/compare with token response.                                                                       |
| Token response                   | `access_token`, `refresh_token`, `id_token`, `token_type`, `expires_in`, `scope`, **`earliest_refresh_at`**. Access token 1 h; refresh token 30 days, rotating, each refresh renews 30 days.                                                                                                                                                                                                                                                  | Refresh scheduling must respect `earliest_refresh_at`.                                                 |
| Refresh                          | `grant_type=refresh_token`, issued `client_id`, `refresh_token`, `resource`; omit `scope`; **serialize refreshes**.                                                                                                                                                                                                                                                                                                                           | Single-flight refresh in the SW.                                                                       |
| Refresh errors                   | `invalid_grant`, `invalid_refresh_token`, `token_expired`, `refresh_token_expired`, `refresh_token_invalidated`, `refresh_token_reused` → clear tokens, re-run OAuth with the saved client id. `invalid_client` → config bug.                                                                                                                                                                                                                 | Error mapping table in `src/auth`.                                                                     |
| `invalid_grant` on code exchange | Discard code, restart authorization with the retained client id.                                                                                                                                                                                                                                                                                                                                                                              |                                                                                                        |
| ID token                         | Verify signature (JWKS), `iss` (`https://auth.openai.com`), `aud` = issued client id, `exp`, `nonce`. **JWKS URL is not documented** — kit tries OIDC discovery, falls back to `/.well-known/jwks.json`.                                                                                                                                                                                                                                      | Record the real URL in the run.                                                                        |
| Sign-out                         | Revokes the refresh token; keep client/account mapping, host id, email (`login_hint`). **No revoke endpoint documented.** `id_token_hint` must be omitted after sign-out.                                                                                                                                                                                                                                                                     | Plan §8.7 "Sign out" needs the revoke call → open question.                                            |
| Multiple accounts                | One registration per account; never mix client ids and tokens; switching doesn't sign out others.                                                                                                                                                                                                                                                                                                                                             | v1: single account, but key storage by `client_id`.                                                    |
| Models                           | `GET /v1/models` → `models[]` with `slug`, `display_name`, `visibility` (`"list"`); keep server order.                                                                                                                                                                                                                                                                                                                                        | As planned.                                                                                            |
| Forbidden request fields         | `background`, `conversation`, `max_output_tokens`, `max_tool_calls`, `metadata`, `moderation`, `multi_agent`, `prompt`, `prompt_cache_retention`, `safety_identifier`, `temperature`, `top_logprobs`, `top_p`, `truncation`, `user`; no `previous_response_id`; no `role: "system"`.                                                                                                                                                          | Encode as a type-level deny list in `src/ai`.                                                          |
| Errors                           | `subscription_sharing_usage_limit_exceeded` (429), `…_usage_unavailable` (503, backoff), `…_user_not_eligible` (403, no retry/no OAuth loop), `…_unsupported_capability` (400, see `error.param`), `…_route_not_supported`, `…_invalid_user` (401), `chatpass_v2_scope_not_authorized`, `chatpass_v2_invalid_authorization_context`, `…_user_unavailable` (503). Admission failures before the stream: bare 401/403/503 with `{"detail": …}`. | Error mapping table in `src/ai`.                                                                       |
| Structured output                | `text.format: json_schema` is **not mentioned** in the preview pages.                                                                                                                                                                                                                                                                                                                                                                         | Must be tested (kit button "Stream (json_schema)").                                                    |
| Eligibility                      | Open-source and locally hosted apps; paid/remotely hosted → interest form.                                                                                                                                                                                                                                                                                                                                                                    | Unchanged.                                                                                             |

### Pre-flight (Playwright, no OpenAI traffic)

The kit loads, the spike page renders, and both capture paths work: with a deliberately wrong `state`,
a navigation to `http://127.0.0.1:1455/auth/callback?code=…` landed on `callback.html` via the DNR rule
(A1) and via `webNavigation.onBeforeNavigate` (A2), and stopped at "state mismatch" before any request
to OpenAI.

### Live run — 2026-10-16, Chrome, ChatGPT plan account (owner)

Log times are local (UTC+7). Email and issued `client_id` are omitted here on purpose.

**Consent flow on first registration (A1)** — three OpenAI screens, then our page:

1. "Use ChatGPT to sign in to Phasa" — account chooser.
2. "Connect your Phasa to ChatGPT — First, what should we call your agent?" — a name field pre-filled
   from `agent_name_hint` ("Phasa"). **The user can rename the agent here.**
3. "Connect Phasa to ChatGPT" — two grants: _Access your basic profile information_ and _Use your
   ChatGPT plan: Allow Phasa to consume usage from your ChatGPT Plan's limits_, with the note "OpenAI
   has not verified this agent or its name". The app shows a generic robot icon.
4. `callback.html`: "Connected ✓ — Connected as …".

**Protocol facts**

| Item                  | Observed                                                                                                                                                                                                                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Callback params       | `code`, `scope`, `state`, `client_id` (issued `oaiapp_…`)                                                                                                                                                                                                                                      |
| Granted scope         | `chatgpt.tokens.use.direct email offline_access openid profile resource.invoke`                                                                                                                                                                                                                |
| Token response        | `access_token` (JWT, ~2.1 KB), `refresh_token` (opaque `rt.1.…`, ~200 chars), `id_token`, `token_type`, `expires_in: 3600`, `scope`, `earliest_refresh_at`                                                                                                                                     |
| `earliest_refresh_at` | 54 min after issue (≈ 6 min before expiry). A refresh 4 min after issue **succeeded** → advisory, not enforced                                                                                                                                                                                 |
| OIDC discovery        | `issuer` `https://auth.openai.com`, `jwks_uri` `https://auth.openai.com/.well-known/jwks.json`, `revocation_endpoint` `https://auth.openai.com/api/accounts/oauth/revoke` — answers the two gaps in the docs                                                                                   |
| ID token              | RS256, verified with WebCrypto against the JWKS; `iss`, `aud` = issued client id, `exp`, `nonce` all OK. Claims: `iss sub aud nonce auth_time email email_verified name sid https://api.openai.com/auth iat exp jti at_hash`                                                                   |
| Refresh               | `grant_type=refresh_token` works; **refresh token rotated**; the refresh response also carries `id_token` and `earliest_refresh_at`                                                                                                                                                            |
| `/v1/models`          | top-level `models`; 7 visible: GPT-6.1-Sol, GPT-6-Astra, GPT-6-Sol, GPT-6-Luna, GPT-5.6-Sol, GPT-5.6-Terra, GPT-5.6-Luna. Entries carry `slug`, `display_name`, `visibility`, `priority`, `supported_in_api`, `context_window`, reasoning levels, service tiers… — **no explicit "fast" flag** |
| `x-request-id`        | not readable from the SW (`null`) — find the right header for support logs in phase 5                                                                                                                                                                                                          |

**Inference (model GPT-6.1-Sol, the first listed)**

| Request                              | Terminal                         | First delta |     Total | Deltas |
| ------------------------------------ | -------------------------------- | ----------: | --------: | -----: |
| Plain                                | `response.completed`             |       4.6 s |     8.8 s |    157 |
| `text.format: json_schema` (strict)  | `response.completed`, JSON valid |       6.3 s |     9.7 s |    113 |
| Long (~900-word story + translation) | `response.completed`             |      11.6 s | **117 s** |   3714 |
| Plain, right after a refresh         | `response.completed`             |       6.2 s |    10.9 s |    154 |

Stream events seen: `response.created`, `response.in_progress`, `response.output_item.added/done`,
`response.content_part.added/done`, `response.output_text.delta/done`, `response.metadata`
(undocumented), `response.completed`. The SW stayed alive for the whole 117 s stream while the page's
port was open.

**Reauthorization and A2** (owner's report; the page log missed these callbacks, see below)

- Step 7, A1 again while signed in (`id_token_hint` + `login_hint` sent): the account chooser and the
  same screens as on the first sign-in, then "Connected ✓". The kit rejects a callback whose
  `client_id` differs from the saved one, so the reauthorization kept the existing registration.
- Step 8, after Sign out, A2 (`login_hint` only): the same screens, then "Connected ✓". The owner
  noticed no difference from A1.
- Neither callback appeared in the spike page's log. Most likely the service worker was stopped while
  the owner was on OpenAI's pages (> 30 s without extension events), the page lost its port, and the
  callback ran in a fresh service-worker instance that restored the attempt from
  `chrome.storage.session` and logged only to its own console. Not verified, but consistent with
  both flows ending in "Connected ✓".

| Check                      | A1                                         | A2                                            |
| -------------------------- | ------------------------------------------ | --------------------------------------------- |
| Code captured              | ✅ live (first registration and reauth)    | ✅ live (after sign-out)                      |
| User-visible result        | our "Connected ✓" page                     | our "Connected ✓" page, no difference from A1 |
| Re-sign-in without consent | ❌ account chooser and consent shown again | ❌ account chooser and consent shown again    |
| `/v1/models`               | ✅                                         | — same tokens                                 |
| Streaming from SW          | ✅ incl. 117 s                             | —                                             |
| `json_schema` honored      | ✅                                         | —                                             |
| Refresh + rotation         | ✅                                         | —                                             |

### Conclusions → [ADR 0003](decisions/0003-chatgpt-oauth-redirect.md) (Accepted: A1)

1. **A1 works end-to-end** without a loopback listener: registration, code exchange, ID-token
   verification, models, streaming, structured output, refresh with rotation.
2. `text.format: json_schema` works on this route → use it for `explainWord`/`translateCue`; keep zod
   validation as a guard, the retry path becomes a fallback.
3. Latency: 4.6–6.3 s to the first token on the first-listed model. The word popup must show the local
   dictionary instantly and stream AI text into it; cache answers; measure the Luna models in phase 5
   before choosing a default (the list has no "fast" marker).
4. Sign-out can revoke the refresh token at the discovered `revocation_endpoint`; parameters to verify
   in phase 5.
5. Every sign-in shows the account chooser and consent, even with `id_token_hint`; the UI should say
   so. The OpenAI screen says the agent is unverified — explain that in our pre-sign-in copy.
6. The service worker can restart during sign-in. Keep the attempt (`state`, `nonce`, PKCE verifier)
   in `chrome.storage.session`, as the kit does, and let pages re-subscribe to SW events after a
   restart: `src/messaging` reconnects only on the next request today.

---

## 3. Segmentation spike

**Tools:** `src/thai/segmentation-eval.ts` (boundary P/R/F1, tested), `npm run spike:seg [file]`,
`npm run spike:seg:fetch` (wisesight-1000), `npm run spike:cues` (json3 → pre-segmented TSV rows).

Scoring: a boundary is an offset between two words. Boundaries next to whitespace are excluded (free
for every segmenter). "Thai" columns score only boundaries with Thai script on both sides.

### Results — Node 24.17, ICU 78.3 (`Intl.Segmenter('th', { granularity: 'word' })`)

**A. Seed set, dictionary-headword convention** — `tests/fixtures/segmentation.tsv`, 50 subtitle-style
lines written and segmented by the coding assistant (vlog, cooking, lessons, news, drama, ASR-style
run-ons). Needs native-speaker review; not real subtitles.

| Variant         |   F1 thai |     P |     R | sentences exact |
| --------------- | --------: | ----: | ----: | --------------: |
| ICU             |     0.930 | 90.5% | 95.6% |             36% |
| ICU + split `ๆ` | **0.944** | 90.8% | 98.3% |             44% |

**B. wisesight-1000** (CC0, PyThaiNLP; 988 social-media posts, human-segmented with a _finer_
convention that splits many compounds: `จัด|การ`, `รู้|สึก`, `ประเทศ|ไทย`).

| Variant            | F1 all | F1 thai |     P |     R | sentences exact |
| ------------------ | -----: | ------: | ----: | ----: | --------------: |
| ICU                |  0.868 |   0.891 | 85.1% | 93.4% |           22.8% |
| ICU + split `ๆ`    |  0.876 |   0.899 | 85.3% | 95.1% |           25.5% |
| + merge punct runs |  0.881 |   0.899 | 85.3% | 95.1% |           26.5% |

ICU never placed a boundary inside a grapheme cluster (0 violations on both sets).

### Typical errors

1. **Over-segmentation of dictionary words** (the bulk of seed-set errors): `วัน|นี้`, `พรุ่ง|นี้`,
   `เมื่อ|วาน`, `ข้าว|ผัด`, `แกง|เขียว|หวาน`, `ภาษา|ไทย`, `สนาม|บิน`, `คุ้ม|ค่า`, `โอ|เค`. All are
   exactly what the planned dictionary merge (§5.3: merge ≤ 4 adjacent tokens whose concatenation is a
   dictionary entry) fixes.
2. **Loanwords and brand names split into syllables**: `โต|โย|ต้า`, `นิ|ส|สัน`, `โปร|โม|ชั่น`,
   `อาย|ไลน์|เนอ|ร์`. Frequent on YouTube. Also fixed by dictionary merge if the dictionary has them;
   Wiktionary covers common loanwords, brands need user merge rules.
3. **`ๆ` glued to the previous word** (`จริงๆ`, `มากๆ`, `ช้าๆ`): the plan wants a separate `repeat`
   token. A one-line rule fixes it (+1.4–1.7 pt recall).
4. **ICU merges of frequent collocations**: `ไม่มี`, `ไม่รู้`, `ได้ที่`, `ก็ได้`, `เข้าไป`, `ทำให้`,
   `มากกว่า`. Whether these are errors depends on the convention. For learners `ไม่|รู้` is two known
   words, but `ทำให้` is a dictionary entry. → needs a "split" path: if an ICU token is not in the
   dictionary but splits into dictionary words, split it.
5. **Genuine ambiguity**: `มากอะ` → ICU `มา|กอะ` (should be `มาก|อะ`). Rare but visible to users;
   user split rules + AI fix (phase 2 of the product).
6. Non-Thai noise (URLs, `...`, phone numbers) is split finely; irrelevant for statistics because those
   tokens are `latin`/`punct`/`number` and excluded (§5.4), but the tokenizer should keep punct runs whole.

### Conclusions

- `Intl.Segmenter` is a viable base: ~0.93 F1 on subtitle-style speech before any correction, zero
  grapheme violations, no dependency.
- The ≥ 0.90 target is realistic **only with a fixed annotation convention**; the convention moves F1
  more than the algorithm does (wisesight vs seed). Decision: [ADR 0005](decisions/0005-segmentation-convention.md).
- Planned tokenizer = ICU → split `ๆ` → dictionary merge (≤ 4 tokens) → dictionary-guided split of
  unknown ICU tokens → user rules.
- Open: confirm that Chrome's ICU gives the same segmentation as Node's ICU 78.3 (run the same script
  in the browser during phase 3; Chrome bundles its own ICU build).
- Open: build the real gold set (≥ 200 cues from ≥ 10 videos, manual + asr) with `npm run spike:cues`
  after the captions spike, then annotate per `tests/fixtures/README.md`.

---

## 4. Data licenses

Checked 2026-10-16 from primary pages where available.

| Source                                             | What we'd use                                                                                                                                                                                                                    | License                                                                                                                                                                                                                                                                                                                | Verdict                                                                                                           |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| English Wiktionary via kaikki.org / wiktextract    | Thai entries: glosses, POS, pronunciation (romanization, IPA, syllables/tones where present), classifiers. 17,629 Thai word forms (kaikki Thai index; per-language JSONL ~48 MB, marked _deprecated_ in favour of the raw dump). | Wiktionary text: **CC BY-SA 4.0 + GFDL** (dual). kaikki.org adds no license of its own; asks for a citation of the wiktextract paper (academic use) and a link.                                                                                                                                                        | **Use.** Base dictionary. Derived data → CC BY-SA 4.0, attribution + link to Wiktionary/kaikki.                   |
| Volubilis (Francis Bastien, SourceForge "belisan") | Supplementary Thai–English glosses, romanization.                                                                                                                                                                                | PyThaiNLP redistributes a Volubilis 23.1 word list as **CC BY-SA 4.0** with attribution to the author; SourceForge page lists no license field.                                                                                                                                                                        | **Use, after confirming** the license file inside the release archive. Compatible with Wiktionary (same license). |
| LEXiTRON (NECTEC)                                  | Thai–English dictionary.                                                                                                                                                                                                         | 2003 LEXiTRON license (copy in the Yaitron repo) is BSD-like: redistribution with/without modification allowed with notice + attribution, no use of the name in a damaging way. But NECTEC's data catalog lists LEXiTRON 2.0 as "License not specified", and the NSTDA catalog says "Open Data Commons" — conflicting. | **Don't use in v1.** Provenance unclear. Revisit if NECTEC confirms terms in writing.                             |
| PyThaiNLP `tnc_freq.txt` (Thai National Corpus)    | Word frequency → `freqRank`.                                                                                                                                                                                                     | **CC0-1.0** (PyThaiNLP corpus license table).                                                                                                                                                                                                                                                                          | **Use.** Primary frequency list.                                                                                  |
| PyThaiNLP `ttc_freq.txt` (Thai Textbook Corpus)    | Frequency, textbook register.                                                                                                                                                                                                    | **CC0-1.0**.                                                                                                                                                                                                                                                                                                           | **Use** as secondary / tie-breaker.                                                                               |
| PyThaiNLP `words_th.txt`                           | Word list for coverage checks.                                                                                                                                                                                                   | **CC0-1.0**.                                                                                                                                                                                                                                                                                                           | Optional.                                                                                                         |
| wordfreq (`th`)                                    | —                                                                                                                                                                                                                                | Code Apache-2.0, data CC BY-SA 4.0.                                                                                                                                                                                                                                                                                    | **Not applicable**: Thai is not among wordfreq's supported languages.                                             |
| wisesight-1000 segmentation sample                 | Segmentation evaluation (spike only; not shipped).                                                                                                                                                                               | **CC0-1.0**.                                                                                                                                                                                                                                                                                                           | Use for evaluation.                                                                                               |

Consequences: code AGPL-3.0-or-later ([ADR 0006](decisions/0006-license.md)); `data/build/` ships under **CC BY-SA 4.0** with `ATTRIBUTION.md`
(Wiktionary contributors, kaikki.org/wiktextract, Volubilis, PyThaiNLP/TNC/TTC). Decision:
[ADR 0004](decisions/0004-dictionary-and-frequency-data.md).

Sources: [Wiktionary:Copyrights](https://en.wiktionary.org/wiki/Wiktionary:Copyrights),
[kaikki.org raw data](https://kaikki.org/dictionary/rawdata.html),
[kaikki.org Thai](https://kaikki.org/dictionary/Thai/index.html),
[PyThaiNLP corpus licenses](https://github.com/PyThaiNLP/pythainlp/blob/dev/pythainlp/corpus/corpus_license.md),
[LEXiTRON license (Yaitron copy)](https://github.com/veer66/Yaitron/blob/master/LICENSE-LEXITRON),
[LEXiTRON 2.0 — NECTEC catalog](https://opend-portal.nectec.or.th/en/dataset/lexitron-2-0),
[Volubilis on SourceForge](https://sourceforge.net/projects/belisan/),
[wordfreq](https://github.com/rspeer/wordfreq),
[wisesight-sentiment](https://github.com/PyThaiNLP/wisesight-sentiment).
