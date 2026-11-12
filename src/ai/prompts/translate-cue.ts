/** `translateCue` (docs/plan.md §8.6): one subtitle line, naturally, literally and word by word. */
import type { CueTranslation, TranslateCueParams } from '../../messaging/ai';
import type { JsonSchema } from '../schema';
import { contextBlock, contextKey, isArrayOf, isRecord, isString, str, type Prompt } from './types';

const SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['natural_en', 'literal_en', 'word_by_word'],
  properties: {
    natural_en: { type: 'string' },
    literal_en: { type: 'string' },
    word_by_word: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['thai', 'en'],
        properties: { thai: { type: 'string' }, en: { type: 'string' } },
      },
    },
  },
};

const INSTRUCTIONS = `You help English speakers learn Thai from videos with Thai subtitles.
Translate the given subtitle line; the lines around it are context only.

- natural_en: how an English subtitle would say it, natural and idiomatic.
- literal_en: a close, word-for-word rendering in Thai word order that shows how the Thai is built.
- word_by_word: every word or fixed expression of the line in order, copied exactly from the line in Thai script, with its English meaning in this line. Particles get their function, e.g. "polite particle (male speaker)". Leave out punctuation and spaces.

Subtitles may be auto-generated and contain recognition errors: translate what was most likely said.`;

function words(value: unknown, complete: boolean): CueTranslation['words'] {
  if (!Array.isArray(value)) return [];
  const items = complete ? value : value.slice(0, -1); // the last one may still be arriving
  return items.flatMap((item) => {
    if (!isRecord(item)) return [];
    const thai = str(item.thai);
    const en = str(item.en);
    return thai && en ? [{ thai, en }] : [];
  });
}

export const TRANSLATE_CUE: Prompt<TranslateCueParams, CueTranslation> = {
  name: 'translateCue',
  version: 1,
  instructions: INSTRUCTIONS,
  schemaName: 'thai_line_translation',
  schema: SCHEMA,
  cacheInput: (params) => contextKey(params),
  input: (params) => contextBlock(params),
  fromJson(json) {
    const value = json as Record<string, unknown>;
    return {
      natural: str(value.natural_en) ?? '',
      literal: str(value.literal_en) ?? '',
      words: words(value.word_by_word, true),
    };
  },
  isValue(value): value is CueTranslation {
    return (
      isRecord(value) &&
      isString(value.natural) &&
      isString(value.literal) &&
      isArrayOf(
        value.words,
        (item): item is CueTranslation['words'][number] =>
          isRecord(item) && isString(item.thai) && isString(item.en),
      )
    );
  },
  partial(json) {
    if (!isRecord(json)) return {};
    const out: Partial<CueTranslation> = {};
    const natural = str(json.natural_en);
    const literal = str(json.literal_en);
    if (natural) out.natural = natural;
    if (literal) out.literal = literal;
    if (Array.isArray(json.word_by_word)) out.words = words(json.word_by_word, false);
    return out;
  },
};
