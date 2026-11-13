/**
 * THIRD_PARTY_NOTICES.txt for the extension package (ADR 0006 follow-up, ADR 0017): every npm
 * package whose code ends up in the build, with its license text and NOTICE file. The package list
 * comes from the build itself (the module ids of WXT's output chunks), so a new dependency shows up
 * without editing a list. A package under a license that isn't known to be AGPL-compatible fails
 * the build (ADR 0006: no GPL-2.0-only, SSPL, "non-commercial" or proprietary code).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** SPDX ids of permissive licenses that can be combined with AGPL-3.0-or-later. */
export const ALLOWED_LICENSES = new Set([
  'MIT',
  'Apache-2.0',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'CC0-1.0',
]);

export interface BundledPackage {
  name: string;
  version: string;
  license: string;
  /** Contents of LICENSE*, LICENCE*, COPYING* and NOTICE* files, in that order. */
  texts: { file: string; text: string }[];
}

const LEGAL_FILE = /^(licen[cs]e|copying|notice)([-._].*)?$/i;

/** License texts in scripts/licenses/ for packages whose tarball has none (see its README). */
const FALLBACK_LICENSES: Record<string, string> = {
  wxt: 'wxt-dev-wxt.LICENSE',
  '@wxt-dev/browser': 'wxt-dev-wxt.LICENSE',
  '@webext-core/isolated-element': 'aklinker1-webext-core.LICENSE',
  '@webext-core/match-patterns': 'aklinker1-webext-core.LICENSE',
};
const FALLBACK_DIR = join(import.meta.dirname, '../licenses');

/** The package directory (…/node_modules/name or …/node_modules/@scope/name) of a module id. */
export function packageDirOf(moduleId: string): string | undefined {
  const path = moduleId.replace(/^\0+/, '').split('?')[0]?.replaceAll('\\', '/') ?? '';
  const at = path.lastIndexOf('/node_modules/');
  if (at < 0) return undefined;
  const rest = path.slice(at + '/node_modules/'.length).split('/');
  const name = rest[0]?.startsWith('@') ? `${rest[0]}/${rest[1] ?? ''}` : rest[0];
  if (!name) return undefined;
  return `${path.slice(0, at)}/node_modules/${name}`;
}

function legalTexts(dir: string): BundledPackage['texts'] {
  const order = (file: string) => (/^notice/i.test(file) ? 1 : 0);
  return readdirSync(dir)
    .filter((file) => LEGAL_FILE.test(file))
    .sort((a, b) => order(a) - order(b) || a.localeCompare(b))
    .map((file) => ({ file, text: readFileSync(join(dir, file), 'utf8').trim() }));
}

/** The packages behind `moduleIds`, sorted by name; throws listing every disallowed or missing license. */
export function bundledPackages(moduleIds: Iterable<string>): BundledPackage[] {
  const dirs = new Set<string>();
  for (const id of moduleIds) {
    const dir = packageDirOf(id);
    if (dir) dirs.add(dir);
  }
  const byName = new Map<string, BundledPackage>();
  const problems: string[] = [];
  for (const dir of dirs) {
    const manifest = join(dir, 'package.json');
    if (!existsSync(manifest)) throw new Error(`No package.json in ${dir}`);
    const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as {
      name?: string;
      version?: string;
      license?: string;
    };
    const name = pkg.name ?? dir;
    const license = pkg.license ?? '';
    if (!ALLOWED_LICENSES.has(license)) {
      problems.push(`${name}: license "${license}" is not on the allowlist (ADR 0006)`);
    }
    let texts = legalTexts(dir);
    const fallback = FALLBACK_LICENSES[name];
    if (texts.length === 0 && fallback) {
      texts = [{ file: fallback, text: readFileSync(join(FALLBACK_DIR, fallback), 'utf8').trim() }];
    }
    if (texts.length === 0) problems.push(`${name}: no LICENSE file; add one to scripts/licenses/`);
    const key = `${name}@${pkg.version ?? ''}`;
    if (!byName.has(key)) byName.set(key, { name, version: pkg.version ?? '', license, texts });
  }
  if (problems.length > 0) {
    throw new Error(
      `Third-party notices (scripts/lib/third-party-notices.ts):\n${problems.join('\n')}`,
    );
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function noticesText(packages: BundledPackage[]): string {
  const rule = '='.repeat(78);
  const head = [
    'Third-party software in Phasa',
    '',
    'Phasa is licensed under the GNU Affero General Public License v3.0 or later (see LICENSE).',
    'It includes the following open-source packages, each under its own license, reproduced',
    'below. Bundled fonts: fonts/OFL.txt. Dictionary and frequency data: data/ATTRIBUTION.md.',
    '',
    ...packages.map((pkg) => `- ${pkg.name} ${pkg.version} (${pkg.license})`),
  ];
  const bodies = packages.map((pkg) =>
    [
      rule,
      `${pkg.name} ${pkg.version} — ${pkg.license}`,
      rule,
      ...pkg.texts.map((t) => `--- ${t.file} ---\n\n${t.text}\n`),
    ].join('\n\n'),
  );
  return `${[head.join('\n'), ...bodies].join('\n\n')}\n`;
}
