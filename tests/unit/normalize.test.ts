import { describe, expect, it } from 'vitest';
import { boundariesInsideGraphemes } from '@/src/thai/segmentation-eval';
import { normalizeThai, searchKey, toArabicDigits, toThaiDigits } from '@/src/thai/normalize';

const ZWSP = String.fromCharCode(0x200b);
const ZWNJ = String.fromCharCode(0x200c);
const BOM = String.fromCharCode(0xfeff);
const NBSP = String.fromCharCode(0xa0);
const NIKHAHIT = String.fromCharCode(0x0e4d);
const SARA_AA = String.fromCharCode(0x0e32);
const MAI_THO = String.fromCharCode(0x0e49);
const MAI_EK = String.fromCharCode(0x0e48);
const SARA_II = String.fromCharCode(0x0e35);
const SARA_E = String.fromCharCode(0x0e40);

/** Every normalized range maps back to the source text it came from. */
function expectMapConsistent(source: string): void {
  const { text, toSource } = normalizeThai(source);
  expect(toSource).toHaveLength(text.length + 1);
  for (let i = 1; i < toSource.length; i++)
    expect(toSource[i]).toBeGreaterThanOrEqual(toSource[i - 1]!);
  expect(toSource.at(-1)).toBeLessThanOrEqual(source.length);
}

describe('normalizeThai', () => {
  it('leaves clean text alone with an identity map', () => {
    const { text, toSource, boundaryHints } = normalizeThai('สวัสดีครับ');
    expect(text).toBe('สวัสดีครับ');
    expect(toSource).toEqual([...Array(11).keys()]);
    expect(boundaryHints).toEqual([]);
  });

  it('removes zero-width characters and keeps them as boundary hints', () => {
    const source = `ไป${ZWSP}โรงเรียน${ZWNJ}ครับ${BOM}`;
    const { text, toSource, boundaryHints } = normalizeThai(source);
    expect(text).toBe('ไปโรงเรียนครับ');
    expect(boundaryHints).toEqual([2, 10]);
    // "โรงเรียน" in the output maps back to its source characters; a removed
    // character between two kept ones belongs to the range before it.
    expect(source.slice(toSource[2], toSource[10])).toBe(`โรงเรียน${ZWNJ}`);
    expect(source.slice(toSource[0], toSource[2])).toBe(`ไป${ZWSP}`);
    expect(boundariesInsideGraphemes(text, new Set(boundaryHints))).toEqual([]);
  });

  it('drops hints at the edges and next to spaces', () => {
    expect(normalizeThai(`${ZWSP}กิน ${ZWSP}ข้าว${ZWSP}`).boundaryHints).toEqual([]);
  });

  it('fixes nikhahit + sara aa typed instead of sara am', () => {
    expect(normalizeThai(`น${NIKHAHIT}${SARA_AA}`).text).toBe('นำ');
    // Nikhahit typed before the tone mark: น ํ ้ า → น้ำ
    expect(normalizeThai(`น${NIKHAHIT}${MAI_THO}${SARA_AA}`).text).toBe('น้ำ');
    expect(normalizeThai(`น${MAI_THO}${NIKHAHIT}${SARA_AA}`).text).toBe('น้ำ');
  });

  it('fixes two sara e typed instead of sara ae', () => {
    expect(normalizeThai(`${SARA_E}${SARA_E}ม่`).text).toBe('แม่');
  });

  it('puts the vowel before the tone mark and drops doubled marks', () => {
    expect(normalizeThai(`ก${MAI_EK}${SARA_II}`).text).toBe('กี่');
    expect(normalizeThai(`ก${MAI_EK}${MAI_EK}`).text).toBe('ก่');
  });

  it('collapses whitespace, including no-break spaces and newlines, and trims', () => {
    const { text, toSource } = normalizeThai(`  กิน${NBSP}${NBSP}ข้าว\nแล้ว  `);
    expect(text).toBe('กิน ข้าว แล้ว');
    expect(toSource[0]).toBe(2);
  });

  it('applies NFC to Latin text inside Thai lines', () => {
    const decomposed = 'cafe' + String.fromCharCode(0x0301);
    expect(normalizeThai(`ร้าน ${decomposed}`).text).toBe('ร้าน café');
  });

  it('keeps the offset map monotonic through every fix', () => {
    for (const source of [
      `น${NIKHAHIT}${MAI_THO}${SARA_AA}${ZWSP}${SARA_E}${SARA_E}ม่`,
      `  a${NBSP}b${ZWSP}${ZWSP}ค `,
      `ก${MAI_EK}${SARA_II}${MAI_EK}`,
      '',
    ]) {
      expectMapConsistent(source);
    }
  });

  it('never moves a boundary hint inside a grapheme cluster', () => {
    const source = `น้ำ${ZWSP}ที่${ZWSP}ปู่${ZWSP}ญี่ปุ่น`;
    const { text, boundaryHints } = normalizeThai(source);
    expect(boundaryHints).toHaveLength(3);
    expect(boundariesInsideGraphemes(text, new Set(boundaryHints))).toEqual([]);
  });
});

describe('digits', () => {
  it('maps Thai digits to Arabic and back, preserving length', () => {
    expect(toArabicDigits('ปี ๒๕๖๙')).toBe('ปี 2569');
    expect(toThaiDigits('2569')).toBe('๒๕๖๙');
    expect(searchKey(`ห้อง ๑๒${ZWSP}`)).toBe('ห้อง 12');
  });
});
