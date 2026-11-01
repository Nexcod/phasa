/**
 * Thai language services of the service worker: tokenizing caption text with
 * the dictionary and the user's own rules and phrases, and word lookups with
 * pronunciation (docs/plan.md §3.2 rule 5: NLP runs in the SW).
 */
import type { PhasaDb } from '../db/db';
import { createLexicon, type LexiconSnapshot } from '../dictionary/lexicon';
import { pronounce } from '../dictionary/pronunciation';
import type { DictionaryStore } from '../dictionary/store';
import type { DictEntry, WordInfo } from '../dictionary/types';
import { createTokenizer, splitIntoWords, type Tokenizer } from '../thai/tokenizer';
import type { Token } from '../thai/types';
import { listSegRules, phraseUnits } from '../vocab/store';

export interface TokenizeInput {
  text: string;
  hints?: number[];
}

export interface LanguageService {
  tokenize(inputs: readonly TokenizeInput[]): Promise<Token[][]>;
  lookup(words: readonly string[]): Promise<WordInfo[]>;
  /** User rules or phrases changed: rebuild the tokenizer on next use. */
  invalidate(): void;
}

export function createLanguageService(
  db: () => PhasaDb,
  dictionary: DictionaryStore,
): LanguageService {
  let tokenizer: Promise<Tokenizer> | null = null;
  let dictionaryWords: { snapshot: LexiconSnapshot; isWord: (word: string) => boolean } | null =
    null;

  async function buildTokenizer(): Promise<Tokenizer> {
    const snapshot = await dictionary.lexicon();
    const database = db();
    const [rules, phrases] = await Promise.all([listSegRules(database), phraseUnits(database)]);
    const merges = [
      ...phrases,
      ...rules.filter((rule) => rule.kind === 'merge').map((rule) => rule.parts.join('')),
    ];
    const splits = rules
      .filter((rule) => rule.kind === 'split')
      .map((rule) => [rule.parts.join(''), rule.parts] as const);
    return createTokenizer(createLexicon(snapshot, { merges, splits }));
  }

  async function plainLexicon() {
    const snapshot = await dictionary.lexicon();
    if (dictionaryWords?.snapshot !== snapshot) {
      const lexicon = createLexicon(snapshot);
      dictionaryWords = { snapshot, isWord: (word) => lexicon.isWord(word) };
    }
    return dictionaryWords;
  }

  return {
    async tokenize(inputs) {
      tokenizer ??= buildTokenizer().catch((error: unknown) => {
        tokenizer = null;
        throw error;
      });
      const current = await tokenizer;
      return inputs.map((input) => {
        const options = input.hints ? { hints: input.hints } : {};
        return current.tokenize(input.text, options);
      });
    },

    async lookup(words) {
      const { snapshot, isWord } = await plainLexicon();
      const known = new Set(snapshot.words);
      const splits = new Map<string, string[] | null>();
      for (const word of words) {
        if (!known.has(word) && !word.includes(' ')) splits.set(word, splitIntoWords(word, isWord));
      }
      const first = await dictionary.entries([
        ...words,
        ...[...splits.values()].flatMap((parts) => parts ?? []),
      ]);
      const mains = await dictionary.entries(
        [...first.values()].flatMap((entry) => entry.senses.flatMap((sense) => sense.altOf ?? [])),
      );
      const entries = new Map<string, DictEntry>([...mains, ...first]);
      return words.map((word) => {
        const info: WordInfo = { thai: word };
        const entry = entries.get(word);
        if (entry) info.entry = entry;
        const altOf = entry?.senses.find((sense) => sense.altOf)?.altOf;
        const main = altOf ? entries.get(altOf) : undefined;
        if (main) info.main = main;
        const parts = splits.get(word) ?? null;
        if (parts) {
          info.parts = parts.map((part) => {
            const partEntry = entries.get(part);
            return partEntry ? { thai: part, entry: partEntry } : { thai: part };
          });
        }
        const pronunciation = word.includes(' ') ? undefined : pronounce(word, entries, parts);
        if (pronunciation) info.pronunciation = pronunciation;
        return info;
      });
    },

    invalidate() {
      tokenizer = null;
    },
  };
}
