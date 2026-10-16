import { describe, expect, it } from 'vitest';
import {
  boundariesFromSegments,
  boundariesInsideGraphemes,
  countBoundaries,
  parseGold,
  renderSpan,
  score,
  tokenAround,
} from '@/src/thai/segmentation-eval';

describe('parseGold', () => {
  it('turns bars into internal boundary offsets', () => {
    const gold = parseGold('ไป|โรงเรียน|ครับ');
    expect(gold.text).toBe('ไปโรงเรียนครับ');
    expect([...gold.boundaries]).toEqual([2, 10]);
  });

  it('ignores leading/trailing bars', () => {
    expect([...parseGold('|กิน|').boundaries]).toEqual([]);
  });
});

describe('countBoundaries', () => {
  it('scores perfect, over- and under-segmentation', () => {
    const { text, boundaries: gold } = parseGold('ไป|โรงเรียน|ครับ');
    expect(score(countBoundaries(text, gold, new Set([2, 10]))).f1).toBe(1);
    // โรง|เรียน split: one false positive.
    expect(countBoundaries(text, gold, new Set([2, 5, 10]))).toEqual({
      truePositives: 2,
      falsePositives: 1,
      falseNegatives: 0,
    });
    // โรงเรียนครับ merged: one false negative.
    expect(countBoundaries(text, gold, new Set([2]))).toEqual({
      truePositives: 1,
      falsePositives: 0,
      falseNegatives: 1,
    });
  });

  it('does not score boundaries next to spaces', () => {
    const { text, boundaries: gold } = parseGold('สวัสดี| |ครับ');
    expect(countBoundaries(text, gold, new Set())).toEqual({
      truePositives: 0,
      falsePositives: 0,
      falseNegatives: 0,
    });
  });
});

describe('score', () => {
  it('computes precision, recall and F1', () => {
    const s = score({ truePositives: 8, falsePositives: 2, falseNegatives: 8 });
    expect(s.precision).toBeCloseTo(0.8);
    expect(s.recall).toBeCloseTo(0.5);
    expect(s.f1).toBeCloseTo(0.6154, 3);
  });
});

describe('Intl.Segmenter baseline sanity', () => {
  it('never puts a word boundary inside a grapheme cluster', () => {
    const text = 'น้ำที่ปู่ญี่ปุ่นฤดูเร็วๆนี้';
    const words = new Intl.Segmenter('th', { granularity: 'word' }).segment(text);
    expect(boundariesInsideGraphemes(text, boundariesFromSegments(words, text.length))).toEqual([]);
  });

  it('detects a boundary that splits a cluster', () => {
    // offset 2 splits น้ำ between ้ and ำ
    expect(boundariesInsideGraphemes('น้ำ', new Set([2]))).toEqual([2]);
  });
});

describe('error rendering helpers', () => {
  it('shows a token with foreign boundaries inside', () => {
    const { text, boundaries } = parseGold('ไป|โรงเรียน|ครับ');
    const [start, end] = tokenAround(text, 5, boundaries);
    expect(text.slice(start, end)).toBe('โรงเรียน');
    expect(renderSpan(text, start, end, new Set([5]))).toBe('โรง|เรียน');
  });
});
