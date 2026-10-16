import { browser } from 'wxt/browser';
import type messages from '../../public/_locales/en/messages.json';

export type MessageKey = keyof typeof messages;

// WXT types getMessage with one overload per key, which a union key can't call.
const getMessage = browser.i18n.getMessage.bind(browser.i18n) as (
  key: string,
  substitutions?: string | string[],
) => string;

/** Lookup into public/_locales/en/messages.json; keys are checked at compile time. */
export function t(key: MessageKey, substitutions?: string | string[]): string {
  return getMessage(key, substitutions);
}
