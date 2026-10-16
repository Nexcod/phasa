import type { TrackKind } from '../../src/captions/types';

export interface TestVideo {
  videoId: string;
  title: string;
  /** Which Thai track the extension should pick (docs/plan.md §4.1 step 3, ADR 0007). */
  thaiTrack: TrackKind | 'none';
  /** Source of the English line. */
  english?: 'manual' | 'tlang';
  notes?: string;
}

/**
 * Acceptance set for captions (docs/plan.md §4.3): 5 videos with manual Thai
 * captions, 5 with auto-generated (asr) only, plus edge cases. Checked live
 * on 2026-10-16 (docs/spikes.md §1, run 3); used by the manual checklist
 * (docs/manual-checklist.md), since live captions cannot run under automation.
 */
export const TEST_VIDEOS: readonly TestVideo[] = [
  // Manual Thai captions (Thai speech)
  {
    videoId: '48A9SU6_bQ8',
    title: 'โปรดเรียกฉันด้วยนามอันแท้จริง | นิติ ชัยชิตาทร | TEDxBangkok',
    thaiTrack: 'manual',
    english: 'tlang',
  },
  {
    videoId: 'wD3NSzYtsMc',
    title: 'สุขสันต์วันปล่อยวาง | จิตร์ จิตฺตสํวโร | TEDxBangkok',
    thaiTrack: 'manual',
    english: 'tlang',
  },
  {
    videoId: '6FGHJxEx6Ts',
    title: 'ประวัติศาสตร์ละแวกบ้าน | สมชัย กวางทองพานิชย์ | TEDxBangkok',
    thaiTrack: 'manual',
    english: 'manual',
  },
  {
    videoId: 'PoautAigKP8',
    title: 'ถอดความเทพพนม | พิเชษฐ กลั่นชื่น | TEDxBangkok',
    thaiTrack: 'manual',
    english: 'manual',
  },
  {
    videoId: '1pRtDpRJZdY',
    title: 'อย่าให้รักเดียวเป็นเรื่องมหัศจรรย์ | TEDxBangkok',
    thaiTrack: 'manual',
    english: 'tlang',
    notes: 'manual Thai only, no asr track',
  },
  // Auto-generated Thai only
  {
    videoId: 'iH31BMKBEdU',
    title: 'ฝรั่งคิดยังไงกับภาษาไทย? เปิดใจเผยความคิดลึกๆ',
    thaiTrack: 'asr',
    english: 'tlang',
  },
  {
    videoId: 'uYEW8BeJ0zY',
    title: 'STUDY TIPS (Babyjingko)',
    thaiTrack: 'asr',
    english: 'manual',
  },
  {
    videoId: '0DVrEKzzYEQ',
    title: 'The Farang Mindset: Changing Your Brain with Thai',
    thaiTrack: 'asr',
    english: 'manual',
  },
  {
    videoId: 'xV8fgU3Hczk',
    title: 'จะรวยยังไง... ถ้ายังอยู่ใน "ระบบ" ที่ออกแบบมาให้เรา "จน"',
    thaiTrack: 'asr',
    english: 'tlang',
    notes: 'also has an English asr track, which must not be used',
  },
  {
    videoId: 'SVj46JwYnB4',
    title: 'อัปเดต กิน เที่ยว นอนในเมืองเชียงใหม่ 2025 | อาสาพาไปหลง',
    thaiTrack: 'asr',
    english: 'tlang',
    notes: '31 min, 750 cues: the long case',
  },
  // Edge cases
  {
    videoId: 'pBoQcFogon8',
    title: 'เพลงสระ (Pinkfong)',
    thaiTrack: 'asr',
    english: 'tlang',
    notes: 'stub manual track (5 cues) loses to asr; uploader forces captions on',
  },
  {
    videoId: 'pxLHURprYuI',
    title: 'เพลง ก เอ๋ย ก ไก่ (Pinkfong)',
    thaiTrack: 'asr',
    english: 'tlang',
    notes: 'stub manual track (2 cues) loses to asr; uploader forces captions on',
  },
  {
    videoId: 'jNQXAC9IVRw',
    title: 'Me at the zoo',
    thaiTrack: 'none',
    notes:
      'en/de manual; with sticky "th" YouTube shows en→th machine translation — must stay "none"',
  },
];
