export type Tone = 'mid' | 'low' | 'falling' | 'high' | 'rising';

export type TokenKind = 'thai' | 'latin' | 'number' | 'punct' | 'space' | 'repeat';

/** Offsets are UTF-16 indices into the normalized text and always fall on grapheme boundaries. */
export interface Token {
  text: string;
  start: number;
  end: number;
  kind: TokenKind;
}

export interface ThaiTokenizer {
  tokenize(text: string): Token[];
}
