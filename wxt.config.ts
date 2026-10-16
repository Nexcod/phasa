import { defineConfig } from 'wxt';

// Permissions are added only when a feature needs them (see docs/decisions/0001-stack.md).
// OAuth-related permissions (declarativeNetRequestWithHostAccess or webNavigation,
// auth.openai.com, api.openai.com, 127.0.0.1) arrive in phase 5, after the SIWC spike.
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
  },
});
