/**
 * User preferences. Stored one row per key in the Dexie `settings` table
 * (docs/plan.md §9) by the service worker; other contexts read and change them
 * through src/messaging and hear about changes via `settings/changed`.
 */

/** How word boundaries show in Thai subtitles (docs/plan.md §2.1). */
export type WordBoundaries = 'none' | 'gaps' | 'underline';
export type RomanizationSystem = 'paiboon' | 'rtgs';
export type RomanizationPosition = 'above' | 'below';
/** Where AI requests go first (docs/plan.md §8.5). */
export type AiProviderSetting = 'chatgpt-plan' | 'openai-api-key';

export interface Settings {
  /** Second subtitle line with the English translation (hotkey T). */
  showTranslation: boolean;
  /** Pause at the end of every cue (docs/plan.md §2.1). */
  autoPause: boolean;
  /** Romanization over or under each Thai word (hotkey R). */
  showRomanization: boolean;
  romanizationPosition: RomanizationPosition;
  romanizationSystem: RomanizationSystem;
  wordBoundaries: WordBoundaries;
  /** Opening a word pauses the video; closing resumes it (docs/plan.md §10). */
  pauseOnLookup: boolean;
  aiProvider: AiProviderSetting;
  /** Model slug for the ChatGPT plan; empty = the default from OpenAI's list (ADR 0015). */
  aiModelChatGpt: string;
  /** Model id for the API key; empty = not chosen yet (the user pays, so no silent default). */
  aiModelApiKey: string;
  /** Use the API key when the ChatGPT plan can't serve a request (plan §8.4: only if enabled). */
  aiFallbackToApiKey: boolean;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  showTranslation: true,
  autoPause: false,
  showRomanization: false,
  romanizationPosition: 'above',
  romanizationSystem: 'paiboon',
  wordBoundaries: 'gaps',
  pauseOnLookup: true,
  aiProvider: 'chatgpt-plan',
  aiModelChatGpt: '',
  aiModelApiKey: '',
  aiFallbackToApiKey: false,
};

/** Keys whose change can make AI ready or not (`ai/changed`). */
export const AI_SETTING_KEYS: readonly (keyof Settings)[] = [
  'aiProvider',
  'aiModelChatGpt',
  'aiModelApiKey',
  'aiFallbackToApiKey',
];

type Validators = { [K in keyof Settings]: (value: unknown) => value is Settings[K] };

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
const oneOf =
  <T extends string>(...values: T[]) =>
  (value: unknown): value is T =>
    values.includes(value as T);
/** A model slug as OpenAI writes them (`gpt-6.1-sol`, `ft:…:org:…`), or empty. */
const isModelSlug = (value: unknown): value is string =>
  typeof value === 'string' && /^[\w.:/-]{0,100}$/.test(value);

const VALIDATORS: Validators = {
  showTranslation: isBoolean,
  autoPause: isBoolean,
  showRomanization: isBoolean,
  romanizationPosition: oneOf('above', 'below'),
  romanizationSystem: oneOf('paiboon', 'rtgs'),
  wordBoundaries: oneOf('none', 'gaps', 'underline'),
  pauseOnLookup: isBoolean,
  aiProvider: oneOf('chatgpt-plan', 'openai-api-key'),
  aiModelChatGpt: isModelSlug,
  aiModelApiKey: isModelSlug,
  aiFallbackToApiKey: isBoolean,
};

function isKey(key: string): key is keyof Settings {
  return Object.hasOwn(VALIDATORS, key);
}

/** A validated partial update, or null if any field is unknown or has the wrong type. */
export function parseSettingsPatch(value: unknown): Partial<Settings> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const patch: Partial<Record<keyof Settings, unknown>> = {};
  for (const [key, field] of Object.entries(value)) {
    if (!isKey(key) || !VALIDATORS[key](field)) return null;
    patch[key] = field;
  }
  return patch as Partial<Settings>;
}

/** Stored rows over the defaults; unknown or invalid rows are ignored. */
export function settingsFromRows(rows: readonly { key: string; value: unknown }[]): Settings {
  const settings: Settings = { ...DEFAULT_SETTINGS };
  for (const { key, value } of rows) {
    if (isKey(key) && VALIDATORS[key](value))
      (settings as Record<keyof Settings, unknown>)[key] = value;
  }
  return settings;
}
