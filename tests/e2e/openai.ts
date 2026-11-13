/**
 * A fake OpenAI behind Playwright routes and the sign-in through it, shared by the AI e2e tests and
 * the store screenshots (tests/store).
 */
import type { BrowserContext, Page, Route } from '@playwright/test';
import { expect } from './fixtures';
import { EMAIL, type FakeOpenAi } from '../helpers/fake-openai';

export async function routeFakeOpenAi(context: BrowserContext, openai: FakeOpenAi): Promise<void> {
  const handler = async (route: Route) => {
    const request = route.request();
    const url = request.url();
    if (url.startsWith('https://auth.openai.com/api/accounts/authorize')) {
      // OpenAI's account chooser and consent, accepted at once.
      await route.fulfill({ status: 302, headers: { location: await openai.authorize(url) } });
      return;
    }
    const answer = await openai.handle({
      url,
      method: request.method(),
      headers: request.headers(),
      body: request.postData() ?? '',
    });
    await route.fulfill({ status: answer.status, headers: answer.headers, body: answer.body });
  };
  await context.route('https://auth.openai.com/**', handler);
  await context.route('https://api.openai.com/**', handler);
}

/**
 * The sign-in tab the extension opened, once it reached the callback page. Its first request
 * may leave before Playwright attaches its routes; OpenAI's hosts point at a closed port in
 * tests (fixtures.ts), so that load fails and is simply repeated, now routed.
 */
export async function callbackPage(
  context: BrowserContext,
  extensionId: string,
  click: () => Promise<void>,
) {
  const opened = context.waitForEvent('page');
  await click();
  const tab = await opened;
  const callback = `chrome-extension://${extensionId}/auth-callback.html`;
  await expect
    .poll(
      async () => {
        if (tab.url().startsWith('chrome-error:')) await tab.reload().catch(() => undefined);
        return tab.url().startsWith(callback);
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  return tab;
}

/** Options → Continue with ChatGPT → (fake consent) → the callback page. */
export async function signIn(context: BrowserContext, extensionId: string): Promise<Page> {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html#ai`);
  const callback = await callbackPage(context, extensionId, () =>
    options.getByTestId('phasa-siwc-button').click(),
  );
  await expect(callback.getByTestId('phasa-callback-ok')).toHaveText(`Connected ✓ as ${EMAIL}`);
  return options;
}
