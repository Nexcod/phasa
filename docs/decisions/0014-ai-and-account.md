# 0014. AI and the account: credentials, requests, streaming, cache

- Status: Accepted; the plan's default model revised by [0015](0015-default-plan-model.md); cache
  hits checked against the answer's shape by [0016](0016-data-settings-and-polish.md)
- Date: 2026-11-01
- Evidence: docs/plan.md §8, §12 phase 5; [ADR 0003](0003-chatgpt-oauth-redirect.md);
  docs/spikes.md §2; OpenAI's Sign in with ChatGPT pages re-read on 2026-11-01;
  `tests/unit/auth.test.ts`, `tests/unit/ai.test.ts`, `tests/unit/ai-service.test.ts`,
  `tests/unit/ai-handlers.test.ts`, `tests/e2e/ai.spec.ts`

## Context

Phase 5: `src/auth` after the spike (ADR 0003, option A1), the two providers of plan §8.5,
`explainWord` and `translateCue`, the cache, limits and errors, the account screen and the API
key fallback. OpenAI's preview docs, re-read before the implementation, differ from the spike in
three places:

- **Reauthorization.** With the issued client id the docs now say the user "sees only the account
  selector, then is redirected — no consent screen", and with `id_token_hint` not even the
  selector. In the spike every sign-in showed the chooser and consent. The acceptance criterion
  "re-sign-in without the consent screen" is therefore OpenAI's behaviour to check live; our side
  sends what the docs ask for.
- **Sign-out** is documented now: `revocation_endpoint` from OIDC discovery, a form POST with
  `token`, `token_type_hint=refresh_token` and `client_id`; an empty 200 is success, also for a
  dead token. Revocation failures: retry, else clear locally and tell the user.
- **ID-token check**: the JWKS URL is documented (`/.well-known/jwks.json`), and OpenAI's example
  uses `jose` with a 5 s clock tolerance and required `sub`, `exp`, `iat`.

## Decision

**Credentials in the extension's IndexedDB** (table `credentials`, schema v3), not in
`chrome.storage.local` as plan §8.2 step 7 and §8.7 say: storage.local is open to content
scripts by default, and our content script runs in youtube.com's renderer process, so a
compromised renderer could read the tokens there. The extension origin's IndexedDB is out of its
reach. Only the service worker reads the table; the rule "tokens never leave the service worker"
holds as before. `SECRET_TABLES` marks it so the phase 6 backup leaves it out. The sign-in attempt
(state, nonce, PKCE verifier) lives in `chrome.storage.session`, which is closed to content
scripts by default and survives service-worker restarts.

**Sign-in** (src/auth/chatgpt.ts), on top of ADR 0003:

- First registration: `dynamic_agent_client` + `agent_name_hint=Phasa`; the issued client id is
  saved before the code exchange. Reauthorization: the issued client id, `id_token_hint` (the
  current ID token, or the one kept after a terminal refresh error) and `login_hint`; after a
  sign-out only `login_hint`, because sign-out clears the ID token.
- A callback without `client_id` means "the saved one"; a different one is rejected. A returning
  sign-in whose ID token names another account is rejected too: v1 keeps one registration, and
  "Forget account" is the way to switch.
- The ID token is checked with `jose` (`jwtVerify` + remote JWKS, exact issuer, audience = issued
  client id, `sub`/`exp`/`iat`, 5 s tolerance) and our nonce. AI is on only with
  `chatgpt.tokens.use.direct` granted; without it the sign-in stays and the UI says so.
- A stale callback tab (other `state`) doesn't cancel the attempt in progress. An attempt is good
  for 30 minutes; on start the service worker drops a redirect rule nothing waits for.
- The callback page hands the query to the service worker over the usual Port and removes it from
  the address bar and history first. On success it shows OpenAI's one-time notice "You're using
  your ChatGPT plan" with "Got it".

**Tokens.** Refresh at `earliest_refresh_at` (seconds, milliseconds or ISO; advisory) or 5
minutes before expiry, and always within the last minute; one refresh at a time; the new set
replaces the old in one transaction and only if the refresh token it used is still current
(a sign-out in between wins). Terminal codes (`invalid_grant`, `refresh_token_*`, …) drop the
tokens, keep the client id, the account and the ID token as the next hint, and show "sign in
again"; `invalid_client` drops the registration as well. Network trouble and 5xx keep everything,
and a still-valid access token is used meanwhile. A 401 from the API gets one forced refresh and
one retry; a second 401 is reported as refused, not as "sign in again" (the docs ask to send the
user to OAuth only after a confirmed revocation or a terminal refresh error).

**Sign-out** revokes as documented (one retry on network/5xx), clears the three tokens and keeps
the client id, the account (its email is the next `login_hint`) and the host id; an unconfirmed
revocation says so and points to ChatGPT settings. **Forget account** also drops the client id
and the account. It keeps the host id: the docs want `ext_agent_host_id` stable per
installation, and it is not account data (the plan's "Forget removes everything" otherwise holds).

**Requests** (src/ai). One Responses client for both providers (plan §8.5): `store: false`,
`stream: true`, `instructions`, the context in one `user` message, `text.format: json_schema`
(strict, it worked in the spike). The fields the preview rejects are `never` in the request type
and checked again at runtime, as are `system` messages. No undocumented fields (no `reasoning`).
Success only on `response.completed`; `response.failed`/`error`, `response.incomplete`, a stream
that just ends, 60 s without data and 180 s in total are failures. The answer is validated
against the schema it was asked with (a small validator, no zod); one retry if it doesn't match
(plan §8.4). OpenAI's codes map to the error kinds in `src/ai/errors.ts`; the UI has one message
and action per kind. At the usage limit "Manage usage" (`https://chatgpt.com/settings/usage`) is
the main action.

**Models.** ChatGPT plan: `/v1/models` → `models[]` with `visibility: "list"`, in the server's
order; the default is the first one (the list has no "fast" marker; latency is measured live, see
the checklist), remembered so cache lookups never need the network. API key: the platform's
`data[]`, text models newest first, and no default: the user pays per request and picks one.
Choice, provider and fallback are settings (`aiProvider`, `aiModelChatGpt`, `aiModelApiKey`,
`aiFallbackToApiKey`) — preferences, not secrets.

**Fallback** to the API key only when the user turned it on, and only when the plan can't serve:
usage limit, unavailable, not eligible, no plan permission (plan §8.4).

**Streaming over messaging.** A method may declare a `progress` type; the service worker sends
`{kind: 'progress', id, data}` to the port that asked, until the response (protocol v5). AI
progress is the answer's fields parsed so far from its partial JSON, at most every 120 ms, so the
meaning shows while the rest streams in.

**Cache** (`aiCache`, plan §8.6): sha256 of function, prompt version, model and input (the word,
the line, its English line, two lines on each side, the video title). Only validated answers are
stored; at most 5 000 rows. A cached answer shows when the popup opens, without a request, also
when signed out. Identical requests in flight share one stream.

**Limits.** Requests that reach OpenAI from a YouTube tab: 20 per minute per tab (a compromised
page could otherwise spend the user's plan or key); 3 streams at a time.

**UI.** Word and phrase popups: "Explain in context" and "Translate the line", with "Using
ChatGPT plan · Manage usage" next to them. Side panel: an AI button on each transcript line.
Options → AI: "Continue with ChatGPT" with OpenAI's logo (`public/brand`) and
`data-oai-siwc-button`; before the first sign-in the page warns that OpenAI calls Phasa
unverified and lets the agent be renamed; signed in: email, model, sign out, forget; the API key
(checked against `/v1/models` before it is saved, shown as `sk-…a1b2`) and its model; provider
and fallback. Development builds add "Expire the access token now" to try the refresh.

**Not in this phase:** AI translation of a whole video behind a confirmation (plan §8.6) and the
plan's phase-2 functions `explainGrammar` / `fixSegmentation` — after v1. Several accounts: the
record is per registration, the UI handles one.

## Consequences

- Phase 6's JSON export must skip `SECRET_TABLES`; an import never writes them.
- e2e tests run against a fake OpenAI (`tests/helpers/fake-openai.ts`) through Playwright routes,
  which also catch the service worker's requests. The first navigation of a tab the extension
  opens can escape the routes, so the e2e browser maps OpenAI's hosts to a closed port: no test
  ever reaches the real OpenAI.
- To check live (manual checklist, phase 5): reauthorization without consent, the revocation
  answer, `earliest_refresh_at`'s format, model latency for the default, and a real recorded
  stream for `tests/fixtures/responses/` (the fixture now is reconstructed from the event types
  the spike logged).
- Revisit the default model if a later-listed model is clearly faster at similar quality, and the
  storage choice if Chrome lets extensions close storage.local to content scripts.
