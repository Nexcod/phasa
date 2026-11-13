# 0017. Release: version 1.0.0, store package and listing, generated images, release workflow

- Status: Accepted
- Date: 2026-11-13
- Evidence: docs/plan.md §11, §12 phase 7, §13; ADR 0006 follow-ups; Chrome Web Store docs read
  on 2026-11-13 (images, listing and privacy tabs, User Data FAQ); `scripts/check-package.ts`,
  `scripts/lib/third-party-notices.ts`, `tests/store/screenshots.spec.ts`

## Context

Phase 7 asks for a README with installation, screenshots and how Sign in with ChatGPT works; a
license plus data attribution; a privacy policy; icons and screenshots for the Chrome Web Store;
permission justifications; and the zip built in CI. The plan's "MIT for code" was superseded by
ADR 0006 (AGPL-3.0-or-later), whose follow-up asks for third-party license notices in the zip. CI
already built the zip on every push but checked nothing in it, and the extension had no icons.

The store wants a 128×128 icon (96 px of artwork, 16 px transparent padding), one to five
1280×800 screenshots (shown at 640×400), optional 440×280 and 1400×560 promo tiles with little
text, a single-purpose statement, a justification per permission, a remote-code answer, data
usage disclosures that also cover data handled only on the device, and a privacy policy URL.

## Decision

**Version 1.0.0.** The plan calls this release v1 and everything after it "after v1". The
manifest takes `package.json`'s version (WXT). From here: patch for fixes, minor for features,
major when a backup file from an earlier version can no longer be restored.

**What the zip carries besides the code:** `LICENSE` (AGPL text), `data/ATTRIBUTION.md`,
`fonts/OFL.txt` (as before) and `THIRD_PARTY_NOTICES.txt`. The notices are generated at build time
from the module ids of WXT's output chunks (`build:done` hook), so the list is exactly what ships
— today react, react-dom, scheduler, dexie (with its Apache NOTICE), jose, wxt's runtime and five
small helpers. A package whose `license` is not on an allowlist of permissive licenses fails the
build (ADR 0006); a package that publishes no LICENSE file fails it too, unless
`scripts/licenses/` holds its upstream text (wxt, `@wxt-dev/browser`, `@webext-core/*` today).

**Package check.** `npm run package:check` reads the zip and fails on: a version other than
`package.json`'s (or the tag's), permissions or host permissions other than the four + four
justified in `docs/store/listing.md`, "Tube" in the name, name or description over Chrome's 75 /
132 characters, a missing or wrongly sized icon, a missing legal file, a source map or the
dev-only fonts page. CI runs it after `npm run zip`.

**Release workflow.** Pushing a tag `vX.Y.Z` runs lint, typecheck, unit tests, the zip and the
package check (with the tag), and drafts a GitHub release with the zip attached. The e2e tests
stay in CI on main; only commits with a green CI run are tagged. Uploading to the Chrome Web Store
is manual: the first submission needs the dashboard's forms anyway, and the publish API would put
long-lived Google credentials into repository secrets for a step done a few times a year. Revisit
when releases become frequent.

**Icon.** The letter ภ (first letter of ภาษา, "language", the name's origin) in the bundled Noto
Sans Thai Looped, white on the UI's blue accent turned into a gradient, over a strip of the five
tone colors from 48 px up. `npm run icons` draws it on a canvas in Playwright's Chromium, measuring
the glyph to centre its ink, and writes `public/icon/{16,32,48,128}.png` (WXT adds them to the
manifest) and the two promo tiles (the word ภาษา over the tone strip: brand, no other text).
Rendering a glyph of an OFL font into an image is allowed by the OFL.

**Screenshots** are generated, not taken by hand: `npm run store:screenshots` builds the
production extension and runs `tests/store/screenshots.spec.ts` on a fresh install against the e2e
fakes of YouTube and OpenAI. The watch page is a plain dark video-site layout with an abstract
frame instead of a video, around the e2e fake player; the demo video's seven Thai lines and their
English were written for Phasa (`tests/fixtures/captions/showcase.*`), and so is the AI answer. So
no creator's video, channel or captions and no third-party brand appear in the store or the
README, and the images can be retaken after any UI change. Five shots: word popup with
romanization, AI explanation, analysis details, side panel next to the video (two pages composed
side by side), known-word onboarding (zoomed so it reads at 640×400).

**Privacy policy** in the repository (`PRIVACY.md`, linked from Options → About and the listing):
what is stored on the device, what goes to YouTube (the player's own subtitle requests, repeated
in another format), to OpenAI (only with AI set up, only on request, with the exact context) and
to an online speech voice if Chrome picks one, and that nothing reaches the developer. The data
disclosures tick personally identifiable information (the ChatGPT email), authentication
information, web history (video ids and titles) and website content (subtitles), all local except
the AI request text; the three Limited Use certifications hold.

**Listing.** `docs/store/listing.md` holds every dashboard field: name and summary from the
manifest, category Education, the plain-text description, single purpose, permission
justifications, the remote-code answer (none), data usage and reviewer instructions.
`docs/store/README.md` lists the assets and the release steps.

**README** leads with what Phasa does, screenshots, installation (store once published, release
zip, source), keys, how Sign in with ChatGPT works (consent, loopback redirect captured by a
session DNR rule, tokens only in the service worker, limits, sign-out) and privacy; development
notes follow.

**Acceptance** (the plan gives none for this phase): the phase 7 items of
`docs/manual-checklist.md` pass on the zip from the draft release, and version 1.0.0 is submitted
to the store. The store link goes into the README when the review is through.

## Consequences

- A new permission or host permission fails the package check until the listing, PRIVACY.md and
  `scripts/check-package.ts` are updated, which is the moment to remember that Chrome will ask
  existing users to accept it.
- A new runtime dependency shows up in the notices by itself; one under a license not on the
  allowlist, or without a LICENSE file, stops the build until someone looks.
- A visible UI change makes the screenshots stale; re-run `npm run store:screenshots`.
- Users of a release zip loaded unpacked get no automatic updates; the README says to unzip each
  release into the same folder, which keeps the extension id and the data.
- Owner's steps outside the repository: the Chrome Web Store developer account, the first
  submission and answering the review; possible questions about `declarativeNetRequest` and
  `127.0.0.1` are answered by the justification text. Before monetizing, ADR 0006's follow-ups
  (trademark policy, OpenAI's interest form) still apply.
