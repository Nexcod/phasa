import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CaptionParseError,
  decodeEntities,
  detectFormat,
  parseCaptions,
  parseJson3,
  parseSrv1,
  parseVtt,
} from '@/src/captions/parse';

/** Real responses captured 2026-10-16, trimmed (tests/fixtures/README.md). */
function fixture(name: string): string {
  return readFileSync(join(import.meta.dirname, '../fixtures/captions', name), 'utf8');
}

const FIRST_LINES = [
  'สวัสดีครับผมโอจอยจอยจ',
  'สวัสดีครับวันนี้ผมมีเรื่องที่อยากจะคุย',
  'กับทุกคนนะครับตอนนี้ผมอยู่ข้างนอกนะครับ',
];

describe('detectFormat', () => {
  it('recognizes every format the endpoint serves', () => {
    expect(detectFormat(fixture('iH31BMKBEdU.a.th.json3.json'))).toBe('json3');
    expect(detectFormat(fixture('iH31BMKBEdU.a.th.srv3.xml'))).toBe('srv3');
    expect(detectFormat(fixture('iH31BMKBEdU.a.th.srv1.xml'))).toBe('srv1');
    expect(detectFormat(fixture('iH31BMKBEdU.a.th.vtt'))).toBe('vtt');
    expect(detectFormat('<html>')).toBeNull();
  });
});

describe('contract: real timedtext bodies', () => {
  it('json3 (asr): skips window and append events, joins word segments', () => {
    const cues = parseCaptions(fixture('iH31BMKBEdU.a.th.json3.json'));
    expect(cues).toHaveLength(15);
    expect(cues.slice(0, 3).map((cue) => cue.text)).toEqual(FIRST_LINES);
    expect(cues[0]).toMatchObject({ startMs: 40, endMs: 4080 });
    expect(cues.some((cue) => cue.text.includes('\n'))).toBe(false);
  });

  it('json3 (manual, pretty-printed)', () => {
    expect(parseCaptions(fixture('pxLHURprYuI.th.json3.json'))).toEqual([
      { startMs: 15745, endMs: 17745, text: 'ร้องเพลงพยัญชนะไทย' },
      { startMs: 19499, endMs: 21356, text: 'ร้องเพลงพยัญชนะไทย' },
    ]);
  });

  it('json3 (manual English): keeps line breaks for the normalizer', () => {
    const cues = parseCaptions(fixture('uYEW8BeJ0zY.en.json3.json'));
    expect(cues[0]).toEqual({
      startMs: 1810,
      endMs: 3610,
      text: 'Hello everyone\nWelcome back to my channel',
    });
  });

  it('srv3, srv1 and VTT give the same lines as json3', () => {
    for (const name of [
      'iH31BMKBEdU.a.th.srv3.xml',
      'iH31BMKBEdU.a.th.srv1.xml',
      'iH31BMKBEdU.a.th.vtt',
    ]) {
      const cues = parseCaptions(fixture(name));
      expect(
        cues.slice(0, 3).map((cue) => cue.text),
        name,
      ).toEqual(FIRST_LINES);
      expect(cues[1]?.startMs, name).toBe(2080);
    }
  });

  it('VTT: drops the rolling previous line and the 10 ms transition cues', () => {
    const cues = parseVtt(fixture('iH31BMKBEdU.a.th.vtt'));
    expect(cues).toHaveLength(4);
    expect(cues[1]).toEqual({ startMs: 2080, endMs: 4070, text: FIRST_LINES[1] });
  });
});

describe('format details', () => {
  it('rejects empty and malformed bodies', () => {
    expect(() => parseCaptions('')).toThrow(CaptionParseError);
    expect(() => parseCaptions('   ')).toThrow(CaptionParseError);
    expect(() => parseJson3('{"events": 5}')).toThrow(CaptionParseError);
    expect(() => parseJson3('{')).toThrow(CaptionParseError);
  });

  it('tolerates json3 events with missing fields', () => {
    expect(
      parseJson3('{"events":[{"segs":[{"utf8":"กิน"}]},{"tStartMs":5,"segs":[{}]},null]}'),
    ).toEqual([{ startMs: 0, endMs: 0, text: 'กิน' }]);
  });

  it('decodes srv1 text, which is HTML-escaped inside XML', () => {
    const body =
      '<?xml version="1.0"?><transcript><text start="1.5" dur="2">I&amp;#39;m &amp;amp; you</text></transcript>';
    expect(parseSrv1(body)).toEqual([{ startMs: 1500, endMs: 3500, text: "I'm & you" }]);
  });

  it('decodes numeric and named entities', () => {
    expect(decodeEntities('&lt;b&gt; &#3585; &#x0E01; &quot;x&quot; &bogus;')).toBe(
      '<b> ก ก "x" &bogus;',
    );
  });

  it('parses VTT with hours, cue ids, tags and CRLF', () => {
    const body =
      'WEBVTT\r\n\r\ncue-1\r\n01:00:00.500 --> 01:00:02.000 align:start\r\n<c.yellow>สวัสดี</c>\r\n';
    expect(parseVtt(body)).toEqual([{ startMs: 3_600_500, endMs: 3_602_000, text: 'สวัสดี' }]);
  });
});
