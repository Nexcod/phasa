import type { TrackKind } from '../../src/captions/types';

export interface TestVideo {
  videoId: string;
  title: string;
  /** Which Thai track the extension should pick (docs/plan.md §4.1 step 3). */
  thaiTrack: TrackKind | 'none';
  notes?: string;
}

/**
 * Acceptance set for captions (docs/plan.md §4.3): 5 videos with manual Thai
 * captions, 5 with auto-generated (asr) only, plus at least one without Thai.
 * Verified in the captions spike (docs/spikes.md §1). Still missing: 3 manual-Thai videos.
 */
export const TEST_VIDEOS: readonly TestVideo[] = [
  {
    videoId: 'pBoQcFogon8',
    title: 'เพลงสระ (Pinkfong Baby Shark, vowels song)',
    thaiTrack: 'manual',
    notes: 'manual th has only 5 cues; asr th has 35',
  },
  {
    videoId: 'pxLHURprYuI',
    title: 'เพลง ก เอ๋ย ก ไก่ (Pinkfong, consonants song)',
    thaiTrack: 'manual',
  },
  {
    videoId: 'uYEW8BeJ0zY',
    title: 'STUDY TIPS (Babyjingko)',
    thaiTrack: 'asr',
    notes: 'also has en manual',
  },
  {
    videoId: '0DVrEKzzYEQ',
    title: 'The Farang Mindset: Changing Your Brain with Thai',
    thaiTrack: 'asr',
    notes: 'also has en manual',
  },
  {
    videoId: 'iH31BMKBEdU',
    title: 'ฝรั่งคิดยังไงกับภาษาไทย? เปิดใจเผยความคิดลึกๆ',
    thaiTrack: 'asr',
    notes: 'th asr only',
  },
  {
    videoId: 'jNQXAC9IVRw',
    title: 'Me at the zoo',
    thaiTrack: 'none',
    notes:
      'en/de manual; with sticky "th" YouTube shows en→th machine translation — must stay "none"',
  },
];
