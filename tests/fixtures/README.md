# Test fixtures

## segmentation.tsv

Gold word segmentation for the Thai tokenizer (ADR 0005). Gate: boundary F1 ≥ 0.90 on Thai–Thai
boundaries (`npm run spike:seg`; a unit test enforces it once the tokenizer exists in phase 3).

Columns (tab-separated, header row): `id`, `source`, `segmented`, `note`.

- `segmented` is the original text with `|` between words. Spaces stay as they are and are their own
  tokens: `สวัสดี|ครับ| |วันนี้|…`.
- `source`: `youtube:<videoId>` for real cues (add `@<startMs>` in `id`), `seed:assistant` for the 50
  starter lines written by the coding assistant. Both need native-speaker review: the real cues so
  far were annotated by the coding assistant too (their `note` says so).

### Convention: one token = one dictionary headword

Split:

- particles: `ครับ`, `ค่ะ`, `คะ`, `นะ`, `จ้ะ`, `จ๊ะ`, `ล่ะ`, `เลย`, `ด้วย`, `หรอก`, `อะ`, `ไหม`, `มั้ย`;
- negation from the verb: `ไม่|รู้`, `ไม่|มี`, `ไม่|ได้`;
- aspect, modal and directional verbs: `จะ|ไป`, `กำลัง|กิน`, `เข้า|ไป`, `กลับ|มา`, `ได้|แล้ว`,
  `อยาก|จะ`; serial verbs after `ไป` / `มา`: `ไป|เที่ยว`, `มา|ถึง`;
- quantifier/demonstrative + classifier/noun: `ทุก|คน`, `ทุก|วัน`, `ทั้ง|วัน`, `อัน|นี้`, `ร้าน|นี้`,
  `แถว|นี้`;
- possessive `ของ` + pronoun: `ของ|เรา`;
- a verb and the complementizer `ว่า` "that": `คิด|ว่า`, `บอก|ว่า`, `เรียก|ว่า` (conjunctions stay
  whole: `แต่ว่า`, `เพราะว่า`, `ไม่ว่า`);
- compositional comparatives: `ดี|กว่า`, `มาก|กว่า`;
- `ๆ` is always its own token: `จริง|ๆ`, `ฮ่า|ๆ|ๆ`;
- numbers, Latin text, punctuation: own tokens.

Keep whole (lexicalized, has its own dictionary entry and meaning):

- time words: `วันนี้`, `พรุ่งนี้`, `เมื่อวาน`, `ตอนนี้`, `ตอนบ่าย`, `ตอนเย็น`, `ทุกวันนี้`, day
  names `วันเสาร์`, `วันจันทร์`;
- question words and tags: `ทำไม`, `อะไร`, `เท่าไหร่`, `ยังไง`, `ที่ไหน`, `ที่นี่`, `ตรงนี้`,
  `หรือเปล่า`, `หรือยัง`;
- lexicalized compounds: `โรงเรียน`, `สนามบิน`, `เครื่องบิน`, `น้ำปลา`, `ข้าวผัด`, `ต้มยำกุ้ง`,
  `แกงเขียวหวาน`, `คุณแม่`, `แม่ค้า`, `ภาษาไทย`, `ภาคใต้`, `รถติด`, `ถ่ายรูป`, `กล้องถ่ายรูป`,
  `กินข้าว`, `น่ากิน`, `เจอกัน`, `คุ้มค่า`, `ที่สุด`, `จนกว่า`, `เหมือนกัน`;
- language names: `ภาษาไทย`, `ภาษาอังกฤษ`, `ภาษาเกาหลี`;
- terms of address: `คุณแม่`, `หลวงพี่`, `หลวงพ่อ` (but a title or kin term before a name splits:
  `คุณ|ลิโอ`, `พี่|อ้อย`);
- conjunctions: `แต่ว่า`, `เพราะว่า`, `แล้วก็`, `ไม่ว่า`, `เพราะฉะนั้น`;
- `การ` / `ความ` + verb when Wiktionary has it (`ความรัก`, `การพัฒนา`, `การเรียน`); otherwise split
  (`ความ|แปลก`, `การ|แปะ|ป้าย`);
- interjections, even when the dictionary lacks them: `โอ้โห`;
- fixed expressions whose meaning has nothing to do with their parts, even without an entry:
  `แล้วแต่` "it depends", `โบยบิน` "soar";
- an ASR misspelling or garble of one word stays one word: `สภาพแวดล้ม`, `ถอสับ`, `กับข้า`;
- loanwords and brand names, one token per English word: `โอเค`, `คลิป`, `แบตเตอรี่`, `โตโยต้า`,
  `โปรโมชั่น`, `แอลกอฮอลิก`, `ยูโรเปียน|คัลเจอรัล`;
- proper names: `เชียงใหม่`, `สุวรรณภูมิ`, `สามปลื้ม`.

When unsure: if the joined form has its own Wiktionary entry with a meaning that isn't the plain sum
of its parts, keep it whole; otherwise split (`คน|โสด`, `ร้าน|กาแฟ`, `เสียง|หัวเราะ`, `ซื้อ|ของ`, all
headwords with a literal meaning). The context decides: `ที่|อยู่` "who is" vs `ที่อยู่` "address",
`วัน|ที่` "the day that" vs `วันที่` "date". Record hard cases in `note`. Unreadable ASR lines are left
out rather than guessed. The dictionary build
applies the split rules above to Wiktionary's headwords (src/thai/convention.ts, ADR 0010), so the
tokenizer follows the same convention.

### Adding real cues

1. Capture Thai json3 with the captions spike kit (`phasaSpike.save()`) in a normal Chrome profile:
   automated browsers get empty timedtext bodies.
2. `npm run -s spike:cues path/to/*.json > /tmp/new.tsv` — rows come pre-segmented by ICU.
3. Review **every** row against this convention (pre-segmentation biases toward ICU), then append.
4. `npm run seg:eval` scores the tokenizer and lists the mismatches; `npm test` enforces F1 ≥ 0.90.

### Native-speaker review

All rows, seed and real, were annotated by the coding assistant. `npm run seg:review:export` writes
a spreadsheet for a native speaker with a guide in English and Thai
([docs/segmentation-review/](../../docs/segmentation-review/GUIDE.md));
`npm run seg:review:import -- <file.csv>` applies the returned verdicts and records
`native review <date>: …` in each reviewed row's `note`.

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

## levels.csv

Hand-rated videos for calibrating the absolute level estimate (plan §7.3, ADR 0011). Done after
phase 7, together with the native-speaker review of `segmentation.tsv`. Target: 30–50
videos across the range — lessons for beginners (A1/A2), vlogs and talk (B1/B2), news, TED talks and
drama (B2+). A unit test checks that the estimate (src/analysis/levels.ts) is within one level of
the rating for at least 80 % of the rows; it is skipped while the file has no rows.

Columns (comma-separated, header row): `videoId`, `title`, `level` (A1–C2, by hand), then the
features the estimate uses — `tokens`, `outside1000`, `outside3000`, `outside5000`,
`outside10000` (shares of counted words outside the N most frequent), `speechRate` (syllables per
second), `avgCueLength` (words per line) — and a free `note`.

To add a video: watch it in a development build (`npm run dev`), open the side panel, expand the
analysis and click **Copy calibration row**. Paste the line here and fill in `level` (and `note`,
e.g. "news, studio", "kids' song"). Rate the language, not the topic: speed, vocabulary, how much
a learner at that level would follow.
