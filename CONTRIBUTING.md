# Contributing to Phasa

Thanks for helping. Read [`AGENTS.md`](AGENTS.md) for the project rules and
[`docs/decisions/`](docs/decisions/README.md) before changing architecture.

## Setup and checks

```sh
corepack enable
pnpm install
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test
pnpm test:e2e   # first run: pnpm exec playwright install chromium
```

CI runs the same checks on every pull request.

## License and sign-off

Phasa is licensed under **AGPL-3.0-or-later** ([LICENSE](LICENSE), [ADR 0006](docs/decisions/0006-license.md)).
By contributing you agree that your contribution is licensed under the same terms.

Every commit must be signed off under the [Developer Certificate of Origin 1.1](https://developercertificate.org/):

```sh
git commit -s -m "Add tone colors to the word popup"
```

This adds `Signed-off-by: Your Name <you@example.com>` and certifies that you wrote the change or
otherwise have the right to submit it under the project's license.

## Data contributions

Dictionary, frequency and segmentation data must come from sources compatible with CC BY-SA 4.0
(see [ADR 0004](docs/decisions/0004-dictionary-and-frequency-data.md)). Name the source and its
license in the pull request and add it to `data/build/ATTRIBUTION.md`. Never commit data you only
have permission to use privately.
