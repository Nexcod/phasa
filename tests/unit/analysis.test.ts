import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  analyzeProfile,
  buildProfile,
  newUnits,
  wordScore,
  type WordFacts,
} from '@/src/analysis/analyze';
import { calibrationRow, parseCalibration, CALIBRATION_COLUMNS } from '@/src/analysis/calibration';
import {
  comprehensionOf,
  estimateLevel,
  levelScore,
  MIN_TOKENS_FOR_LEVEL,
} from '@/src/analysis/levels';
import { LEVELS, type VideoFeatures } from '@/src/analysis/types';
import type { Token, TokenKind } from '@/src/thai/types';
import type { WordStatus } from '@/src/vocab/types';

/** Tokens from `[text, kind]` pairs, with offsets. */
function tokens(...parts: [string, TokenKind][]): Token[] {
  let start = 0;
  return parts.map(([text, kind]) => {
    const token = { text, kind, start, end: start + text.length };
    start += text.length;
    return token;
  });
}

const th = (text: string): [string, TokenKind] => [text, 'thai'];
const SPACE: [string, TokenKind] = [' ', 'space'];

const FACTS: Record<string, WordFacts> = {
  สวัสดี: { rank: 900, inDictionary: true, isProperNoun: false, syllables: 2, gloss: 'hello' },
  ครับ: { rank: 197, inDictionary: true, isProperNoun: false, syllables: 1 },
  ผม: { rank: 50, inDictionary: true, isProperNoun: false, syllables: 1 },
  เรียน: { rank: 400, inDictionary: true, isProperNoun: false, syllables: 1 },
  ภาษา: {
    rank: 500,
    inDictionary: true,
    isProperNoun: false,
    syllables: 2,
    romanization: 'paa-sǎa',
  },
  ไทย: { rank: 60, inDictionary: true, isProperNoun: false, syllables: 1 },
  ที่: { rank: 1, inDictionary: true, isProperNoun: false, syllables: 1 },
  เชียงใหม่: { inDictionary: true, isProperNoun: true, syllables: 2 },
  เร็ว: { rank: 4000, inDictionary: true, isProperNoun: false, syllables: 1 },
  /** A piece of a word cut at an ASR segment end: neither in the dictionary nor ranked. */
  จ: { inDictionary: false, isProperNoun: false, syllables: 1 },
};

/**
 * Four cues; every number below is worked out by hand (plan §7.5).
 *   0 [0, 2 s]   สวัสดี ครับ
 *   1 [2, 5 s]   ผม เรียน ภาษา ไทย ที่ เชียงใหม่ ครับ      (เชียงใหม่ is a name: not counted)
 *   2 [6, 8 s]   เร็ว ๆ                                   (ๆ repeats: spoken, not counted)
 *   3 [8, 9 s]   123 hello                                 (no Thai words)
 */
const CUES = [
  { startMs: 0, endMs: 2000 },
  { startMs: 2000, endMs: 5000 },
  { startMs: 6000, endMs: 8000 },
  { startMs: 8000, endMs: 9000 },
];
const TOKENS = [
  tokens(th('สวัสดี'), th('ครับ')),
  tokens(th('ผม'), th('เรียน'), th('ภาษา'), th('ไทย'), th('ที่'), th('เชียงใหม่'), th('ครับ')),
  tokens(th('เร็ว'), SPACE, ['ๆ', 'repeat']),
  tokens(['123', 'number'], SPACE, ['hello', 'latin']),
];

const facts = (word: string): WordFacts => {
  const fact = FACTS[word];
  if (!fact) throw new Error(`no facts for ${word}`);
  return fact;
};

const STATUSES: Record<string, WordStatus> = { ครับ: 'known', ผม: 'ignored', เรียน: 2 };
const TRACK = { videoId: 'iH31BMKBEdU', trackKey: 'a.th' };

describe('buildProfile', () => {
  const profile = buildProfile({ cues: CUES, tokens: TOKENS, facts });

  it('counts Thai words except names, and ๆ as part of the word before it', () => {
    expect(profile.features.tokens).toBe(9);
    expect(profile.features.unique).toBe(8);
    expect(profile.units.map((unit) => [unit.thai, unit.count, unit.firstCue])).toEqual([
      ['สวัสดี', 1, 0],
      ['ครับ', 2, 0],
      ['ผม', 1, 1],
      ['เรียน', 1, 1],
      ['ภาษา', 1, 1],
      ['ไทย', 1, 1],
      ['ที่', 1, 1],
      ['เร็ว', 1, 2],
    ]);
  });

  it('measures the frequency profile over counted tokens', () => {
    // Only เร็ว (rank 4000) is outside the top 1000 and 3000.
    expect(profile.features.outside1000).toBeCloseTo(1 / 9);
    expect(profile.features.outside3000).toBeCloseTo(1 / 9);
    expect(profile.features.outside5000).toBe(0);
    expect(profile.features.outside10000).toBe(0);
  });

  it('measures speech rate over the time of lines with Thai words', () => {
    // Syllables: 2+1 | 1+1+2+1+1+2+1 | 1 + 1 (ๆ) = 14, names included; speech 2 + 3 + 2 = 7 s.
    expect(profile.features.speechRate).toBeCloseTo(2);
    // Thai words per line with any: 2, 7, 1.
    expect(profile.features.avgCueLength).toBeCloseTo(10 / 3);
  });

  it('gives no level to a video this short', () => {
    expect(profile.features.tokens).toBeLessThan(MIN_TOKENS_FOR_LEVEL);
    expect(profile.level).toBeNull();
  });

  it('counts overlapping cues once in the speech time', () => {
    const overlapping = buildProfile({
      cues: [
        { startMs: 0, endMs: 3000 },
        { startMs: 1000, endMs: 4000 },
      ],
      tokens: [tokens(th('ที่')), tokens(th('ที่'))],
      facts,
    });
    expect(overlapping.features.speechRate).toBeCloseTo(2 / 4);
  });
});

describe('analyzeProfile', () => {
  const profile = buildProfile({ cues: CUES, tokens: TOKENS, facts });
  const analysis = analyzeProfile(profile, STATUSES, TRACK);

  it('measures coverage by known and ignored tokens', () => {
    // ครับ ×2 known + ผม ignored = 3 of 9.
    expect(analysis.knownTokens).toBe(3);
    expect(analysis.coverage).toBeCloseTo(3 / 9);
    expect(analysis.comprehension).toBe('too-hard');
    expect(analysis.newTokens).toBe(5);
    expect(analysis.unique).toEqual({ known: 1, ignored: 1, learning: 1, new: 5 });
  });

  it('splits new words into frequent and rare', () => {
    expect(analysis.newHighFreq).toBe(4);
    expect(analysis.newRare).toBe(1);
  });

  it('ranks new words by occurrences × general frequency', () => {
    expect(analysis.topNew.map((word) => word.thai)).toEqual([
      'ที่',
      'ไทย',
      'ภาษา',
      'สวัสดี',
      'เร็ว',
    ]);
    expect(analysis.topNew[2]).toEqual({
      thai: 'ภาษา',
      count: 1,
      rank: 500,
      romanization: 'paa-sǎa',
    });
    expect(analysis.topNew[3]).toMatchObject({ thai: 'สวัสดี', gloss: 'hello' });
  });

  it('lists the lines with new words', () => {
    expect(analysis.newCues).toEqual([0, 1, 2]);
    const allKnown: Record<string, WordStatus> = {};
    for (const unit of profile.units) allKnown[unit.thai] = 'known';
    const done = analyzeProfile(profile, allKnown, TRACK);
    expect(done.newCues).toEqual([]);
    expect(done.coverage).toBe(1);
    expect(done.comprehension).toBe('comfortable');
    expect(done.topNew).toEqual([]);
  });

  it('has no comprehension without words', () => {
    const empty = analyzeProfile(
      buildProfile({ cues: CUES.slice(3), tokens: TOKENS.slice(3), facts }),
      {},
      TRACK,
    );
    expect(empty.features.tokens).toBe(0);
    expect(empty.coverage).toBe(0);
    expect(empty.comprehension).toBeNull();
  });
});

describe('artifacts of auto-generated captions', () => {
  const more: Record<string, WordFacts> = {
    ...FACTS,
    คือ: { rank: 30, inDictionary: true, isProperNoun: false, syllables: 1 },
    ออ: { rank: 2593, inDictionary: true, isProperNoun: false, syllables: 1 },
    มาก: { rank: 35, inDictionary: true, isProperNoun: false, syllables: 1 },
    กก: { rank: 9000, inDictionary: true, isProperNoun: false, syllables: 1 },
    ป: { rank: 3541, inDictionary: false, isProperNoun: false, syllables: 1 },
    ณ: { rank: 2000, inDictionary: true, isProperNoun: false, syllables: 1 },
    สตู: { inDictionary: false, isProperNoun: false, syllables: 1 },
  };
  const profileOf = (...cue: [string, TokenKind][]) =>
    buildProfile({
      cues: [{ startMs: 0, endMs: 1000 }],
      tokens: [tokens(...cue)],
      facts: (word) => more[word] ?? facts(word),
    });

  it('counts a held sound as part of the word before it', () => {
    // คือ|ออ|ที่ มาก|กก: two lengthened sounds, three words.
    const profile = profileOf(th('คือ'), th('ออ'), th('ที่'), SPACE, th('มาก'), th('กก'));
    expect(profile.units.map((unit) => unit.thai)).toEqual(['คือ', 'ที่', 'มาก']);
    expect(profile.features.tokens).toBe(3);
    expect(profile.features.avgCueLength).toBe(3);
    expect(profile.features.speechRate).toBe(3);
  });

  it('keeps the same letters as a word of their own', () => {
    // After a space, or after a word ending in another letter, ออ is a word.
    expect(profileOf(th('คือ'), SPACE, th('ออ')).features.tokens).toBe(2);
    expect(profileOf(th('ที่'), th('ออ')).features.tokens).toBe(2);
  });

  it('does not count a lone cluster the dictionary lacks', () => {
    const profile = profileOf(th('ป'), th('จ'), th('ณ'), th('สตู'), th('ที่'));
    expect(profile.units.map((unit) => unit.thai)).toEqual(['ณ', 'สตู', 'ที่']);
    // Fragments are still speech.
    expect(profile.features.speechRate).toBe(5);
    expect(profile.features.avgCueLength).toBe(3);
  });

  it('suggests words in the dictionary or the frequency list, but marks all new ones', () => {
    const profile = profileOf(th('สตู'), th('ที่'));
    expect(newUnits(profile, {}).map((unit) => unit.thai)).toEqual(['ที่']);
    expect(newUnits(profile, {}, { all: true }).map((unit) => unit.thai)).toEqual(['ที่', 'สตู']);
  });
});

describe('wordScore', () => {
  it('is positive and grows with occurrences and general frequency', () => {
    expect(wordScore(1, 30_000)).toBeGreaterThan(0);
    expect(wordScore(1, undefined)).toBeGreaterThan(0);
    expect(wordScore(1, undefined)).toBeLessThan(wordScore(1, 30_000));
    expect(wordScore(1, 10)).toBeGreaterThan(wordScore(1, 1000));
    expect(wordScore(3, 1000)).toBeGreaterThan(wordScore(1, 1000));
    // A rare word said often can beat a frequent word said once.
    expect(wordScore(5, 5000)).toBeGreaterThan(wordScore(1, 100));
  });
});

describe('levels', () => {
  it('uses the coverage thresholds of plan §7.3', () => {
    expect(comprehensionOf(1)).toBe('comfortable');
    expect(comprehensionOf(0.98)).toBe('comfortable');
    expect(comprehensionOf(0.979)).toBe('challenging');
    expect(comprehensionOf(0.95)).toBe('challenging');
    expect(comprehensionOf(0.949)).toBe('hard');
    expect(comprehensionOf(0.9)).toBe('hard');
    expect(comprehensionOf(0.899)).toBe('too-hard');
  });

  const features = (overrides: Partial<VideoFeatures>): VideoFeatures => ({
    tokens: 1000,
    unique: 300,
    outside1000: 0.18,
    outside3000: 0.1,
    outside5000: 0.08,
    outside10000: 0.06,
    speechRate: 5,
    avgCueLength: 8,
    ...overrides,
  });

  it('rates slow, common speech low and fast, rare speech high', () => {
    const easy = features({
      outside1000: 0.06,
      outside3000: 0.02,
      outside10000: 0.005,
      speechRate: 2.5,
      avgCueLength: 3,
    });
    const hard = features({
      outside1000: 0.4,
      outside3000: 0.25,
      outside10000: 0.2,
      speechRate: 8,
      avgCueLength: 18,
    });
    expect(estimateLevel(easy)).toBe('A1');
    expect(estimateLevel(hard)).toBe('C2');
    expect(estimateLevel(features({}))).toBe('B1');
  });

  it('is monotonic in every feature', () => {
    const base = features({});
    for (const key of [
      'outside1000',
      'outside3000',
      'outside10000',
      'speechRate',
      'avgCueLength',
    ] as const) {
      expect(levelScore({ ...base, [key]: base[key] * 1.5 }), key).toBeGreaterThan(
        levelScore(base),
      );
    }
  });

  it('needs enough tokens', () => {
    expect(estimateLevel(features({ tokens: MIN_TOKENS_FOR_LEVEL - 1 }))).toBeNull();
  });
});

describe('calibration rows', () => {
  it('round-trips a copied row once a level is filled in', () => {
    const row = calibrationRow({
      videoId: 'iH31BMKBEdU',
      title: 'A "quoted", title',
      features: {
        tokens: 812,
        unique: 300,
        outside1000: 0.18333,
        outside3000: 0.1,
        outside5000: 0.08,
        outside10000: 0.06,
        speechRate: 5.234,
        avgCueLength: 8.1,
      },
    });
    const fields = row.split(',');
    expect(row).toContain('"A ""quoted"", title"');
    const rated = row.replace('title",,', 'title",B1,');
    const [parsed] = parseCalibration(`${CALIBRATION_COLUMNS.join(',')}\n${rated}\n`);
    expect(fields.length).toBeGreaterThanOrEqual(CALIBRATION_COLUMNS.length);
    expect(parsed).toMatchObject({
      videoId: 'iH31BMKBEdU',
      title: 'A "quoted", title',
      level: 'B1',
      features: { tokens: 812, outside1000: 0.1833, speechRate: 5.23, avgCueLength: 8.1 },
    });
  });

  it('rejects a row without a level', () => {
    const row = `iH31BMKBEdU,t,,1,0,0,0,0,1,1,`;
    expect(() => parseCalibration(`${CALIBRATION_COLUMNS.join(',')}\n${row}`)).toThrow(/level/);
  });
});

describe('level calibration (tests/fixtures/levels.csv)', () => {
  const rows = parseCalibration(readFileSync('tests/fixtures/levels.csv', 'utf8'));

  it.skipIf(rows.length === 0)('is within one level of the hand rating for 80 % of videos', () => {
    const results = rows.map((row) => {
      const estimate = estimateLevel(row.features);
      const distance =
        estimate === null
          ? Infinity
          : Math.abs(LEVELS.indexOf(estimate) - LEVELS.indexOf(row.level));
      return { videoId: row.videoId, rated: row.level, estimate, distance };
    });
    const exact = results.filter((result) => result.distance === 0).length;
    const close = results.filter((result) => result.distance <= 1).length;
    console.info(
      `levels.csv: ${rows.length} videos, exact ${exact}, within one level ${close}`,
      results.filter((result) => result.distance > 1),
    );
    expect(close / rows.length).toBeGreaterThanOrEqual(0.8);
  });
});
