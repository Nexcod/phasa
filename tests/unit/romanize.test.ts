import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fromRules, pronounce } from '@/src/dictionary/pronunciation';
import type { DictEntry, DictFile } from '@/src/dictionary/types';
import { romanizeByRules } from '@/src/thai/romanize';
import { paiboonTone, splitRomanSyllables } from '@/src/thai/tones';

const roman = (word: string) =>
  romanizeByRules(word)
    ?.map((syllable) => syllable.paiboon)
    .join('-');

describe('romanizeByRules', () => {
  it('reads common syllable shapes with their tones', () => {
    expect(roman('กิน')).toBe('gin'); // mid class, live
    expect(roman('ข้าว')).toBe('kâao'); // high class + mai tho
    expect(roman('น้ำ')).toBe('nám'); // low class + mai tho, short am
    expect(roman('คน')).toBe('kon'); // implicit o
    expect(roman('สบาย')).toBe('sà-baai'); // implicit a
    expect(roman('เรียน')).toBe('riian');
    expect(roman('เมือง')).toBe('mʉʉang');
    expect(roman('ตัว')).toBe('dtuua');
    expect(roman('ไทย')).toBe('tai');
    expect(roman('เด็ก')).toBe('dèk');
    expect(roman('รถ')).toBe('rót'); // low class, dead short → high
    expect(roman('มาก')).toBe('mâak'); // low class, dead long → falling
  });

  it('handles clusters, leading ห, silent letters and อักษรนำ', () => {
    expect(roman('กลอง')).toBe('glɔɔng');
    expect(roman('หมา')).toBe('mǎa');
    expect(roman('การ์ด')).toBe('gàat');
    expect(roman('ตลาด')).toBe('dtà-làat');
    expect(roman('กุหลาบ')).toBe('gù-làap');
  });

  it('gives RTGS without tones', () => {
    expect(romanizeByRules('ข้าว')?.map((syllable) => syllable.rtgs)).toEqual(['khao']);
  });

  it('gives up on text that is not a Thai word', () => {
    expect(romanizeByRules('abc')).toBeNull();
    expect(romanizeByRules('่')).toBeNull();
  });

  it('matches the dictionary on most frequent words (regression floor)', () => {
    const dict = JSON.parse(
      readFileSync(join(import.meta.dirname, '../../data/build/dict.json'), 'utf8'),
    ) as DictFile;
    const sample = dict.entries.filter(
      (entry) =>
        entry.romanization?.paiboon && entry.freqRank !== undefined && entry.freqRank <= 5000,
    );
    let exact = 0;
    let tones = 0;
    for (const entry of sample) {
      const gold = splitRomanSyllables(entry.romanization?.paiboon ?? '');
      const got = romanizeByRules(entry.thai) ?? [];
      if (got.map((s) => s.paiboon).join('-') === gold.join('-')) exact++;
      if (got.length === gold.length && got.every((s, i) => s.tone === paiboonTone(gold[i] ?? '')))
        tones++;
    }
    // 2026-11-01: 78.0% exact, 86.5% tones on 4082 words. Rules only serve words the dictionary lacks.
    expect(exact / sample.length).toBeGreaterThan(0.75);
    expect(tones / sample.length).toBeGreaterThan(0.84);
  });
});

describe('pronounce', () => {
  const entry = (thai: string, paiboon: string): DictEntry => ({
    thai,
    senses: [{ glosses: [thai] }],
    source: ['wiktionary'],
    romanization: { paiboon, rtgs: paiboon },
    syllables: paiboon.split('-').map((r) => ({ roman: r, tone: paiboonTone(r) })),
  });
  const entries = new Map([
    ['ภาษา', entry('ภาษา', 'paa-sǎa')],
    ['ไทย', entry('ไทย', 'tai')],
  ]);

  it('prefers the dictionary, then the parts of a compound, then rules', () => {
    expect(pronounce('ภาษา', entries, null)).toMatchObject({
      source: 'dictionary',
      paiboon: 'paa-sǎa',
    });
    expect(pronounce('ภาษาไทย', entries, ['ภาษา', 'ไทย'])).toMatchObject({
      source: 'compound',
      paiboon: 'paa-sǎa tai',
      rtgs: 'paa-sǎa tai',
    });
    expect(pronounce('กิน', entries, null)).toMatchObject({ source: 'rules', paiboon: 'gin' });
  });

  it('marks a compound with a part from rules as approximate', () => {
    expect(pronounce('ภาษากิน', entries, ['ภาษา', 'กิน'])?.source).toBe('rules');
  });

  it('keeps the written syllables for rules', () => {
    expect(fromRules('สบาย')?.syllables.map((syllable) => syllable.text)).toEqual(['ส', 'บาย']);
  });
});
