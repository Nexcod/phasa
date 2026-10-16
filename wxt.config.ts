import { defineConfig } from 'wxt';

/** Pages that exist only for development and tests (docs/plan.md §5.1: fonts test page). */
const DEV_ONLY_ENTRYPOINTS = new Set(['fonts-test']);

// Permissions are added only when a feature needs them (see docs/decisions/0001-stack-and-scaffold.md).
// OAuth-related permissions (declarativeNetRequestWithHostAccess, auth.openai.com,
// api.openai.com, 127.0.0.1) arrive in phase 5 (docs/decisions/0003-chatgpt-oauth-redirect.md).
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  imports: false,
  manifest: {
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    permissions: ['storage', 'unlimitedStorage', 'sidePanel'],
    host_permissions: ['*://*.youtube.com/*'],
    action: {
      default_title: '__MSG_actionTitle__',
    },
    // Bundled Thai fonts are loaded by @font-face rules on youtube.com (src/ui/fonts.ts).
    web_accessible_resources: [{ resources: ['fonts/*.woff2'], matches: ['*://*.youtube.com/*'] }],
  },
  hooks: {
    // Production builds leave out dev-only pages unless a test run asks for them.
    'entrypoints:resolved': (wxt, entrypoints) => {
      if (wxt.config.mode !== 'production' || process.env.PHASA_TEST_PAGES === '1') return;
      for (let i = entrypoints.length - 1; i >= 0; i--) {
        if (DEV_ONLY_ENTRYPOINTS.has(entrypoints[i]?.name ?? '')) entrypoints.splice(i, 1);
      }
    },
  },
});
