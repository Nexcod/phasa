/** `explainWord` (docs/plan.md §8.6): a word or phrase in its subtitle line. */
import type { ExplainWordParams, WordExplanation } from '../../messaging/ai';
import type { Tone } from '../../thai/types';
import type { JsonSchema } from '../schema';
import {
  clean,
  contextBlock,
  contextKey,
  isArrayOf,
  isRecord,
  isString,
  isStringOrNull,
  str,
  type Prompt,
} from './types';

const TONES: readonly Tone[] = ['mid', 'low', 'falling', 'high', 'rising'];
const nullableString = { type: ['string', 'null'] } as const;

const SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'meaning_in_context',
    'part_of_speech',
    'romanization_paiboon',
    'syllables',
    'register',
    'notes',
    'example_th',
    'example_en',
    'classifier',
  ],
  properties: {
    meaning_in_context: { type: 'string' },
    part_of_speech: nullableString,
    romanization_paiboon: { type: 'string' },
    syllables: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['thai', 'tone'],
        properties: {
          thai: { type: 'string' },
          tone: { type: 'string', enum: TONES },
        },
      },
    },
    register: { type: 'string' },
    notes: nullableString,
    example_th: { type: 'string' },
    example_en: { type: 'string' },
    classifier: nullableString,
  },
};

const INSTRUCTIONS = `You help English speakers learn Thai from videos with Thai subtitles.
You get a Thai word or phrase and the subtitle line it appears in, with the lines around it.
Explain what it means in this line, not in general. Answer in English; Thai only where asked.

- meaning_in_context: what it means here, at most 30 words.
- part_of_speech: noun, verb, adjective, adverb, particle, classifier, pronoun, conjunction, preposition, interjection, phrase … or null.
- romanization_paiboon: Paiboon+ romanization with tone marks and long vowels doubled, syllables joined by "-" (e.g. sà-wàt-dii).
- syllables: each spoken syllable in Thai script as it is pronounced, with its tone (mid, low, falling, high, rising).
- register: register and politeness in a few words (e.g. "informal, between friends", "polite, said by a woman").
- notes: what a learner should notice here (particles, set phrases, grammar, word play), at most 40 words, or null.
- example_th: a new short everyday Thai sentence using it in the same sense; example_en: its translation.
- classifier: the classifier used with this noun, in Thai script, or null.

Subtitles may be auto-generated and contain recognition errors. If the word looks like an error or a fragment of a longer word, say so in notes and explain the likely intended word.`;

function tone(value: unknown): Tone | undefined {
  return TONES.includes(value as Tone) ? (value as Tone) : undefined;
}

function syllables(value: unknown): WordExplanation['syllables'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const thai = str(item.thai);
    const itemTone = tone(item.tone);
    return thai && itemTone ? [{ thai, tone: itemTone }] : [];
  });
}

export const EXPLAIN_WORD: Prompt<ExplainWordParams, WordExplanation> = {
  name: 'explainWord',
  version: 1,
  instructions: INSTRUCTIONS,
  schemaName: 'thai_word_in_context',
  schema: SCHEMA,
  cacheInput: (params) => ({ word: params.word, ...(contextKey(params) as object) }),
  input: (params) => `${contextBlock(params)}\nWord or phrase: ${clean(params.word, 200)}`,
  fromJson(json) {
    const value = json as Record<string, unknown>;
    return {
      meaning: str(value.meaning_in_context) ?? '',
      partOfSpeech: str(value.part_of_speech) ?? null,
      romanization: str(value.romanization_paiboon) ?? '',
      syllables: syllables(value.syllables),
      register: str(value.register) ?? '',
      notes: str(value.notes) ?? null,
      exampleTh: str(value.example_th) ?? '',
      exampleEn: str(value.example_en) ?? '',
      classifier: str(value.classifier) ?? null,
    };
  },
  isValue(value): value is WordExplanation {
    if (!isRecord(value)) return false;
    return (
      ['meaning', 'romanization', 'register', 'exampleTh', 'exampleEn'].every((key) =>
        isString(value[key]),
      ) &&
      ['partOfSpeech', 'notes', 'classifier'].every((key) => isStringOrNull(value[key])) &&
      isArrayOf(
        value.syllables,
        (item): item is WordExplanation['syllables'][number] =>
          isRecord(item) && isString(item.thai) && tone(item.tone) !== undefined,
      )
    );
  },
  partial(json) {
    if (!isRecord(json)) return {};
    const out: Partial<WordExplanation> = {};
    const set = <K extends keyof WordExplanation>(
      key: K,
      value: WordExplanation[K] | undefined,
    ) => {
      if (value !== undefined && value !== '') out[key] = value;
    };
    set('meaning', str(json.meaning_in_context));
    set('partOfSpeech', str(json.part_of_speech));
    set('romanization', str(json.romanization_paiboon));
    set('register', str(json.register));
    set('notes', str(json.notes));
    set('exampleTh', str(json.example_th));
    set('exampleEn', str(json.example_en));
    set('classifier', str(json.classifier));
    // Syllables only once the list is closed: a half-written one would flicker.
    if (Array.isArray(json.syllables) && typeof json.register === 'string') {
      out.syllables = syllables(json.syllables);
    }
    return out;
  },
};
