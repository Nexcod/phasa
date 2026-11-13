/**
 * Checks the Chrome Web Store zip before it is uploaded (ADR 0017):
 *
 *   npm run zip && npm run package:check [-- --tag v1.2.3]
 *
 * - the manifest's version is package.json's (and the git tag's, with --tag);
 * - permissions and host permissions are exactly the justified ones (docs/store/listing.md);
 * - the name has no "YouTube"/"Tube" and fits the store's limits, as does the description;
 * - icons 16/32/48/128 are there and have their sizes;
 * - the legal files ship: LICENSE, THIRD_PARTY_NOTICES.txt, data/ATTRIBUTION.md, fonts/OFL.txt;
 * - nothing dev-only ships: the fonts test page, source maps.
 *
 * Reads the zip with `unzip` (present on GitHub's Ubuntu runners and most Linux/macOS systems).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  name: string;
  version: string;
};
const ZIP = join(ROOT, '.output', `${pkg.name}-${pkg.version}-chrome.zip`);

/** Changing these needs a justification in docs/store/listing.md and a new store review. */
const PERMISSIONS = [
  'declarativeNetRequestWithHostAccess',
  'sidePanel',
  'storage',
  'unlimitedStorage',
];
const HOST_PERMISSIONS = [
  '*://*.youtube.com/*',
  'http://127.0.0.1/*',
  'https://api.openai.com/*',
  'https://auth.openai.com/*',
];
const ICON_SIZES = [16, 32, 48, 128];
const REQUIRED_FILES = [
  'LICENSE',
  'THIRD_PARTY_NOTICES.txt',
  'data/ATTRIBUTION.md',
  'fonts/OFL.txt',
];
/** Chrome's manifest limits for name and description. */
const NAME_MAX = 75;
const DESCRIPTION_MAX = 132;

interface Manifest {
  version: string;
  name: string;
  description: string;
  permissions?: string[];
  host_permissions?: string[];
  icons?: Record<string, string>;
}

const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
};

const unzip = (...args: string[]) => execFileSync('unzip', args, { maxBuffer: 64 * 1024 * 1024 });
const read = (path: string) => unzip('-p', ZIP, path);

if (!existsSync(ZIP)) {
  console.error(`No ${ZIP}: run npm run zip first.`);
  process.exit(1);
}
const entries = new Set(unzip('-Z1', ZIP).toString('utf8').split('\n').filter(Boolean));
const manifest = JSON.parse(read('manifest.json').toString('utf8')) as Manifest;
const messages = JSON.parse(read('_locales/en/messages.json').toString('utf8')) as Record<
  string,
  { message: string }
>;
const message = (value: string) =>
  value.replace(/^__MSG_(\w+)__$/, (_, key: string) => messages[key]?.message ?? value);

check(manifest.version === pkg.version, `manifest version ${manifest.version} ≠ ${pkg.version}`);
const tagAt = process.argv.indexOf('--tag');
if (tagAt >= 0) {
  const tag = process.argv[tagAt + 1] ?? '';
  check(tag === `v${pkg.version}`, `tag ${tag} ≠ v${pkg.version} (package.json)`);
}

const same = (a: string[] = [], b: string[]) =>
  JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
check(
  same(manifest.permissions, PERMISSIONS),
  `permissions ${JSON.stringify(manifest.permissions)} ≠ the justified ${JSON.stringify(PERMISSIONS)}`,
);
check(
  same(manifest.host_permissions, HOST_PERMISSIONS),
  `host_permissions ${JSON.stringify(manifest.host_permissions)} ≠ the justified ${JSON.stringify(HOST_PERMISSIONS)}`,
);

const name = message(manifest.name);
const description = message(manifest.description);
check(!/tube/i.test(name), `name "${name}" contains "Tube" (Chrome Web Store trademark rules)`);
check(name.length <= NAME_MAX, `name is ${name.length} characters, at most ${NAME_MAX}`);
check(
  description.length <= DESCRIPTION_MAX,
  `description is ${description.length} characters, at most ${DESCRIPTION_MAX}`,
);

for (const size of ICON_SIZES) {
  const path = manifest.icons?.[String(size)];
  if (!path || !entries.has(path)) {
    problems.push(`icon ${size}: missing from the manifest or the zip`);
    continue;
  }
  const png = read(path);
  // PNG: 8-byte signature, then the IHDR chunk with width and height (big-endian).
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  check(width === size && height === size, `icon ${size}: ${path} is ${width}×${height}`);
}

for (const file of REQUIRED_FILES) check(entries.has(file), `${file} is missing`);
for (const entry of entries) {
  check(!entry.endsWith('.map'), `${entry}: source map in the package`);
  check(!entry.startsWith('fonts-test'), `${entry}: dev-only page in the package`);
}

if (problems.length > 0) {
  console.error(`✖ ${ZIP}\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
const kb = Math.round(statSync(ZIP).size / 1024);
console.log(`✔ ${ZIP} (${kb} KB, ${entries.size} files): ${name} ${manifest.version}`);
