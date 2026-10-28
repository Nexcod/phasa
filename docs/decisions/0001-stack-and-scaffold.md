# 0001. Stack, repository layout, permissions policy

- Status: Accepted; package manager superseded by [0008](0008-npm.md), nightly `@network` e2e by
  [0009](0009-network-e2e-runs-locally.md)
- Date: 2026-10-16
- Evidence: docs/plan.md §3, §11; phase 1 scaffold

## Context

The plan fixes the stack (WXT, TypeScript strict, React, Dexie, Vitest, Playwright, ESLint/Prettier,
pnpm). Versions current on 2026-10-16 differ from what the plan's authors may have assumed.

## Decision

- **WXT 0.21** with `@wxt-dev/module-react`, Vite 8, `imports: false` (explicit imports from
  `#imports` / `wxt/browser`; no magic globals).
- **TypeScript 6.0**, not 7.0: `typescript-eslint` 8.x supports `<6.1`. Revisit when it supports TS 7.
  Strict + `noUncheckedIndexedAccess`, `noImplicitOverride`, `noUnusedLocals/Parameters`.
- **React 19**, **Dexie 4**, **Vitest 5** (+ `fake-indexeddb`), **Playwright** with bundled Chromium
  (branded Chrome no longer accepts `--load-extension`).
- **ESLint 10** flat config with `strictTypeChecked` + `stylisticTypeChecked`, `react-hooks`, Prettier.
  `eslint-plugin-react` is not used (no ESLint 10 support).
- **pnpm 12** via `packageManager` (corepack). `pnpm-workspace.yaml` allows esbuild's build script.
  pnpm's release-age policy rejects packages published in the last day — pin to a slightly older patch
  instead of adding exclusions.
- Layout as plan §3.3, plus `src/background/` for SW handlers and `spikes/` for throwaway phase-0 kits
  (plain JS, loaded unpacked, not built or shipped).
- Architecture rules enforced in code, not only in docs:
  - ESLint `no-restricted-imports` forbids `dexie`, `src/db`, `src/auth`, `src/ai` in
    `entrypoints/youtube*.content*`.
  - `getDb()` throws outside a `chrome-extension:` origin.
  - Messaging methods declare which origins may call them (`METHOD_ACCESS`); the SW derives the origin
    from `port.sender`, never from the payload.
- **Permissions are added with the feature that needs them.** Phase 1 ships `storage`,
  `unlimitedStorage`, `sidePanel` and `*://*.youtube.com/*`. OAuth permissions (DNR or webNavigation,
  OpenAI hosts, `127.0.0.1`) come with phase 5 per ADR 0003; `tabs` only if a feature needs URLs of
  other tabs.
- Toolbar click opens the side panel for now; the toolbar popup (plan §10) replaces this in phase 6.

## Consequences

- CI (`.github/workflows/ci.yml`): lint, format check, typecheck, unit tests, zip artifact on every
  push/PR; offline e2e (stubbed youtube.com) per PR; `@network` e2e nightly.
- Live-caption e2e is not possible under automation (docs/spikes.md §1) — e2e uses recorded fixtures.
