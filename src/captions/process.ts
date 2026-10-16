/**
 * Turns parsed cues into display-ready cues (docs/plan.md §4.2, §5.2):
 * non-speech tags removed, text normalized with zero-width boundary hints,
 * overlaps resolved, and short auto-generated Thai fragments merged.
 */
import { normalizeThai } from '../thai/normalize';
import { parseCaptions } from './parse';
import {
  PROCESSING_VERSION,
  trackKey,
  type CaptionCue,
  type ProcessedCue,
  type ProcessedTrack,
  type TrackKind,
  type TrackRef,
} from './types';

/** `[เพลง]`, `[ดนตรี]`, `[หัวเราะ]`, `[Music]`, full-width `［…］`. */
const NON_SPEECH_TAG = /\[[^\][\n]{1,40}\]|［[^］\n]{1,40}］/gu;

export function stripNonSpeech(text: string): string {
  return text.replace(NON_SPEECH_TAG, ' ');
}

/** A cue shorter than this and with fewer than {@link SHORT_CUE_WORDS} words is merged (asr only). */
export const SHORT_CUE_MS = 1000;
export const SHORT_CUE_WORDS = 3;
/** Only merge into a neighbour this close in time. */
export const MAX_MERGE_GAP_MS = 1000;
/** End assigned to a cue without a duration and without a following cue. */
const FALLBACK_DURATION_MS = 3000;

const words = new Intl.Segmenter('th', { granularity: 'word' });

export function wordCount(text: string): number {
  let count = 0;
  for (const segment of words.segment(text)) if (segment.isWordLike) count++;
  return count;
}

/** `raw` and hints feed Thai offset maps and the tokenizer; a translation needs neither. */
function toProcessed(cue: CaptionCue, thai: boolean): ProcessedCue | null {
  const cleaned = stripNonSpeech(cue.text);
  const normalized = normalizeThai(cleaned);
  if (normalized.text === '') return null;
  const out: ProcessedCue = { startMs: cue.startMs, endMs: cue.endMs, text: normalized.text };
  if (!thai) return out;
  if (cleaned !== normalized.text) out.raw = cleaned;
  if (normalized.boundaryHints.length > 0) out.hints = normalized.boundaryHints;
  return out;
}

/** Joins two cues with a space, which the tokenizer treats as a phrase boundary. */
export function joinCues(a: ProcessedCue, b: ProcessedCue): ProcessedCue {
  const text = `${a.text} ${b.text}`;
  const out: ProcessedCue = { startMs: a.startMs, endMs: Math.max(a.endMs, b.endMs), text };
  if (a.raw !== undefined || b.raw !== undefined) out.raw = `${a.raw ?? a.text} ${b.raw ?? b.text}`;
  const shift = a.text.length + 1;
  const hints = [...(a.hints ?? []), ...(b.hints ?? []).map((offset) => offset + shift)];
  if (hints.length > 0) out.hints = hints;
  return out;
}

/**
 * One cue at a time: cues starting together are joined, and a cue ends no
 * later than the next one starts. Auto-generated tracks overlap by design
 * (the rolling two-line window), so this also turns them into single lines.
 */
export function resolveOverlaps(sorted: ProcessedCue[]): ProcessedCue[] {
  const out: ProcessedCue[] = [];
  for (const cue of sorted) {
    const previous = out.at(-1);
    if (previous?.startMs === cue.startMs) {
      out[out.length - 1] = joinCues(previous, cue);
      continue;
    }
    out.push({ ...cue });
  }
  for (let i = 0; i < out.length; i++) {
    const cue = out[i];
    const next = out[i + 1];
    if (!cue) continue;
    if (cue.endMs <= cue.startMs)
      cue.endMs = next ? next.startMs : cue.startMs + FALLBACK_DURATION_MS;
    if (next && cue.endMs > next.startMs) cue.endMs = next.startMs;
  }
  return out;
}

function isShort(cue: ProcessedCue): boolean {
  return cue.endMs - cue.startMs < SHORT_CUE_MS && wordCount(cue.text) < SHORT_CUE_WORDS;
}

/** Merges short asr fragments into the closer neighbour (docs/plan.md §4.2). */
export function mergeShortCues(cues: ProcessedCue[]): ProcessedCue[] {
  const pending = [...cues];
  const out: ProcessedCue[] = [];
  for (let i = 0; i < pending.length; i++) {
    const cue = pending[i];
    if (!cue) continue;
    if (!isShort(cue)) {
      out.push(cue);
      continue;
    }
    const previous = out.at(-1);
    const next = pending[i + 1];
    const gapBefore = previous ? cue.startMs - previous.endMs : Infinity;
    const gapAfter = next ? next.startMs - cue.endMs : Infinity;
    if (previous && gapBefore <= MAX_MERGE_GAP_MS && gapBefore <= gapAfter) {
      out[out.length - 1] = joinCues(previous, cue);
    } else if (next && gapAfter <= MAX_MERGE_GAP_MS) {
      pending[i + 1] = joinCues(cue, next);
    } else {
      out.push(cue);
    }
  }
  return out;
}

export interface ProcessOptions {
  /** Language of the text: the track's language, or `tlang` for a translation. */
  languageCode: string;
  kind: TrackKind;
}

export function processCues(cues: CaptionCue[], options: ProcessOptions): ProcessedCue[] {
  const thai = isThaiLanguage(options.languageCode);
  const processed = cues
    .map((cue) => toProcessed(cue, thai))
    .filter((cue): cue is ProcessedCue => cue !== null)
    .sort((a, b) => a.startMs - b.startMs);
  const single = resolveOverlaps(processed);
  return thai && options.kind === 'asr' ? mergeShortCues(single) : single;
}

export function isThaiLanguage(code: string): boolean {
  return code === 'th' || code.startsWith('th-');
}

export interface ProcessTrackInput extends ProcessOptions {
  videoId: string;
  ref: TrackRef;
  body: string;
  fetchedAt: number;
}

export function processTrack(input: ProcessTrackInput): ProcessedTrack {
  const track: ProcessedTrack = {
    videoId: input.videoId,
    key: trackKey(input.ref),
    languageCode: input.languageCode,
    kind: input.kind,
    cues: processCues(parseCaptions(input.body), input),
    fetchedAt: input.fetchedAt,
    processingVersion: PROCESSING_VERSION,
  };
  if (input.ref.tlang) track.translatedFrom = input.ref.vssId;
  return track;
}
