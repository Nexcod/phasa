/**
 * The two estimates of plan §7.3: personal comprehension from known-word
 * coverage, and an absolute A1–C2 level from the video alone.
 *
 * The level is a weighted mean of per-feature scores on a 0 (A1) … 5 (C2)
 * scale, each interpolated between two anchor values. The anchors and weights
 * are a first heuristic (ADR 0011): they are to be calibrated on 30–50 videos
 * rated by hand, tests/fixtures/levels.csv.
 */
import { LEVELS, type Comprehension, type Level, type VideoFeatures } from './types';

/** Coverage thresholds from L2 reading research (Hu & Nation 2000), plan §7.3. */
export function comprehensionOf(coverage: number): Comprehension {
  if (coverage >= 0.98) return 'comfortable';
  if (coverage >= 0.95) return 'challenging';
  if (coverage >= 0.9) return 'hard';
  return 'too-hard';
}

interface Anchor {
  feature: keyof VideoFeatures;
  /** Feature value scored 0 (A1) … value scored 5 (C2); linear in between, clamped. */
  a1: number;
  c2: number;
  weight: number;
}

/**
 * Vocabulary weighs most. TNC ranks come from written Thai, so even easy speech has 10–25 % of
 * its tokens outside the top 1000 (the gold set's 13 videos: 11–25 %). Thai speech runs at about
 * 5–7 syllables a second; lessons for beginners at 3. Line length depends on the captioner as
 * much as on the speaker, so it weighs least.
 */
export const LEVEL_ANCHORS: readonly Anchor[] = [
  { feature: 'outside1000', a1: 0.08, c2: 0.35, weight: 0.2 },
  { feature: 'outside3000', a1: 0.03, c2: 0.22, weight: 0.25 },
  { feature: 'outside10000', a1: 0.01, c2: 0.14, weight: 0.2 },
  { feature: 'speechRate', a1: 3, c2: 7.5, weight: 0.25 },
  { feature: 'avgCueLength', a1: 3, c2: 16, weight: 0.1 },
];

/** Below this many counted tokens the level says more about chance than about the video. */
export const MIN_TOKENS_FOR_LEVEL = 30;

/** Level score on the 0 (A1) … 5 (C2) scale. */
export function levelScore(features: VideoFeatures): number {
  let total = 0;
  let weights = 0;
  for (const { feature, a1, c2, weight } of LEVEL_ANCHORS) {
    const value = features[feature];
    const score = Math.min(5, Math.max(0, ((value - a1) / (c2 - a1)) * 5));
    total += score * weight;
    weights += weight;
  }
  return total / weights;
}

export function estimateLevel(features: VideoFeatures): Level | null {
  if (features.tokens < MIN_TOKENS_FOR_LEVEL) return null;
  const index = Math.min(LEVELS.length - 1, Math.max(0, Math.round(levelScore(features))));
  return LEVELS[index] ?? null;
}
