# Chrome Web Store

What goes to the store and how it is made (ADR 0017). The field-by-field text is in
[listing.md](listing.md); the privacy policy is [PRIVACY.md](../../PRIVACY.md).

| Asset                        | Size     | Made by                                                       |
| ---------------------------- | -------- | ------------------------------------------------------------- |
| `public/icon/{16,32,48,128}` | px       | `npm run icons` (`scripts/build-icons.ts`)                    |
| `promo-small.png`            | 440×280  | `npm run icons`                                               |
| `promo-marquee.png`          | 1400×560 | `npm run icons`                                               |
| `screenshots/*.png`          | 1280×800 | `npm run store:screenshots` (`tests/store/`)                  |
| `phasa-<version>-chrome.zip` |          | `npm run zip` + `npm run package:check`; the release workflow |

All images are generated and committed. The screenshots come from the production build on a fresh
install, against the e2e fakes of YouTube and OpenAI, with a demo video whose Thai lines were
written for Phasa (`tests/fixtures/captions/showcase.*`): no third-party video, channel or brand
appears. Re-run `npm run store:screenshots` after a visible UI change and look at every image;
the store shows them at 640×400.

## Releasing a version

1. Bump `version` in `package.json` (`npm version <x.y.z> --no-git-tag-version`), update the
   status in the README, commit, push, and wait for CI on main to pass.
2. Tag the commit and push the tag: `git tag v<x.y.z> && git push origin v<x.y.z>`. The release
   workflow checks the package and drafts a GitHub release with the zip.
3. Download the zip from the draft release, unzip it and load it unpacked in Chrome for the
   release checks in [docs/manual-checklist.md](../manual-checklist.md).
4. Chrome Web Store developer dashboard → Phasa → Package → upload the zip. For the first
   submission, fill every tab from [listing.md](listing.md). Submit for review.
5. Publish the GitHub release once the store accepts the version, and add the store link to the
   README.

A new permission or host permission changes `scripts/check-package.ts`, the justification in
listing.md and PRIVACY.md, and makes Chrome ask existing users to accept it.
