import { describe, expect, it } from 'vitest';
import { parseWordList } from '@/src/vocab/import';

describe('parseWordList', () => {
  it('reads one word per line from plain text', () => {
    expect(parseWordList('ผม\r\nกิน\n\nข้าว\n')).toEqual({
      words: ['ผม', 'กิน', 'ข้าว'],
      skipped: 0,
    });
  });

  it('takes the first column of a CSV, with quotes, and skips a header', () => {
    const csv = 'word,meaning\nกิน,to eat\n"ข้าว, สวย","rice, cooked"\n"คำ ""พิเศษ""",x\n';
    expect(parseWordList(csv)).toEqual({ words: ['กิน', 'ข้าว, สวย', 'คำ "พิเศษ"'], skipped: 1 });
  });

  it('reads an Anki "Notes in Plain Text" export', () => {
    const anki = [
      '#separator:tab',
      '#html:true',
      '#tags column:3',
      'ภาษา<br>ไทย\tThai language\tthai::vocab',
      '"<b>กิน</b>"\tto eat\t',
      'สวัสดี&nbsp;ครับ\thello\t',
      'hello\tสวัสดี\t',
    ].join('\n');
    expect(parseWordList(anki)).toEqual({
      words: ['ภาษา ไทย', 'กิน', 'สวัสดี ครับ'],
      skipped: 1,
    });
  });

  it('drops a byte order mark and repeated words', () => {
    expect(parseWordList('﻿ผม\nผม\n ผม \n')).toEqual({ words: ['ผม'], skipped: 0 });
  });
});
