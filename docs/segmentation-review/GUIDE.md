# Thai word segmentation review — guide for the reviewer

_สรุปภาษาไทยอยู่ด้านล่าง — [Thai summary below](#สรุปภาษาไทย)._

Phasa is a free, open-source browser extension for learning Thai from YouTube videos. It splits Thai
subtitles into words so that a learner can click any word to see its meaning. To measure how well it
splits, we keep a set of about 300 subtitle lines split by hand. They were split by a non-native
speaker, so we need a native speaker to check them.

**Time:** about 1–2 hours for all rows. Checking only some rows is useful too: rows you don't mark
simply stay unreviewed.

## The file

Open `segmentation-review.csv` in **Google Sheets** (File → Import → Upload) or in Excel via **Data →
From Text/CSV** (double-clicking the file in Excel may put everything in one column).

| Column           | What it is                                                                  |
| ---------------- | --------------------------------------------------------------------------- |
| `id`             | Row id. Don't change it.                                                    |
| `type`           | `real (manual captions)`, `real (auto captions)` or `written by assistant`. |
| `video`          | The YouTube moment the line comes from, if you want to hear it (optional).  |
| `text`           | The line as the subtitles have it.                                          |
| `segmentation`   | The same line split into words: `                                           | `between words,`␣` for a space in the text. |
| `verdict`        | **You fill this in:** `ok`, `fix` or `unsure`.                              |
| `corrected`      | **For `fix`:** the corrected split.                                         |
| `comment`        | **Optional:** anything worth saying, in Thai or English.                    |
| `annotator_note` | Why the annotator split a hard case that way. Read it when a row looks odd. |

Real lines come first; they matter most.

## What to do for each row

1. Read `segmentation`. Ask: does each piece between bars form one word, by the rules below?
2. Write in `verdict`:
   - `ok` — every boundary is right;
   - `fix` — something is wrong: copy `segmentation` into `corrected` and move, add or remove `|`
     bars there. Spaces around the bars don't matter;
   - `unsure` — you aren't sure: explain briefly in `comment`, and leave the split alone.
3. **Don't change any letters**, even when the subtitles have a typo or an auto-caption error. A
   misspelled word still counts as one word (`กับข้า` for `กับข้าว` stays one piece). Keep every `␣`.
4. Rows of type `written by assistant` were made up by the annotator. If one sounds unnatural to a Thai
   speaker, say so in `comment`.

Examples:

| segmentation                        | verdict | corrected                      | why                                  |
| ----------------------------------- | ------- | ------------------------------ | ------------------------------------ |
| `ไป \| โรงเรียน \| นะ \| ครับ`      | ok      |                                | โรงเรียน is one word                 |
| `ไป \| โรง \| เรียน \| นะ \| ครับ`  | fix     | `ไป \| โรงเรียน \| นะ \| ครับ` | โรงเรียน was cut in two              |
| `ผม \| ไม่รู้ \| ครับ`              | fix     | `ผม \| ไม่ \| รู้ \| ครับ`     | ไม่ is split from the verb (rule)    |
| `ฝาก \| กด \| ซับ \| ไว้ \| ด้วย`   | ok      |                                | ซับ (subscribe) is a loanword        |
| `เขา \| ไป \| นั่ง \| ร้าน \| กาแฟ` | ok      |                                | ร้าน + กาแฟ means just "coffee shop" |

## The rules

The unit is **one dictionary word**: what a learner would look up as one entry in a Thai–English
dictionary.

**Split:**

- particles: `ครับ`, `ค่ะ`, `คะ`, `นะ`, `จ้ะ`, `ล่ะ`, `เลย`, `ด้วย`, `หรอก`, `อะ`, `ไหม`, `มั้ย`, `แหละ`;
- `ไม่` from what it negates: `ไม่|รู้`, `ไม่|มี`, `ไม่|ได้`, `ไม่|ค่อย`;
- auxiliary, modal and direction verbs: `จะ|ไป`, `กำลัง|กิน`, `อยาก|จะ`, `เข้า|ไป`, `กลับ|มา`,
  `ได้|แล้ว`; verbs after `ไป` / `มา`: `ไป|เที่ยว`, `มา|ถึง`;
- `ทุก` / `ทั้ง` + noun, classifier or noun + `นี้` / `นั้น`: `ทุก|คน`, `ทั้ง|วัน`, `อัน|นี้`,
  `ร้าน|นี้`, `แบบ|นี้`, `อย่าง|นี้`;
- comparatives: `ดี|กว่า`, `มาก|กว่า`; possessives: `ของ|เรา`;
- a verb and `ว่า` "that": `คิด|ว่า`, `บอก|ว่า`;
- `ๆ` is always its own piece: `จริง|ๆ`; numbers, Latin words and punctuation too;
- compounds whose meaning is just the sum of the parts: `ร้าน|กาแฟ`, `คน|โสด`, `เสียง|หัวเราะ`.

**Keep whole:**

- time and question words: `วันนี้`, `ตอนนี้`, `เมื่อวาน`, `ตอนบ่าย`, `วันจันทร์`, `ทำไม`, `อะไร`,
  `ยังไง`, `เท่าไหร่`, `ที่นี่`, `ตรงนี้`, `หรือเปล่า`;
- compounds with their own meaning: `โรงเรียน`, `ข้าวผัด`, `ต้มยำกุ้ง`, `กล้องถ่ายรูป`, `ตื่นเต้น`,
  `กินข้าว`, `เจอกัน`, `ที่สุด`, `เหมือนกัน`;
- conjunctions: `แต่ว่า`, `เพราะว่า`, `แล้วก็`, `ไม่ว่า`, `เพราะฉะนั้น`;
- language names and terms of address: `ภาษาไทย`, `ภาษาอังกฤษ`, `คุณแม่`, `หลวงพี่` (but a title
  before a name splits: `คุณ|ลิโอ`, `พี่|อ้อย`);
- `ความ` / `การ` + verb when it is a dictionary noun: `ความรัก`, `ความรู้สึก`, `การพัฒนา`;
- loanwords and names, one piece per foreign word: `โอเค`, `แบตเตอรี่`, `แอลกอฮอลิก`, `เชียงใหม่`.

The meaning in context decides: in `คน|ที่|อยู่|ข้าง ๆ` "the person who is next to", `ที่|อยู่` is two
words; `ที่อยู่` "address" would be one.

When a rule and your feeling as a native speaker disagree, choose `unsure` and tell us — that is
exactly the feedback we need.

## Sending it back

File → Download → **Comma-separated values (.csv)** in Google Sheets, or Save As → CSV UTF-8 in
Excel, and send the file back.

---

## สรุปภาษาไทย

เรากำลังทำส่วนขยายเบราว์เซอร์ (ฟรีและโอเพนซอร์ส) สำหรับเรียนภาษาไทยจากวิดีโอ YouTube โปรแกรมต้องตัด
ซับไตเติลภาษาไทยออกเป็นคำ เพื่อให้ผู้เรียนคลิกดูความหมายของแต่ละคำได้ ไฟล์นี้มีประมาณ 300 ประโยคที่ตัดคำ
ไว้แล้ว แต่ผู้ตัดคำไม่ใช่เจ้าของภาษา จึงอยากให้คุณช่วยตรวจว่าตัดคำถูกต้องหรือไม่ ใช้เวลาประมาณ 1–2
ชั่วโมง ตรวจเพียงบางส่วนก็มีประโยชน์

**วิธีตรวจ**

1. เปิดไฟล์ `segmentation-review.csv` ใน Google Sheets หรือ Excel
2. ดูคอลัมน์ `segmentation` คำแต่ละคำคั่นด้วยเครื่องหมาย `|` ส่วน `␣` คือช่องว่างในประโยคเดิม
3. ในคอลัมน์ `verdict` ให้ใส่
   - `ok` ถ้าตัดคำถูกต้องทั้งประโยค
   - `fix` ถ้ามีจุดผิด แล้วคัดลอกข้อความจาก `segmentation` ไปวางในคอลัมน์ `corrected`
     และแก้เฉพาะเครื่องหมาย `|` (เพิ่ม ลบ หรือย้าย)
   - `unsure` ถ้าไม่แน่ใจ และเขียนเหตุผลสั้น ๆ ในคอลัมน์ `comment`
4. ห้ามแก้ตัวอักษรหรือตัวสะกด แม้ซับไตเติลจะพิมพ์ผิด คำที่พิมพ์ผิดให้นับเป็นหนึ่งคำ และอย่าลบ `␣`
5. ประโยคประเภท `written by assistant` ผู้ช่วยแต่งขึ้นเอง ถ้าฟังดูไม่เป็นธรรมชาติ บอกได้ในคอลัมน์ `comment`

**หลักการตัดคำ:** หนึ่งคำ = หนึ่งคำในพจนานุกรม

ให้แยก:

- คำลงท้าย เช่น ครับ ค่ะ นะ เลย: `ไป|นะ|ครับ`
- `ไม่` ออกจากคำที่ตามมา: `ไม่|รู้`, `ไม่|มี`
- คำช่วยกริยาและคำบอกทิศทาง: `จะ|ไป`, `อยาก|จะ`, `เข้า|ไป`, `กลับ|มา`, `ได้|แล้ว`
- ทุก / ทั้ง กับคำนาม และลักษณนามกับ นี้ / นั้น: `ทุก|คน`, `อัน|นี้`, `ร้าน|นี้`
- คำเปรียบเทียบและของ + สรรพนาม: `ดี|กว่า`, `ของ|เรา`
- กริยา + ว่า: `คิด|ว่า`, `บอก|ว่า`
- `ๆ` แยกเป็นคำของตัวเอง: `จริง|ๆ`
- คำประสมที่มีความหมายตรงตามส่วนประกอบ: `ร้าน|กาแฟ`, `คน|โสด`

ให้ติดกัน:

- คำบอกเวลาและคำถาม: วันนี้ ตอนนี้ เมื่อวาน ทำไม อะไร ยังไง ที่นี่
- คำประสมที่มีความหมายเฉพาะ: โรงเรียน ข้าวผัด ตื่นเต้น ความรัก
- คำสันธาน: แต่ว่า เพราะว่า แล้วก็
- ชื่อภาษาและคำเรียกขาน: ภาษาไทย ภาษาอังกฤษ คุณแม่ หลวงพี่
- คำยืมและชื่อเฉพาะ: โอเค แบตเตอรี่ เชียงใหม่

ความหมายในประโยคเป็นตัวตัดสิน เช่น `คน|ที่|อยู่|ข้าง ๆ` แยก `ที่|อยู่` แต่ `ที่อยู่` (address) เป็นคำเดียว
ถ้ากฎขัดกับความรู้สึกของคุณในฐานะเจ้าของภาษา ให้ใส่ `unsure` และอธิบาย ความเห็นของคุณมีประโยชน์มาก

**เมื่อเสร็จแล้ว:** ดาวน์โหลดเป็นไฟล์ CSV (Google Sheets: File → Download → Comma-separated values)
แล้วส่งกลับมา แถวที่ไม่ได้ใส่ `verdict` จะถือว่ายังไม่ได้ตรวจ

---

## For the maintainer

- Regenerate the sheet after changing the gold set: `npm run seg:review:export`.
- Apply a returned sheet: `npm run seg:review:import -- path/to/file.csv --dry-run` to see the changes
  and errors, then without `--dry-run`. Corrected rows get their new split; every reviewed row gets
  `native review <date>: ok | corrected (was …) | unsure` and the reviewer's comment in its `note`.
  Rows whose text changed are reported and skipped.
- Then `npm run seg:eval` and `npm test`, and update the numbers in ADR 0010 and the README.
