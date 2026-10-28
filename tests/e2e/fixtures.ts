import { resolve } from 'node:path';
import {
  test as base,
  chromium,
  type BrowserContext,
  type Page,
  type Worker,
} from '@playwright/test';

const EXTENSION_PATH = resolve(import.meta.dirname, '../../.output/chrome-mv3');

/** Minimal stand-in for a watch page: just the element the overlay anchors to. */
export const FAKE_WATCH_PAGE = `<!doctype html>
<html><head><title>Fake watch page</title></head>
<body>
  <div id="movie_player" style="position:relative;width:640px;height:360px;background:#000"></div>
</body></html>`;

interface Fixtures {
  context: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
}

export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern -- Playwright requires object destructuring here
  context: async ({}, use) => {
    // Bundled Chromium (channel "chromium") supports extensions, also headless.
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
    });
    await use(context);
    await context.close();
  },
  serviceWorker: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use(worker);
  },
  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host);
  },
});

export const expect = test.expect;

interface PlayerResponse {
  playabilityStatus?: { status?: string; reason?: string };
}

/**
 * Fails fast, with YouTube's reason, when a real watch page won't play its video. YouTube shows
 * datacenter IPs such as GitHub's runners a "Sign in to confirm you're not a bot" wall instead of
 * the video, and the overlay then just stays idle (docs/decisions/0009-network-e2e-runs-locally.md).
 */
export async function expectPlayable(page: Page): Promise<void> {
  const handle = await page
    .waitForFunction(
      () => {
        const player = document.getElementById('movie_player') as {
          getPlayerResponse?: () => PlayerResponse | undefined;
        } | null;
        const response =
          player?.getPlayerResponse?.() ??
          (window as Window & { ytInitialPlayerResponse?: PlayerResponse }).ytInitialPlayerResponse;
        const playability = response?.playabilityStatus;
        return playability?.status
          ? { status: playability.status, reason: playability.reason ?? '' }
          : null;
      },
      undefined,
      { polling: 100, timeout: 20_000 },
    )
    .catch(() => {
      throw new Error('YouTube reported no playability status within 20 s');
    });
  const playability = await handle.jsonValue();
  expect(
    playability?.status,
    `YouTube won't play the video from here: ${playability?.reason ?? ''}`,
  ).toBe('OK');
}

interface ChromeTabs {
  chrome: { tabs: { query(query: { url: string }): Promise<{ id?: number }[]> } };
}

/** Id of the (first) youtube.com tab, for pinning the side panel to it (`sidepanel.html?tab=`). */
export async function youTubeTabId(serviceWorker: Worker): Promise<number> {
  const id = await serviceWorker.evaluate(async () => {
    const [tab] = await (globalThis as unknown as ChromeTabs).chrome.tabs.query({
      url: '*://www.youtube.com/*',
    });
    return tab?.id;
  });
  if (id === undefined) throw new Error('No youtube.com tab');
  return id;
}
