import { describe, expect, it } from 'vitest';
import { csvField, parseCsv } from '../../scripts/lib/csv';
import { fromReviewNotation, toReviewNotation } from '@/src/thai/gold';

describe('review notation', () => {
  it('shows bars with spaces around them and ␣ for the text’s spaces', () => {
    expect(toReviewNotation('สวัสดี|ครับ| |วันนี้')).toBe('สวัสดี | ครับ | ␣ | วันนี้');
  });

  it('reads a correction back, ignoring typed spaces', () => {
    expect(fromReviewNotation('สวัสดี|ครับ ␣ |วัน | นี้', 'สวัสดี|ครับ| |วันนี้')).toEqual({
      ok: true,
      segmented: 'สวัสดี|ครับ| |วัน|นี้',
    });
  });

  it('refuses a correction that changes the text', () => {
    expect(fromReviewNotation('สวัสดี | ค่ะ', 'สวัสดี|ครับ')).toMatchObject({ ok: false });
    expect(fromReviewNotation('สวัสดี | ครับ', 'สวัสดี|ครับ| |วันนี้')).toMatchObject({
      ok: false,
    });
  });
});

describe('parseCsv', () => {
  it('round-trips quoted fields with commas, quotes and Thai', () => {
    const line = ['ก, ข', 'say "hi"', 'ภาษา | ไทย'].map(csvField).join(',');
    expect(parseCsv(`\uFEFF"a","b","c"\r\n${line}\r\n`)).toEqual([
      ['a', 'b', 'c'],
      ['ก, ข', 'say "hi"', 'ภาษา | ไทย'],
    ]);
  });

  it('reads semicolon files (Excel in many locales) and keeps commas inside fields', () => {
    expect(parseCsv('id;verdict;comment\nx;ok;a, b\n\n')).toEqual([
      ['id', 'verdict', 'comment'],
      ['x', 'ok', 'a, b'],
    ]);
  });
});
