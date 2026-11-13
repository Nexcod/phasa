# License texts for packages that don't publish one

Some bundled npm packages carry a `license` field but no LICENSE file in their published tarball.
`scripts/lib/third-party-notices.ts` ships these texts for them instead (`FALLBACK_LICENSES`).

| File                            | Packages                                                       | Source                                                                |
| ------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------- |
| `wxt-dev-wxt.LICENSE`           | `wxt`, `@wxt-dev/browser`                                      | https://github.com/wxt-dev/wxt/blob/main/LICENSE (monorepo)           |
| `aklinker1-webext-core.LICENSE` | `@webext-core/isolated-element`, `@webext-core/match-patterns` | https://github.com/aklinker1/webext-core/blob/main/LICENSE (monorepo) |

Both downloaded on 2026-11-13. When a package starts shipping its own LICENSE, drop it here.
