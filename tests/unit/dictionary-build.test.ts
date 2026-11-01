import { describe, expect, it } from 'vitest';
import {
  entryFromKaikki,
  headwordKey,
  mergeEntries,
  syllablesOf,
  type KaikkiEntry,
} from '@/src/dictionary/kaikki';
import { conventionalParts, type ConventionLexicon } from '@/src/thai/convention';
import { paiboonTone, splitRomanSyllables, withPaiboonTone } from '@/src/thai/tones';

const PHASA: KaikkiEntry = {
  word: 'ภาษา',
  lang_code: 'th',
  pos: 'noun',
  forms: [
    { form: 'paa-sǎa', tags: ['romanization'] },
    { form: 'ภาษา', tags: ['classifier'] },
  ],
  sounds: [
    { raw_tags: ['Orthographic'], other: 'ภาษา', roman: 'bʰ ā ʂ ā' },
    { raw_tags: ['Phonemic'], other: 'พา-สา', roman: 'b ā – s ā' },
    { tags: ['romanization'], raw_tags: ['Paiboon'], roman: 'paa-sǎa' },
    { tags: ['romanization'], raw_tags: ['Royal Institute'], roman: 'pha-sa' },
    { ipa: '/pʰaː˧.saː˩˩˦/' },
  ],
  senses: [
    { glosses: ['language (form of communication using words: spoken, gestured, or written)'] },
    { glosses: ['minority language speakers'], tags: ['archaic'] },
  ],
};

describe('entryFromKaikki', () => {
  it('keeps glosses, romanizations, syllables with tones and the classifier', () => {
    expect(entryFromKaikki(PHASA)).toEqual({
      thai: 'ภาษา',
      senses: [
        {
          pos: 'noun',
          glosses: ['language (form of communication using words: spoken, gestured, or written)'],
          classifier: 'ภาษา',
        },
        {
          pos: 'noun',
          glosses: ['minority language speakers'],
          classifier: 'ภาษา',
          tags: ['archaic'],
        },
      ],
      source: ['wiktionary'],
      romanization: { paiboon: 'paa-sǎa', rtgs: 'pha-sa', ipa: '/pʰaː˧.saː˩˩˦/' },
      syllables: [
        { roman: 'paa', tone: 'mid', text: 'พา' },
        { roman: 'sǎa', tone: 'rising', text: 'สา' },
      ],
    });
  });

  it('skips bound forms when picking the pronunciation', () => {
    const entry = entryFromKaikki({
      word: 'น้ำ',
      pos: 'noun',
      sounds: [
        { raw_tags: ['bound form', 'Paiboon'], roman: 'nám-' },
        { raw_tags: ['Paiboon'], roman: 'náam' },
        { ipa: '/nam˦˥./' },
        { ipa: '/naːm˦˥/' },
      ],
      senses: [{ glosses: ['water'] }],
    });
    expect(entry?.romanization).toEqual({ paiboon: 'náam', ipa: '/naːm˦˥/' });
  });

  it('uses the specific gloss of a nested sense and records alt-of targets', () => {
    const entry = entryFromKaikki({
      word: 'มั้ย',
      pos: 'particle',
      senses: [
        { glosses: ['alternative form of ไหม (mǎi)'], tags: ['alt-of'], alt_of: [{ word: 'ไหม' }] },
        { glosses: ['to consume:', 'to eat'] },
      ],
    });
    expect(entry?.senses).toEqual([
      { pos: 'particle', glosses: ['alternative form of ไหม (mǎi)'], altOf: 'ไหม' },
      { pos: 'particle', glosses: ['to eat'] },
    ]);
  });

  it('rejects other languages, characters, phrases with spaces and empty senses', () => {
    expect(entryFromKaikki({ ...PHASA, lang_code: 'en' })).toBeNull();
    expect(entryFromKaikki({ ...PHASA, pos: 'character' })).toBeNull();
    expect(entryFromKaikki({ ...PHASA, word: 'ทุก ๆ' })).toBeNull();
    expect(entryFromKaikki({ ...PHASA, senses: [{ glosses: [] }] })).toBeNull();
  });

  it('marks names as proper nouns', () => {
    expect(entryFromKaikki({ ...PHASA, pos: 'name' })?.isProperNoun).toBe(true);
  });
});

describe('mergeEntries', () => {
  it('appends senses and is a proper noun only if every entry is one', () => {
    const noun = entryFromKaikki(PHASA)!;
    const name = entryFromKaikki({ ...PHASA, pos: 'name' })!;
    const merged = mergeEntries(name, noun);
    expect(merged.senses).toHaveLength(4);
    expect(merged.isProperNoun).toBeUndefined();
    expect(mergeEntries(name, name).isProperNoun).toBe(true);
  });
});

describe('headwordKey', () => {
  it('normalizes and accepts only single Thai words', () => {
    expect(headwordKey('\u0E01\u0E48\u0E35')).toBe('กี่');
    expect(headwordKey('ก.')).toBeNull();
    expect(headwordKey('จริงๆ')).toBeNull();
    expect(headwordKey('abc')).toBeNull();
  });
});

describe('syllablesOf', () => {
  it('drops the Thai respelling when it does not align', () => {
    expect(syllablesOf('tam-hâi', 'ทำ')).toEqual([
      { roman: 'tam', tone: 'mid' },
      { roman: 'hâi', tone: 'falling' },
    ]);
  });
});

describe('tones', () => {
  it('reads Paiboon diacritics, precomposed or combining', () => {
    expect(paiboonTone('kráp')).toBe('high');
    expect(paiboonTone('mâi')).toBe('falling');
    expect(paiboonTone('sǎa')).toBe('rising');
    expect(paiboonTone('gòk')).toBe('low');
    expect(paiboonTone('rɔ\u0302ɔn')).toBe('falling');
    expect(paiboonTone('paa')).toBe('mid');
  });

  it('splits syllables on hyphens and spaces', () => {
    expect(splitRomanSyllables('paa-sǎa tai')).toEqual(['paa', 'sǎa', 'tai']);
  });

  it('puts a tone on the first vowel', () => {
    expect(withPaiboonTone('saa', 'rising')).toBe('sǎa');
    expect(withPaiboonTone('rɔɔn', 'falling')).toBe('rɔ\u0302ɔn');
    expect(withPaiboonTone('bpai', 'mid')).toBe('bpai');
  });
});

function lexicon(
  entries: Record<string, { pos?: string[]; tags?: string[]; paiboon?: string }>,
): ConventionLexicon {
  return {
    has: (word) => Object.hasOwn(entries, word),
    partsOfSpeech: (word) => entries[word]?.pos ?? [],
    tags: (word) => entries[word]?.tags ?? [],
    paiboon: (word) => entries[word]?.paiboon,
  };
}

describe('conventionalParts', () => {
  const words = lexicon({
    ไม่: { pos: ['adv'], paiboon: 'mâi' },
    มี: { pos: ['verb'], paiboon: 'mii' },
    ไม่มี: { pos: ['verb'], paiboon: 'mâi-mii' },
    ว่า: { pos: ['verb'], paiboon: 'wâa' },
    ไม่ว่า: { pos: ['conj'], paiboon: 'mâi-wâa' },
    เบา: { pos: ['adj'], paiboon: 'bao' },
    ไม่เบา: { pos: ['adv'], tags: ['idiomatic'], paiboon: 'mâi-bao' },
    มา: { pos: ['verb'], paiboon: 'maa' },
    ตรา: { pos: ['noun'], paiboon: 'dtraa' },
    มาตรา: { pos: ['noun'], paiboon: 'mâat-dtraa' },
    วัน: { pos: ['noun'], paiboon: 'wan' },
    นี้: { pos: ['det'], paiboon: 'níi' },
    วันนี้: { pos: ['noun'], paiboon: 'wan-níi' },
    อัน: { pos: ['classifier'], paiboon: 'an' },
    อันนี้: { pos: ['pron'], paiboon: 'an-níi' },
    ดัง: { pos: ['adj'], paiboon: 'dang' },
    นั้น: { pos: ['det'], paiboon: 'nán' },
    ดังนั้น: { pos: ['adv'], paiboon: 'dang-nán' },
    ได้: { pos: ['verb'], paiboon: 'dâai' },
    แล้ว: { pos: ['adv'], paiboon: 'lɛ\u0301ɛo' },
    ได้แล้ว: { pos: ['adv'], paiboon: 'dâai-lɛ\u0301ɛo' },
    ไม่ได้แล้ว: { pos: ['adv'], paiboon: 'mâi-dâai-lɛ\u0301ɛo' },
    คิด: { pos: ['verb'], paiboon: 'kít' },
    คิดว่า: { pos: ['verb'], paiboon: 'kít-wâa' },
    แต่: { pos: ['conj'], paiboon: 'dtɛ\u0300ɛ' },
    แต่ว่า: { pos: ['conj'], paiboon: 'dtɛ\u0300ɛ-wâa' },
  });

  it('splits negation, demonstratives after classifiers and aspect, recursively', () => {
    expect(conventionalParts('ไม่มี', words)).toEqual(['ไม่', 'มี']);
    expect(conventionalParts('อันนี้', words)).toEqual(['อัน', 'นี้']);
    expect(conventionalParts('ไม่ได้แล้ว', words)).toEqual(['ไม่', 'ได้', 'แล้ว']);
    expect(conventionalParts('คิดว่า', words)).toEqual(['คิด', 'ว่า']);
  });

  it('keeps conjunctions, idioms, time words and lexicalized adverbs whole', () => {
    expect(conventionalParts('ไม่ว่า', words)).toBeNull();
    expect(conventionalParts('ไม่เบา', words)).toBeNull();
    expect(conventionalParts('วันนี้', words)).toBeNull();
    expect(conventionalParts('ดังนั้น', words)).toBeNull();
    expect(conventionalParts('แต่ว่า', words)).toBeNull();
  });

  it('never splits inside a syllable', () => {
    expect(conventionalParts('มาตรา', words)).toBeNull();
  });
});
