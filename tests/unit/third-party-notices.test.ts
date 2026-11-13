import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bundledPackages, noticesText, packageDirOf } from '../../scripts/lib/third-party-notices';

const NODE_MODULES = resolve(import.meta.dirname, '../../node_modules');

/** A fake node_modules with one package, for licenses the real tree doesn't have. */
function fakePackage(name: string, license: string, files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'phasa-notices-'));
  const dir = join(root, 'node_modules', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', license }));
  for (const [file, text] of Object.entries(files)) writeFileSync(join(dir, file), text);
  return join(dir, 'index.js');
}

describe('third-party notices', () => {
  it('finds the package of a module id, scoped and nested ones included', () => {
    expect(packageDirOf('/p/node_modules/react/cjs/react.production.js')).toBe(
      '/p/node_modules/react',
    );
    expect(packageDirOf('\0/p/node_modules/@wxt-dev/browser/src/index.mjs?commonjs-proxy')).toBe(
      '/p/node_modules/@wxt-dev/browser',
    );
    expect(packageDirOf('/p/node_modules/a/node_modules/b/x.js')).toBe(
      '/p/node_modules/a/node_modules/b',
    );
    expect(packageDirOf('/p/src/thai/tokenizer.ts')).toBeUndefined();
  });

  it("ships each package's license once, with NOTICE files after the license", () => {
    const packages = bundledPackages([
      join(NODE_MODULES, 'dexie/dist/dexie.mjs'),
      join(NODE_MODULES, 'dexie/import-wrapper-prod.mjs'),
      join(NODE_MODULES, 'react/index.js'),
    ]);
    expect(packages.map((p) => [p.name, p.license])).toEqual([
      ['dexie', 'Apache-2.0'],
      ['react', 'MIT'],
    ]);
    expect(packages[0]?.texts.map((t) => t.file)).toEqual(['LICENSE', 'NOTICE']);
    const text = noticesText(packages);
    expect(text).toContain('- dexie ');
    expect(text).toContain('--- NOTICE ---');
  });

  it('uses the upstream text for packages that publish no LICENSE file', () => {
    const [wxt] = bundledPackages([join(NODE_MODULES, '@wxt-dev/browser/src/index.mjs')]);
    expect(wxt?.texts[0]?.file).toBe('wxt-dev-wxt.LICENSE');
    expect(wxt?.texts[0]?.text).toMatch(/^MIT License/);
  });

  it('refuses licenses that are not on the allowlist and packages without a license text', () => {
    expect(() =>
      bundledPackages([fakePackage('copyleft-lib', 'GPL-2.0-only', { LICENSE: 'GPL' })]),
    ).toThrow(/copyleft-lib: license "GPL-2.0-only" is not on the allowlist/);
    expect(() => bundledPackages([fakePackage('bare-lib', 'MIT')])).toThrow(
      /bare-lib: no LICENSE file/,
    );
  });
});
