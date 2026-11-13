import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'wxt';
import { bundledPackages, noticesText } from './scripts/lib/third-party-notices';

/** Built dictionary and frequency files shipped under data/ (scripts/build-*.ts, ADR 0004). */
const DATA_FILES = ['dict.json', 'dict.meta.json', 'freq.json'];

/** Pages that exist only for development and tests (docs/plan.md §5.1: fonts test page). */
const DEV_ONLY_ENTRYPOINTS = new Set(['fonts-test']);

/** License texts of the bundled npm packages, at the package root (ADR 0017). */
const NOTICES_FILE = 'THIRD_PARTY_NOTICES.txt';

// Permissions are added only when a feature needs them (see docs/decisions/0001-stack-and-scaffold.md).
// Sign in with ChatGPT (docs/decisions/0003-chatgpt-oauth-redirect.md, option A1): a DNR session
// rule sends OpenAI's redirect to http://127.0.0.1:1455/auth/callback to auth-callback.html; the
// service worker calls auth.openai.com and api.openai.com (also for the user's own API key).
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  imports: false,
  manifest: {
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    permissions: [
      'storage',
      'unlimitedStorage',
      'sidePanel',
      'declarativeNetRequestWithHostAccess',
    ],
    host_permissions: [
      '*://*.youtube.com/*',
      'https://auth.openai.com/*',
      'https://api.openai.com/*',
      'http://127.0.0.1/*',
    ],
    action: {
      default_title: '__MSG_actionTitle__',
    },
    // Bundled Thai fonts are loaded by @font-face rules on youtube.com (src/ui/fonts.ts).
    web_accessible_resources: [
      { resources: ['fonts/*.woff2'], matches: ['*://*.youtube.com/*'] },
      // The DNR redirect target must be reachable from OpenAI's page and the loopback URL.
      {
        resources: ['auth-callback.html'],
        matches: ['https://auth.openai.com/*', 'http://127.0.0.1/*'],
      },
    ],
  },
  hooks: {
    // The service worker loads the dictionary into IndexedDB from the package (src/dictionary/store.ts)
    // and reads the frequency list from it (src/dictionary/frequency.ts). Legal files ship with the
    // package (ADR 0006, 0017): the code license and the data attribution; the fonts carry their own
    // OFL.txt in public/fonts/.
    'build:publicAssets': (_wxt, files) => {
      for (const file of DATA_FILES) {
        files.push({ absoluteSrc: resolve('data/build', file), relativeDest: `data/${file}` });
      }
      files.push({ absoluteSrc: resolve('LICENSE'), relativeDest: 'LICENSE' });
      files.push({
        absoluteSrc: resolve('data/build/ATTRIBUTION.md'),
        relativeDest: 'data/ATTRIBUTION.md',
      });
    },
    // Production builds leave out dev-only pages unless a test run asks for them.
    'entrypoints:resolved': (wxt, entrypoints) => {
      if (wxt.config.mode !== 'production' || process.env.PHASA_TEST_PAGES === '1') return;
      for (let i = entrypoints.length - 1; i >= 0; i--) {
        if (DEV_ONLY_ENTRYPOINTS.has(entrypoints[i]?.name ?? '')) entrypoints.splice(i, 1);
      }
    },
    // The licenses of every npm package the build bundles, read from the build's own chunks.
    'build:done': (wxt, output) => {
      if (wxt.config.command !== 'build') return;
      const moduleIds = output.steps.flatMap((step) =>
        step.chunks.flatMap((chunk) => (chunk.type === 'chunk' ? chunk.moduleIds : [])),
      );
      writeFileSync(
        resolve(wxt.config.outDir, NOTICES_FILE),
        noticesText(bundledPackages(moduleIds)),
      );
    },
  },
});
