import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  joinCues,
  mergeShortCues,
  processCues,
  processTrack,
  resolveOverlaps,
  stripNonSpeech,
  wordCount,
} from '@/src/captions/process';
import { PROCESSING_VERSION, trackKey, type ProcessedCue } from '@/src/captions/types';

const ZWSP = String.fromCharCode(0x200b);

function fixture(name: string): string {
  return readFileSync(join(import.meta.dirname, '../fixtures/captions', name), 'utf8');
}

const cue = (startMs: number, endMs: number, text: string): ProcessedCue => ({
  startMs,
  endMs,
  text,
});

describe('stripNonSpeech', () => {
  it('removes bracketed sound tags in Thai and English', () => {
    expect(stripNonSpeech('[เพลง] สวัสดี [หัวเราะ]').trim()).toBe('สวัสดี');
    expect(stripNonSpeech('[Music]')).toBe(' ');
    expect(stripNonSpeech('［ดนตรี］ครับ').trim()).toBe('ครับ');
  });
});

describe('resolveOverlaps', () => {
  it('ends a cue where the next one starts (asr rolling window)', () => {
    expect(resolveOverlaps([cue(0, 4000, 'a'), cue(2000, 6000, 'b')])).toEqual([
      cue(0, 2000, 'a'),
      cue(2000, 6000, 'b'),
    ]);
  });

  it('joins cues that start together and fills missing durations', () => {
    expect(resolveOverlaps([cue(0, 1000, 'a'), cue(0, 1500, 'b'), cue(3000, 0, 'c')])).toEqual([
      cue(0, 1500, 'a b'),
      cue(3000, 6000, 'c'),
    ]);
  });
});

describe('mergeShortCues', () => {
  it('counts Thai words', () => {
    expect(wordCount('ไปโรงเรียนครับ')).toBeGreaterThanOrEqual(2);
    expect(wordCount('ครับ')).toBe(1);
  });

  it('merges a short fragment into the closer neighbour', () => {
    const cues = [
      cue(0, 2000, 'วันนี้อากาศดีมาก'),
      cue(2100, 2600, 'ครับ'),
      cue(5000, 7000, 'ไปเที่ยวกันเถอะ'),
    ];
    expect(mergeShortCues(cues)).toEqual([
      cue(0, 2600, 'วันนี้อากาศดีมาก ครับ'),
      cue(5000, 7000, 'ไปเที่ยวกันเถอะ'),
    ]);
  });

  it('merges forward when the next cue is closer', () => {
    const cues = [
      cue(0, 1000, 'วันนี้อากาศดีมาก'),
      cue(1900, 2400, 'แต่'),
      cue(2450, 5000, 'ฝนตกหนักมาก'),
    ];
    expect(mergeShortCues(cues).map((c) => c.text)).toEqual([
      'วันนี้อากาศดีมาก',
      'แต่ ฝนตกหนักมาก',
    ]);
  });

  it('leaves isolated short cues and long cues alone', () => {
    const cues = [cue(0, 500, 'โอ้'), cue(5000, 5600, 'ว้าว')];
    expect(mergeShortCues(cues)).toEqual(cues);
  });

  it('shifts boundary hints of the joined cue', () => {
    const joined = joinCues({ ...cue(0, 1, 'กข'), hints: [1] }, { ...cue(1, 2, 'คง'), hints: [1] });
    expect(joined).toMatchObject({ text: 'กข คง', hints: [1, 4] });
  });
});

describe('processCues', () => {
  it('normalizes, drops empty cues and keeps raw text and hints for Thai', () => {
    const out = processCues(
      [
        { startMs: 0, endMs: 3000, text: `[เพลง]` },
        { startMs: 3000, endMs: 6000, text: `ไป${ZWSP}โรงเรียน  ครับ` },
      ],
      { languageCode: 'th', kind: 'manual' },
    );
    expect(out).toEqual([
      {
        startMs: 3000,
        endMs: 6000,
        text: 'ไปโรงเรียน ครับ',
        raw: `ไป${ZWSP}โรงเรียน  ครับ`,
        hints: [2],
      },
    ]);
  });

  it('does not keep raw text for a translation', () => {
    const out = processCues([{ startMs: 0, endMs: 1000, text: 'today.   To' }], {
      languageCode: 'en',
      kind: 'asr',
    });
    expect(out).toEqual([{ startMs: 0, endMs: 1000, text: 'today. To' }]);
  });
});

describe('processTrack on a real asr track', () => {
  const thai = processTrack({
    videoId: 'iH31BMKBEdU',
    ref: { vssId: 'a.th' },
    languageCode: 'th',
    kind: 'asr',
    body: fixture('iH31BMKBEdU.a.th.json3.json'),
    fetchedAt: 42,
  });

  it('produces sorted, non-overlapping cues', () => {
    expect(thai).toMatchObject({
      key: 'a.th',
      kind: 'asr',
      processingVersion: PROCESSING_VERSION,
      fetchedAt: 42,
    });
    expect(thai.cues).toHaveLength(15);
    for (let i = 1; i < thai.cues.length; i++) {
      expect(thai.cues[i]!.startMs).toBeGreaterThanOrEqual(thai.cues[i - 1]!.endMs);
    }
    expect(thai.cues[0]).toEqual({ startMs: 40, endMs: 2080, text: 'สวัสดีครับผมโอจอยจอยจ' });
  });

  it('marks machine translations with their source track', () => {
    const english = processTrack({
      videoId: 'iH31BMKBEdU',
      ref: { vssId: 'a.th', tlang: 'en' },
      languageCode: 'en',
      kind: 'asr',
      body: fixture('iH31BMKBEdU.a.th.tlang-en.json3.json'),
      fetchedAt: 42,
    });
    expect(english).toMatchObject({ key: 'a.th>en', translatedFrom: 'a.th', languageCode: 'en' });
    expect(english.cues[1]?.text).toBe("Hello, I have something I'd like to discuss today. To");
    expect(trackKey({ vssId: 'a.th', tlang: 'en' })).toBe('a.th>en');
  });
});
