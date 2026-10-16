/**
 * Parsers for timedtext bodies (docs/plan.md §4.1 step 6). The player asks for
 * json3; srv3, srv1 and WebVTT are supported in case it switches. Runs in the
 * service worker, which has no DOMParser, so the XML formats are read with
 * small regex-based readers. Contract fixtures: tests/fixtures/captions/.
 */
import type { CaptionCue, CaptionFormat } from './types';

export class CaptionParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CaptionParseError';
  }
}

export function detectFormat(body: string): CaptionFormat | null {
  const head = body.trimStart().slice(0, 256);
  if (head.startsWith('{')) return 'json3';
  if (head.startsWith('WEBVTT')) return 'vtt';
  if (/<timedtext\b/.test(head)) return 'srv3';
  if (/<transcript\b/.test(head)) return 'srv1';
  return null;
}

/** Cues in source order; empty and append-only events are skipped. */
export function parseCaptions(body: string, format = detectFormat(body)): CaptionCue[] {
  if (body.trim() === '') throw new CaptionParseError('Empty caption body');
  switch (format) {
    case 'json3':
      return parseJson3(body);
    case 'srv3':
      return parseSrv3(body);
    case 'srv1':
      return parseSrv1(body);
    case 'vtt':
      return parseVtt(body);
    case null:
      throw new CaptionParseError('Unknown caption format');
  }
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * json3: `events[]` with `tStartMs`, `dDurationMs`, `segs[].utf8`. Auto-generated
 * tracks also contain window-definition events (no `segs`) and `aAppend`
 * events holding the "\n" of the rolling two-line window; both are skipped.
 */
export function parseJson3(body: string): CaptionCue[] {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw new CaptionParseError('json3: invalid JSON');
  }
  if (!isRecord(data) || !Array.isArray(data.events)) {
    throw new CaptionParseError('json3: no events');
  }
  const cues: CaptionCue[] = [];
  for (const event of data.events as unknown[]) {
    if (!isRecord(event) || !Array.isArray(event.segs) || event.aAppend) continue;
    const text = (event.segs as unknown[])
      .map((seg) => (isRecord(seg) && typeof seg.utf8 === 'string' ? seg.utf8 : ''))
      .join('');
    if (text.trim() === '') continue;
    const startMs = finiteOr(event.tStartMs, 0);
    cues.push({ startMs, endMs: startMs + finiteOr(event.dDurationMs, 0), text });
  }
  return cues;
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00A0',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/giu, (whole, name: string) => {
    if (name.startsWith('#')) {
      const code =
        name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    return NAMED_ENTITIES[name.toLowerCase()] ?? whole;
  });
}

function attributes(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [, name, value] of source.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/gu)) {
    if (name !== undefined && value !== undefined) out[name] = value;
  }
  return out;
}

function xmlText(inner: string): string {
  return decodeEntities(inner.replace(/<br\s*\/?>/giu, '\n').replace(/<[^>]*>/gu, ''));
}

/** srv3: `<p t="ms" d="ms" [a="1"]>` with optional `<s>` word segments. */
export function parseSrv3(body: string): CaptionCue[] {
  const cues: CaptionCue[] = [];
  for (const [, attrs = '', inner = ''] of body.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/gu)) {
    const a = attributes(attrs);
    if (a.a === '1') continue;
    const text = xmlText(inner);
    if (text.trim() === '') continue;
    const startMs = Number(a.t ?? 0);
    cues.push({ startMs, endMs: startMs + Number(a.d ?? 0), text });
  }
  return cues;
}

/** srv1: `<text start="s" dur="s">`; the text is HTML-escaped inside XML, so decode twice. */
export function parseSrv1(body: string): CaptionCue[] {
  const cues: CaptionCue[] = [];
  for (const [, attrs = '', inner = ''] of body.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/gu)) {
    const a = attributes(attrs);
    const text = decodeEntities(xmlText(inner));
    if (text.trim() === '') continue;
    const startMs = Math.round(Number(a.start ?? 0) * 1000);
    cues.push({ startMs, endMs: startMs + Math.round(Number(a.dur ?? 0) * 1000), text });
  }
  return cues;
}

const VTT_TIME = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{3})/u;

function vttMs(stamp: string): number | null {
  const m = VTT_TIME.exec(stamp);
  if (!m) return null;
  return ((Number(m[1] ?? 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4]);
}

/** Auto-generated VTT shows a 10 ms "scroll" cue between lines; anything this short is skipped. */
const VTT_TRANSITION_MS = 50;

/**
 * WebVTT. Auto-generated tracks use a rolling window: each cue repeats the
 * previous line above the new one, so a first line equal to the previous cue's
 * text is dropped.
 */
export function parseVtt(body: string): CaptionCue[] {
  const cues: CaptionCue[] = [];
  let previous = '';
  // Blocks end at an empty line; auto-generated tracks use " " lines inside a cue.
  for (const block of body.replace(/\r\n?/gu, '\n').split(/\n\n+/u)) {
    const lines = block.split('\n');
    const timing = lines.findIndex((line) => line.includes('-->'));
    if (timing < 0) continue;
    const [from = '', to = ''] = (lines[timing] ?? '').split('-->');
    const startMs = vttMs(from);
    const endMs = vttMs(to);
    if (startMs === null || endMs === null || endMs - startMs < VTT_TRANSITION_MS) continue;
    const textLines = lines
      .slice(timing + 1)
      .map((line) => decodeEntities(line.replace(/<[^>]*>/gu, '')).trim())
      .filter((line) => line !== '');
    if (textLines.length > 1 && textLines[0] === previous) textLines.shift();
    const text = textLines.join('\n');
    if (text === '') continue;
    cues.push({ startMs, endMs, text });
    previous = textLines.at(-1) ?? '';
  }
  return cues;
}
