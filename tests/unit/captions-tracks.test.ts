import { describe, expect, it } from 'vitest';
import {
  activeIndexAt,
  alignTranslation,
  chooseThaiTrack,
  englishRef,
  lastStartedIndex,
  thaiCandidates,
} from '@/src/captions/tracks';
import type { ProcessedCue, ProcessedTrack, TrackInfo } from '@/src/captions/types';

const track = (
  vssId: string,
  languageCode: string,
  kind: TrackInfo['kind'],
  isTranslatable = true,
): TrackInfo => ({
  vssId,
  languageCode,
  kind,
  name: '',
  isTranslatable,
});
const cue = (startMs: number, endMs: number, text = `${startMs}`): ProcessedCue => ({
  startMs,
  endMs,
  text,
});
const processed = (key: string, kind: TrackInfo['kind'], cues: ProcessedCue[]): ProcessedTrack => ({
  videoId: 'v',
  key,
  languageCode: 'th',
  kind,
  cues,
  fetchedAt: 0,
  processingVersion: 1,
});

describe('thaiCandidates', () => {
  it('lists the manual Thai track before the asr one and ignores other languages', () => {
    const tracks = [
      track('.en', 'en', 'manual'),
      track('a.th', 'th', 'asr'),
      track('.th', 'th', 'manual'),
    ];
    expect(thaiCandidates(tracks).map((t) => t.vssId)).toEqual(['.th', 'a.th']);
    expect(thaiCandidates([track('.en', 'en', 'manual'), track('.de', 'de', 'manual')])).toEqual(
      [],
    );
  });
});

describe('chooseThaiTrack', () => {
  const asr = processed('a.th', 'asr', [cue(0, 60_000)]);

  it('prefers a real manual track', () => {
    const manual = processed('.th', 'manual', [cue(0, 40_000)]);
    expect(chooseThaiTrack([asr, manual])?.key).toBe('.th');
  });

  it('falls back to asr when the manual track is a stub (live: 2 cues on a full song)', () => {
    const stub = processed('.th', 'manual', [cue(15_745, 17_745), cue(19_499, 21_356)]);
    expect(chooseThaiTrack([stub, asr])?.key).toBe('a.th');
  });

  it('takes whatever exists, ignores translations and empty tracks', () => {
    expect(chooseThaiTrack([asr])?.key).toBe('a.th');
    expect(chooseThaiTrack([processed('.th', 'manual', [])])).toBeNull();
    expect(chooseThaiTrack([{ ...asr, key: 'a.th>th', translatedFrom: 'a.th' }])).toBeNull();
  });
});

describe('englishRef', () => {
  it('uses a manual English track when there is one', () => {
    const thai = track('a.th', 'th', 'asr');
    expect(englishRef([thai, track('.en-GB', 'en-GB', 'manual')], thai)).toEqual({
      vssId: '.en-GB',
    });
  });

  it('otherwise asks YouTube for a machine translation of the Thai track', () => {
    const thai = track('a.th', 'th', 'asr');
    expect(englishRef([thai, track('a.en', 'en', 'asr')], thai)).toEqual({
      vssId: 'a.th',
      tlang: 'en',
    });
    expect(
      englishRef([track('.th', 'th', 'manual', false)], track('.th', 'th', 'manual', false)),
    ).toBeNull();
  });
});

describe('cue lookup', () => {
  const cues = [cue(1000, 2000), cue(2000, 3000), cue(5000, 6000)];

  it('finds the cue on screen and nothing in gaps', () => {
    expect(activeIndexAt(cues, 999)).toBe(-1);
    expect(activeIndexAt(cues, 1000)).toBe(0);
    expect(activeIndexAt(cues, 2000)).toBe(1);
    expect(activeIndexAt(cues, 4000)).toBe(-1);
    expect(activeIndexAt(cues, 5999)).toBe(2);
    expect(activeIndexAt([], 0)).toBe(-1);
  });

  it('finds the last cue that started', () => {
    expect(lastStartedIndex(cues, 4000)).toBe(1);
    expect(lastStartedIndex(cues, 0)).toBe(-1);
    expect(lastStartedIndex(cues, 1e9)).toBe(2);
  });
});

describe('alignTranslation', () => {
  it('pairs identical timings one to one (tlang=en)', () => {
    const thai = [cue(0, 2000, 'ก'), cue(2000, 4000, 'ข')];
    const english = [cue(0, 2000, 'A'), cue(2000, 4000, 'B')];
    expect(alignTranslation(thai, english)).toEqual(['A', 'B']);
  });

  it('joins English cues inside one merged Thai cue', () => {
    const thai = [cue(0, 4000, 'กข')];
    expect(alignTranslation(thai, [cue(0, 2000, 'A'), cue(2000, 4000, 'B')])).toEqual(['A B']);
  });

  it('lets a long English cue cover several Thai cues (independent manual track)', () => {
    const thai = [cue(0, 1500, 'ก'), cue(1500, 3000, 'ข'), cue(9000, 9500, 'ค')];
    // Midpoint 1550 lands in the second Thai cue; the first borrows it by overlap.
    const english = [cue(200, 2900, 'A long sentence')];
    expect(alignTranslation(thai, english)).toEqual(['A long sentence', 'A long sentence', '']);
  });
});
