/**
 * Phase 5 (docs/plan.md §12): Sign in with ChatGPT through the DNR redirect (ADR 0003), AI
 * answers in the word popup and the side panel, limits, refresh — against a fake OpenAI served
 * through Playwright routes (the service worker's requests included).
 */
import type { Locator, Page } from '@playwright/test';
import { expect, test, youTubeTabId } from './fixtures';
import { routeFakeYouTube } from './fake-youtube';
import { callbackPage, routeFakeOpenAi, signIn } from './openai';
import { EMAIL, ISSUED_CLIENT_ID, createFakeOpenAi, type FakeOpenAi } from '../helpers/fake-openai';

const overlay = (page: Page) =>
  page.locator('#movie_player phasa-overlay [data-testid="phasa-overlay"]');

const word = (page: Page, thai: string): Locator =>
  overlay(page)
    .getByTestId('phasa-word')
    .filter({ has: page.locator('.phasa-word__thai', { hasText: new RegExp(`^${thai}$`) }) });

async function openCue(page: Page): Promise<void> {
  await page.goto('https://www.youtube.com/watch?v=iH31BMKBEdU');
  await page.waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 1);
  await expect(overlay(page)).toHaveAttribute('data-words', 'ready', { timeout: 30_000 });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const video = document.querySelector('video')!;
        video.addEventListener('seeked', () => resolve(), { once: true });
        video.currentTime = 2.5;
      }),
  );
  await expect(overlay(page).getByTestId('phasa-subtitles')).toHaveAttribute('data-index', '1');
}

const responsesRequests = (openai: FakeOpenAi) =>
  openai.log.filter((request) => request.url.endsWith('/v1/responses'));

test.describe('AI', () => {
  test('signs in with ChatGPT through the loopback redirect', async ({ context, extensionId }) => {
    const openai = await createFakeOpenAi();
    await routeFakeOpenAi(context, openai);
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html#ai`);
    const account = options.getByTestId('phasa-account-chatgpt');
    await expect(account).toHaveAttribute('data-state', 'signed-out');
    await expect(account).toContainText("OpenAI will say it hasn't verified Phasa");
    await expect(options.getByTestId('phasa-account-status')).toHaveAttribute(
      'data-ready',
      'false',
    );

    const callback = await callbackPage(context, extensionId, () =>
      options.getByTestId('phasa-siwc-button').click(),
    );
    // The DNR rule took the browser from 127.0.0.1:1455 to our page, which dropped the code.
    await expect(callback.getByTestId('phasa-callback-ok')).toHaveText(`Connected ✓ as ${EMAIL}`);
    await expect(
      callback.getByRole('heading', { name: "You're using your ChatGPT plan" }),
    ).toBeVisible();
    expect(new URL(callback.url()).pathname).toBe('/auth-callback.html');
    expect(callback.url()).not.toContain('code=');
    const exchange = openai.log.find((request) => request.body.includes('authorization_code'))!;
    expect(new URLSearchParams(exchange.body).get('client_id')).toBe(ISSUED_CLIENT_ID);

    // The options page follows without a reload.
    await expect(account).toHaveAttribute('data-state', 'signed-in');
    await expect(options.getByTestId('phasa-account-email')).toHaveText(`Signed in as ${EMAIL}.`);
    await expect(options.getByTestId('phasa-account-model-plan')).toContainText(
      'Default: GPT-Fake-Sol',
    );
    await expect(options.getByTestId('phasa-account-status')).toHaveAttribute('data-ready', 'true');

    // "Got it" closes the tab.
    await callback.getByRole('button', { name: 'Got it' }).click();
    await expect.poll(() => callback.isClosed()).toBe(true);
  });

  test('signing in again reuses the registration and sends the hints', async ({
    context,
    extensionId,
  }) => {
    const openai = await createFakeOpenAi();
    await routeFakeOpenAi(context, openai);
    const options = await signIn(context, extensionId);
    await options.getByTestId('phasa-account-sign-out').click();
    await expect(options.getByTestId('phasa-account-chatgpt')).toHaveAttribute(
      'data-state',
      'signed-out',
    );
    expect(openai.log.some((request) => request.url.endsWith('/oauth/revoke'))).toBe(true);
    await expect(options.getByTestId('phasa-account-chatgpt')).toContainText(
      'Signing in again only asks you to choose the account',
    );

    const authorizations: string[] = [];
    context.on('request', (request) => {
      if (request.url().startsWith('https://auth.openai.com/api/accounts/authorize')) {
        authorizations.push(request.url());
      }
    });
    const callback = await callbackPage(context, extensionId, () =>
      options.getByTestId('phasa-siwc-button').click(),
    );
    await expect(callback.getByTestId('phasa-callback-ok')).toBeVisible();
    const params = new URL(authorizations.at(-1)!).searchParams;
    expect(params.get('client_id')).toBe(ISSUED_CLIENT_ID);
    expect(params.has('agent_name_hint')).toBe(false);
    expect(params.get('login_hint')).toBe(EMAIL);
    await expect(options.getByTestId('phasa-account-chatgpt')).toHaveAttribute(
      'data-state',
      'signed-in',
    );

    // Signed out, "Forget account" sits under the button and asks first.
    await options.getByTestId('phasa-account-sign-out').click();
    const account = options.getByTestId('phasa-account-chatgpt');
    await expect(account).toHaveAttribute('data-state', 'signed-out');
    const button = await options.getByTestId('phasa-siwc-button').boundingBox();
    const forget = await options.getByTestId('phasa-account-forget').boundingBox();
    expect(forget!.y).toBeGreaterThanOrEqual(button!.y + button!.height);
    await options.getByTestId('phasa-account-forget').click();
    await expect(account).toContainText('Forget the ChatGPT account?');
    await account.getByRole('button', { name: 'Forget account' }).click();
    await expect(account).toContainText('OpenAI opens in a new tab');
    await expect(options.getByTestId('phasa-account-forget')).toHaveCount(0);
  });

  test('explains a word in its line, streamed, then from the cache', async ({
    context,
    extensionId,
  }) => {
    const openai = await createFakeOpenAi();
    await routeFakeOpenAi(context, openai);
    await routeFakeYouTube(context);
    await signIn(context, extensionId);

    const page = await context.newPage();
    await openCue(page);
    await word(page, 'เรื่อง').click();
    const popup = overlay(page).getByTestId('phasa-popup');
    const section = popup.getByTestId('phasa-ai-section');
    await expect(section.getByTestId('phasa-ai-usage')).toHaveText(
      'Using ChatGPT plan · Manage usage',
    );
    await expect(section.getByTestId('phasa-ai-manage-usage')).toHaveAttribute(
      'href',
      'https://chatgpt.com/settings/usage',
    );
    await popup.getByRole('button', { name: /Explain in context/ }).click();
    const explanation = popup.getByTestId('phasa-ai-explanation');
    await expect(explanation).toContainText('the topic');
    await expect(explanation).toContainText('เรื่องนี้สนุกมาก');
    await expect(popup.getByTestId('phasa-ai-source')).toHaveText('gpt-fake-sol');
    const body = JSON.parse(responsesRequests(openai)[0]!.body) as {
      input: { content: string }[];
    };
    expect(body.input[0]!.content).toContain('Word or phrase: เรื่อง');

    // The line translation too.
    await popup.getByRole('button', { name: /Translate the line/ }).click();
    await expect(popup.getByTestId('phasa-ai-translation')).toContainText(
      'What do foreigners think of Thai?',
    );

    // Reopened: the saved answers show at once, without asking OpenAI again.
    await page.keyboard.press('Escape');
    await word(page, 'เรื่อง').click();
    await expect(popup.getByTestId('phasa-ai-explanation')).toContainText('the topic');
    await expect(popup.getByTestId('phasa-ai-source').first()).toHaveText(
      'gpt-fake-sol · saved answer',
    );
    expect(responsesRequests(openai)).toHaveLength(2);
  });

  test('translates a transcript line in the side panel', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const openai = await createFakeOpenAi();
    await routeFakeOpenAi(context, openai);
    await routeFakeYouTube(context);
    await signIn(context, extensionId);
    const page = await context.newPage();
    await openCue(page);
    const panel = await context.newPage();
    await panel.goto(
      `chrome-extension://${extensionId}/sidepanel.html?tab=${await youTubeTabId(serviceWorker)}`,
    );
    const row = panel.locator('.transcript__row[data-index="1"]');
    await row.hover();
    await row.getByTestId('phasa-transcript-ai').click();
    await row.getByRole('button', { name: /Translate the line/ }).click();
    await expect(row.getByTestId('phasa-ai-translation')).toContainText('Westerner');
  });

  test('says when the plan limit is reached, with "Manage usage" first', async ({
    context,
    extensionId,
  }) => {
    const openai = await createFakeOpenAi();
    await routeFakeOpenAi(context, openai);
    await routeFakeYouTube(context);
    await signIn(context, extensionId);
    openai.options.mode = 'usage-limit-mid-stream';

    const page = await context.newPage();
    await openCue(page);
    await word(page, 'เรื่อง').click();
    const popup = overlay(page).getByTestId('phasa-popup');
    await popup.getByRole('button', { name: /Explain in context/ }).click();
    const error = popup.getByTestId('phasa-ai-error');
    await expect(error).toHaveAttribute('data-code', 'usage-limit');
    await expect(error).toContainText("You've reached your ChatGPT plan's usage limit");
    await expect(error.getByTestId('phasa-ai-manage-usage')).toHaveClass('phasa-ai__primary');
    await expect(error.getByTestId('phasa-ai-manage-usage')).toHaveAttribute(
      'href',
      'https://chatgpt.com/settings/usage',
    );
  });

  test('refreshes an expired access token without asking to sign in', async ({
    context,
    extensionId,
  }) => {
    const openai = await createFakeOpenAi();
    openai.options.expiresIn = 2; // expired by the time of the request
    await routeFakeOpenAi(context, openai);
    await routeFakeYouTube(context);
    await signIn(context, extensionId);

    const page = await context.newPage();
    await openCue(page);
    await word(page, 'เรื่อง').click();
    const popup = overlay(page).getByTestId('phasa-popup');
    await popup.getByRole('button', { name: /Explain in context/ }).click();
    await expect(popup.getByTestId('phasa-ai-explanation')).toContainText('the topic');
    expect(openai.log.some((request) => request.body.includes('grant_type=refresh_token'))).toBe(
      true,
    );
  });

  test('without AI set up, the popup works and points to the settings', async ({
    context,
    extensionId,
  }) => {
    const openai = await createFakeOpenAi();
    await routeFakeOpenAi(context, openai);
    await routeFakeYouTube(context);
    const page = await context.newPage();
    await openCue(page);
    await word(page, 'เรื่อง').click();
    const popup = overlay(page).getByTestId('phasa-popup');
    await expect(popup.locator('.phasa-popup__senses')).toContainText('story');
    await expect(popup.getByTestId('phasa-ai-usage')).toHaveCount(0);
    await popup.getByRole('button', { name: /Explain in context/ }).click();
    const error = popup.getByTestId('phasa-ai-error');
    await expect(error).toHaveAttribute('data-code', 'not-configured');
    const opened = context.waitForEvent('page');
    await error.getByRole('button', { name: 'AI settings' }).click();
    const settings = await opened;
    await expect(settings).toHaveURL(`chrome-extension://${extensionId}/options.html#ai`);
    await expect(settings.getByTestId('phasa-options-account')).toBeInViewport();
    // Nothing went to OpenAI.
    expect(openai.log.filter((request) => request.url.includes('api.openai.com'))).toHaveLength(0);
  });
});
