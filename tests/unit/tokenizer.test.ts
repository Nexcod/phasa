import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createLexicon, snapshotFromEntries, type LexiconSnapshot } from '@/src/dictionary/lexicon';
import type { DictFile } from '@/src/dictionary/types';
import { evaluate, isRealCue, parseGoldTsv } from '@/src/thai/gold';
import { boundariesInsideGraphemes } from '@/src/thai/segmentation-eval';
import { createTokenizer, tokenBoundaries, tokenKind } from '@/src/thai/tokenizer';

const ROOT = join(import.meta.dirname, '../..');
const dict = JSON.parse(readFileSync(join(ROOT, 'data/build/dict.json'), 'utf8')) as DictFile;
const snapshot = snapshotFromEntries(dict.entries);
const gold = parseGoldTsv(readFileSync(join(ROOT, 'tests/fixtures/segmentation.tsv'), 'utf8'));

function small(words: string[], extra: Partial<LexiconSnapshot> = {}): LexiconSnapshot {
  return { words, parts: {}, ranks: {}, ...extra };
}

const texts = (tokens: { text: string }[]) => tokens.map((token) => token.text);

describe('tokenizer vs tests/fixtures/segmentation.tsv (AGENTS.md gate)', () => {
  const tokenizer = createTokenizer(createLexicon(snapshot));
  const result = evaluate(tokenizer, gold);

  it('keeps Thai boundary F1 at or above 0.90', () => {
    expect(result.thai.f1).toBeGreaterThanOrEqual(0.9);
  });

  it('never cuts inside a grapheme cluster', () => {
    expect(result.graphemeViolations).toBe(0);
  });

  it('reports how many real cues the gold set has (phase 3 acceptance wants ≥ 200)', () => {
    const real = gold.filter(isRealCue).length;
    expect(real).toBeGreaterThan(0);
    if (real < 200)
      console.warn(`segmentation.tsv: ${real} real cues, phase 3 acceptance needs 200`);
  });
});

describe('createTokenizer', () => {
  it('returns no tokens for empty text', () => {
    expect(createTokenizer(createLexicon(small([]))).tokenize('')).toEqual([]);
  });

  it('makes ๆ its own repeat token and keeps ฯลฯ whole', () => {
    const tokenizer = createTokenizer(createLexicon(small(['จริง', 'ผลไม้'])));
    const tokens = tokenizer.tokenize('จริงๆ ผลไม้ฯลฯ');
    expect(texts(tokens)).toEqual(['จริง', 'ๆ', ' ', 'ผลไม้', 'ฯลฯ']);
    expect(tokens.map((token) => token.kind)).toEqual(['thai', 'repeat', 'space', 'thai', 'punct']);
  });

  it('gives offsets into the text', () => {
    const tokens = createTokenizer(createLexicon(small([]))).tokenize('ab ๆ');
    for (const token of tokens) expect('ab ๆ'.slice(token.start, token.end)).toBe(token.text);
  });

  it('classifies kinds', () => {
    expect(tokenKind('ภาษา')).toBe('thai');
    expect(tokenKind('YouTube')).toBe('latin');
    expect(tokenKind('๑๒๓')).toBe('number');
    expect(tokenKind('2026')).toBe('number');
    expect(tokenKind('!')).toBe('punct');
    expect(tokenKind(' ')).toBe('space');
    expect(tokenKind('ๆ')).toBe('repeat');
  });

  it('merges ICU pieces into a dictionary word', () => {
    // ICU splits the loanword; the dictionary knows it.
    const icu = [...new Intl.Segmenter('th', { granularity: 'word' }).segment('โปรโมชั่น')];
    expect(icu.length).toBeGreaterThan(1);
    const tokenizer = createTokenizer(createLexicon(small(['โปรโมชั่น'])));
    expect(texts(tokenizer.tokenize('โปรโมชั่น'))).toEqual(['โปรโมชั่น']);
  });

  it('splits compositional headwords even when ICU keeps them whole', () => {
    const tokenizer = createTokenizer(
      createLexicon(small(['ไม่', 'มี', 'ไม่มี'], { parts: { ไม่มี: ['ไม่', 'มี'] } })),
    );
    expect(texts(tokenizer.tokenize('ไม่มี'))).toEqual(['ไม่', 'มี']);
  });

  it('splits a non-word into words', () => {
    const tokenizer = createTokenizer(createLexicon(small(['นะ', 'คะ'])));
    expect(texts(tokenizer.tokenize('นะคะ'))).toEqual(['นะ', 'คะ']);
  });

  it('re-cuts stretches where ICU cut through words', () => {
    const tokenizer = createTokenizer(createLexicon(snapshot));
    expect(texts(tokenizer.tokenize('ไม่ไวแล้วกล้องมันก็ไม่ไหว'))).toEqual([
      'ไม่',
      'ไว',
      'แล้ว',
      'กล้อง',
      'มัน',
      'ก็',
      'ไม่',
      'ไหว',
    ]);
    expect(texts(tokenizer.tokenize('ตลกมากอะ'))).toEqual(['ตลก', 'มาก', 'อะ']);
  });

  it('leaves a single unknown ICU token alone when a re-cut would still leave unknowns', () => {
    const tokenizer = createTokenizer(createLexicon(snapshot));
    expect(texts(tokenizer.tokenize('เครื่องบินดีเลย์'))).toEqual(['เครื่องบิน', 'ดีเลย์']);
  });

  it('applies user merge and split rules', () => {
    const tokenizer = createTokenizer(
      createLexicon(small(['โรงเรียน', 'โรง', 'เรียน', 'สม', 'ชาย']), {
        merges: ['สมชาย'],
        splits: [['โรงเรียน', ['โรง', 'เรียน']]],
      }),
    );
    expect(texts(tokenizer.tokenize('สมชายไปโรงเรียน'))).toEqual(['สมชาย', 'ไป', 'โรง', 'เรียน']);
  });

  it('ignores a split rule that would cut a grapheme cluster', () => {
    const tokenizer = createTokenizer(
      createLexicon(small(['ที่']), { merges: [], splits: [['ที่', ['ท', 'ี่']]] }),
    );
    expect(texts(tokenizer.tokenize('ที่'))).toEqual(['ที่']);
  });

  it('never merges across a zero-width hint', () => {
    const tokenizer = createTokenizer(createLexicon(small(['โรงเรียน'])));
    expect(texts(tokenizer.tokenize('โรงเรียน', { hints: [3] }))).toEqual(['โรง', 'เรียน']);
  });

  it('keeps runs of the same punctuation together', () => {
    const tokens = createTokenizer(createLexicon(small([]))).tokenize('จริง...!!');
    expect(texts(tokens).slice(-2)).toEqual(['...', '!!']);
  });

  it('never cuts inside a grapheme cluster on gold and garbled text', () => {
    const tokenizer = createTokenizer(createLexicon(snapshot));
    const samples = [
      ...gold.map((row) => row.segmented.replaceAll('|', '')),
      'กกกกก่่่ าาา เเเ ๆๆ ฯฯ',
      'ๆจริงๆๆ',
    ];
    for (const text of samples) {
      const boundaries = tokenBoundaries(tokenizer.tokenize(text));
      expect(boundariesInsideGraphemes(text, boundaries), text).toEqual([]);
    }
  });
});
