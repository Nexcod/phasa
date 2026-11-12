import { EXPLAIN_WORD } from './explain-word';
import { TRANSLATE_CUE } from './translate-cue';
import type { Prompt } from './types';

/** Every AI function by its `name`, the `fn` of cached answers (src/ai/cache.ts). */
export const PROMPTS: Readonly<Record<string, Prompt<never, unknown>>> = {
  [EXPLAIN_WORD.name]: EXPLAIN_WORD,
  [TRANSLATE_CUE.name]: TRANSLATE_CUE,
};
