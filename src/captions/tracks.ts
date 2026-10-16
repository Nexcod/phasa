/**
 * Track choice (docs/plan.md §4.1 steps 3 and 7) and translation alignment.
 */
import { isThaiLanguage } from './process';
import type { ProcessedCue, ProcessedTrack, TrackInfo, TrackRef } from './types';

/** Thai tracks worth fetching: the manual one first, then the auto-generated one. */
export function thaiCandidates(tracks: readonly TrackInfo[]): TrackInfo[] {
  const thai = tracks.filter((track) => isThaiLanguage(track.languageCode));
  const manual = thai.find((track) => track.kind === 'manual');
  const asr = thai.find((track) => track.kind === 'asr');
  return [manual, asr].filter((track): track is TrackInfo => track !== undefined);
}

/** Total time with text on screen. */
export function coverageMs(cues: readonly ProcessedCue[]): number {
  return cues.reduce((sum, cue) => sum + Math.max(0, cue.endMs - cue.startMs), 0);
}

/**
 * A manual track below this share of the auto-generated track's coverage is a
 * stub (seen live: 2 and 5 manual cues on full songs, docs/spikes.md §1) and
 * loses to the auto-generated one.
 */
export const STUB_COVERAGE_RATIO = 0.5;

/** Manual beats auto-generated unless the manual track is a stub. */
export function chooseThaiTrack(tracks: readonly ProcessedTrack[]): ProcessedTrack | null {
  const thai = tracks.filter(
    (track) => isThaiLanguage(track.languageCode) && !track.translatedFrom,
  );
  const manual = thai.find((track) => track.kind === 'manual' && track.cues.length > 0);
  const asr = thai.find((track) => track.kind === 'asr' && track.cues.length > 0);
  if (!manual || !asr) return manual ?? asr ?? null;
  return coverageMs(manual.cues) >= STUB_COVERAGE_RATIO * coverageMs(asr.cues) ? manual : asr;
}

function isEnglish(code: string): boolean {
  return code === 'en' || code.startsWith('en-');
}

/**
 * Second line: a manual English track if the video has one, otherwise YouTube's
 * free machine translation of the chosen Thai track (`tlang=en`).
 */
export function englishRef(tracks: readonly TrackInfo[], thai: TrackInfo): TrackRef | null {
  const english = tracks.find((track) => track.kind === 'manual' && isEnglish(track.languageCode));
  if (english) return { vssId: english.vssId };
  return thai.isTranslatable ? { vssId: thai.vssId, tlang: 'en' } : null;
}

function overlap(a: ProcessedCue, b: ProcessedCue): number {
  return Math.max(0, Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs));
}

/** Index of the last cue starting at or before `ms`, or -1. Cues are sorted by start. */
export function lastStartedIndex(cues: readonly { startMs: number }[], ms: number): number {
  let lo = 0;
  let hi = cues.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((cues[mid]?.startMs ?? Infinity) <= ms) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** Index of the cue on screen at `ms`, or -1 between cues. */
export function activeIndexAt(cues: readonly ProcessedCue[], ms: number): number {
  const index = lastStartedIndex(cues, ms);
  const cue = cues[index];
  return cue && ms < cue.endMs ? index : -1;
}

/**
 * English text for each Thai cue. Each English cue goes to the Thai cue that
 * contains its midpoint (or overlaps it most); a Thai cue left without one
 * borrows the English cue that overlaps it most. Works for `tlang=en` (same
 * timings as the source track) and for independently timed manual tracks.
 */
export function alignTranslation(
  thai: readonly ProcessedCue[],
  english: readonly ProcessedCue[],
): string[] {
  const assigned: string[][] = thai.map(() => []);
  const best = (cue: ProcessedCue): number => {
    let index = -1;
    let most = 0;
    // Only Thai cues near `cue` can overlap it.
    for (let i = Math.max(0, lastStartedIndex(thai, cue.startMs)); i < thai.length; i++) {
      const candidate = thai[i];
      if (!candidate || candidate.startMs >= cue.endMs) break;
      const amount = overlap(candidate, cue);
      if (amount > most) {
        most = amount;
        index = i;
      }
    }
    return index;
  };

  for (const cue of english) {
    const mid = (cue.startMs + cue.endMs) / 2;
    let index = activeIndexAt(thai, mid);
    if (index < 0) index = best(cue);
    if (index >= 0) assigned[index]?.push(cue.text);
  }

  return assigned.map((texts, i) => {
    if (texts.length > 0) return texts.join(' ');
    const cue = thai[i];
    if (!cue) return '';
    let most = 0;
    let text = '';
    const from = Math.max(0, lastStartedIndex(english, cue.startMs));
    for (let j = from; j < english.length; j++) {
      const candidate = english[j];
      if (!candidate || candidate.startMs >= cue.endMs) break;
      const amount = overlap(candidate, cue);
      if (amount > most) {
        most = amount;
        text = candidate.text;
      }
    }
    return text;
  });
}
