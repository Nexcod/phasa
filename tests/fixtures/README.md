# Test fixtures

## segmentation.tsv

Gold word segmentation for the Thai tokenizer (ADR 0005). Gate: boundary F1 ≥ 0.90 on Thai–Thai
boundaries (`pnpm spike:seg`; a unit test enforces it once the tokenizer exists in phase 3).

Columns (tab-separated, header row): `id`, `source`, `segmented`, `note`.

- `segmented` is the original text with `|` between words. Spaces stay as they are and are their own
  tokens: `สวัสดี|ครับ| |วันนี้|…`.
- `source`: `youtube:<videoId>` for real cues (add `@<startMs>` in `id`), `seed:assistant` for the 50
  starter lines written by the coding assistant — those need native-speaker review.

### Convention: one token = one dictionary headword

Split:

- particles: `ครับ`, `ค่ะ`, `คะ`, `นะ`, `จ้ะ`, `จ๊ะ`, `ล่ะ`, `เลย`, `ด้วย`, `หรอก`, `อะ`, `ไหม`, `มั้ย`;
- negation from the verb: `ไม่|รู้`, `ไม่|มี`, `ไม่|ได้`;
- aspect, modal and directional verbs: `จะ|ไป`, `กำลัง|กิน`, `เข้า|ไป`, `กลับ|มา`, `ได้|แล้ว`;
- quantifier/demonstrative + classifier/noun: `ทุก|คน`, `ทุก|วัน`, `อัน|นี้`, `ร้าน|นี้`;
- compositional comparatives: `ดี|กว่า`, `มาก|กว่า`;
- `ๆ` is always its own token: `จริง|ๆ`, `ฮ่า|ๆ|ๆ`;
- numbers, Latin text, punctuation: own tokens.

Keep whole (lexicalized, has its own dictionary entry and meaning):

- time words: `วันนี้`, `พรุ่งนี้`, `เมื่อวาน`, `ตอนนี้`;
- question words: `ทำไม`, `อะไร`, `เท่าไหร่`, `ยังไง`, `ที่ไหน`, `ที่นี่`;
- lexicalized compounds: `โรงเรียน`, `สนามบิน`, `เครื่องบิน`, `น้ำปลา`, `ข้าวผัด`, `แกงเขียวหวาน`,
  `คุณแม่`, `แม่ค้า`, `ภาษาไทย`, `ภาคใต้`, `รถติด`, `ถ่ายรูป`, `คุ้มค่า`, `ที่สุด`, `จนกว่า`, `เหมือนกัน`;
- loanwords and brand names: `โอเค`, `คลิป`, `แบตเตอรี่`, `โตโยต้า`, `โปรโมชั่น`;
- proper names: `เชียงใหม่`, `สุวรรณภูมิ`.

When unsure: if the joined form has its own Wiktionary entry with a meaning that isn't the plain sum
of its parts, keep it whole; otherwise split. Record hard cases in `note`.

### Adding real cues

1. Capture Thai json3 with the captions spike kit (`phasaSpike.save()`).
2. `pnpm spike:cues path/to/*.json > /tmp/new.tsv` — rows come pre-segmented by ICU.
3. Review **every** row against this convention (pre-segmentation biases toward ICU), then append.

## captions/

Real `/api/timedtext` responses (contract fixtures, docs/plan.md §13), captured 2026-10-16 from a
logged-in Chrome session and trimmed to the first ~45 s so the files stay small. If YouTube changes
the format, `tests/unit/captions-parse.test.ts` fails first.

| File                                    | Track                              | Format                          |
| --------------------------------------- | ---------------------------------- | ------------------------------- |
| `iH31BMKBEdU.a.th.json3.json`           | Thai, auto-generated               | json3 (what the player asks for) |
| `iH31BMKBEdU.a.th.tlang-en.json3.json`  | same, YouTube translation `tlang=en` | json3                         |
| `iH31BMKBEdU.a.th.srv3.xml`             | Thai, auto-generated               | srv3                            |
| `iH31BMKBEdU.a.th.srv1.xml`             | Thai, auto-generated               | srv1 (no `fmt`)                 |
| `iH31BMKBEdU.a.th.vtt`                  | Thai, auto-generated               | WebVTT (rolling two-line cues)  |
| `pxLHURprYuI.th.json3.json`             | Thai, manual (a 2-cue stub)        | json3, pretty-printed           |
| `uYEW8BeJ0zY.en.json3.json`             | English, manual                    | json3                           |

Bodies contain no tokens or cookies; the request URLs (which carry the PoToken) are not stored.

## media/

`blank-120s.webm`: 120 s of a dark frame, VP8, 10 fps, keyframe every second, for real playback,
seeking and `requestVideoFrameCallback` in e2e tests. Regenerate with:

```sh
ffmpeg -f lavfi -i "color=c=0x202020:s=160x90:r=10:d=120" -c:v libvpx -b:v 8k -g 10 -an tests/fixtures/media/blank-120s.webm
```
