/** Browser pieces of the sign-in (ADR 0003, option A1). Service worker only. */
import { browser } from 'wxt/browser';
import type { AttemptStore, RedirectRule } from './chatgpt';
import { LOOPBACK_PORT, type SignInAttempt } from './oauth';

const ATTEMPT_KEY = 'phasaSignInAttempt';
const RULE_ID = 1455;
export const CALLBACK_PATH = '/auth-callback.html';

/**
 * chrome.storage.session: survives service-worker restarts, not browser restarts, and is closed
 * to content scripts by default (unlike storage.local).
 */
export const sessionAttempts: AttemptStore = {
  async get() {
    const stored = await browser.storage.session.get(ATTEMPT_KEY);
    return stored[ATTEMPT_KEY] as SignInAttempt | undefined;
  },
  set: (attempt) => browser.storage.session.set({ [ATTEMPT_KEY]: attempt }),
  clear: () => browser.storage.session.remove(ATTEMPT_KEY),
};

/** `http://127.0.0.1:1455/auth/callback?…` → `chrome-extension://<id>/auth-callback.html?…`. */
export function loopbackRedirectRule(callbackPage: string): RedirectRule {
  return {
    install: () =>
      browser.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [RULE_ID],
        addRules: [
          {
            id: RULE_ID,
            priority: 1,
            action: { type: 'redirect', redirect: { regexSubstitution: `${callbackPage}?\\1` } },
            condition: {
              regexFilter: `^http://127\\.0\\.0\\.1:${LOOPBACK_PORT}/auth/callback\\?(.*)$`,
              resourceTypes: ['main_frame'],
            },
          },
        ],
      }),
    remove: () => browser.declarativeNetRequest.updateSessionRules({ removeRuleIds: [RULE_ID] }),
  };
}

export async function openTab(url: string): Promise<void> {
  await browser.tabs.create({ url });
}
