/**
 * Where OpenAI credentials live: the `credentials` table of the extension's IndexedDB. Only the
 * service worker reads it. Not chrome.storage.local: content scripts can read that area, and
 * a youtube.com renderer process runs our content script (docs/decisions/0014-ai-and-account.md).
 */
import type { PhasaDb } from '../db/db';
import type { TokenSet } from './oauth';

export interface ChatGptAccount {
  /** The validated ID token's subject: the account identity. */
  sub: string;
  email?: string;
  name?: string;
}

/** One ChatGPT registration on this browser (v1 keeps one; OpenAI allows several). */
export interface ChatGptRecord {
  /** `ext_agent_host_id`, stable for this installation. */
  hostId: string;
  /** The issued `oaiapp_…` client id; saved before the first code exchange. */
  clientId?: string;
  account?: ChatGptAccount;
  tokens?: TokenSet;
  /**
   * The last ID token, kept as `id_token_hint` after a terminal refresh error dropped the
   * tokens; not after a sign-out (the docs clear the ID token then).
   */
  hintIdToken?: string;
  /** A refresh failed for good: the tokens are gone and the user must sign in again. */
  needsSignIn?: boolean;
}

export interface CredentialStore {
  chatGpt(): Promise<ChatGptRecord | undefined>;
  /** Read-modify-write in one transaction; `undefined` deletes the record. */
  updateChatGpt(
    change: (current: ChatGptRecord | undefined) => ChatGptRecord | undefined,
  ): Promise<ChatGptRecord | undefined>;
  apiKey(): Promise<string | undefined>;
  setApiKey(key: string | null): Promise<void>;
}

const CHATGPT = 'chatgpt';
const API_KEY = 'openai-api-key';

export function dbCredentialStore(db: () => PhasaDb): CredentialStore {
  return {
    async chatGpt() {
      return (await db().credentials.get(CHATGPT))?.value as ChatGptRecord | undefined;
    },
    async updateChatGpt(change) {
      const database = db();
      return database.transaction('rw', database.credentials, async () => {
        const current = (await database.credentials.get(CHATGPT))?.value as
          ChatGptRecord | undefined;
        const next = change(current);
        if (next) await database.credentials.put({ key: CHATGPT, value: next });
        else await database.credentials.delete(CHATGPT);
        return next;
      });
    },
    async apiKey() {
      const value = (await db().credentials.get(API_KEY))?.value;
      return typeof value === 'string' ? value : undefined;
    },
    async setApiKey(key) {
      if (key === null) await db().credentials.delete(API_KEY);
      else await db().credentials.put({ key: API_KEY, value: key });
    },
  };
}

/** `sk-…a1b2`: enough to recognize the key, never enough to use it. */
export function keyHint(key: string): string {
  const prefix = key.startsWith('sk-') ? (/^sk-[a-z]+-/.exec(key)?.[0] ?? 'sk-') : '';
  return `${prefix}…${key.slice(-4)}`;
}
