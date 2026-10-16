import { browser } from 'wxt/browser';

type PublicPath = Parameters<typeof browser.runtime.getURL>[0];

/** Absolute URL of a file in the extension package (`fonts/x.woff2` → `chrome-extension://…/fonts/x.woff2`). */
export function extensionUrl(path: string): string {
  return browser.runtime.getURL(`/${path}` as PublicPath);
}
