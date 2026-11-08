import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { added, check, findQuote, parseRaw, quotesOn, shareFrom, vanished, words } from "../scripts/check-distilled.mjs";

const script = fileURLToPath(new URL("../scripts/check-distilled.mjs", import.meta.url));
const run = (cwd, args) =>
  new Promise((finish) => execFile(process.execPath, [script, ...args], { cwd, encoding: "utf8" }, (err, stdout, stderr) => finish({ status: err ? err.code : 0, stdout, stderr })));

const stamp = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00`;
/** A source with one caption a minute, each 30 words. */
const rawOf = (minutes, extra = "") =>
  `---\ntitle: "A Talk"\nsource: youtube\nid: abc\nurl: https://youtube.com/watch?v=abc\npublished: 2020-01-02\n---\n\n## Description\n\nGuest: Ann Lee\n\n## Transcript\n\n` +
  Array.from({ length: minutes }, (_, m) => `L${String(m + 1).padStart(4, "0")} ${stamp(m)} ${m === 0 ? `the budget is a dumb rule ${extra} ` : ""}${"word ".repeat(30).trim()}`).join("\n") + "\n";
const front = `---\ntitle: "A Talk"\nsource: youtube\nurl: https://youtube.com/watch?v=abc\npublished: 2020-01-02\ntopics: [talks]\n---\n\n`;
const body = (w) => "kept ".repeat(w).trim();
const section = (m, text = body(50), topics = "budgets") => `## ${stamp(m)} | ${topics}\n\n${text}\n\n`;
const problems = (text, raw = rawOf(10)) => check("d.md", text, raw).problems;

test("a good distillation passes", () => {
  assert.deepEqual(problems(front + section(0, `He calls it "a dumb rule". ${body(50)}`) + section(5)), []);
});

test("front matter: missing, missing fields, and fields that differ from the source", () => {
  assert.match(problems(section(0) + section(5))[0], /d\.md:1: no front matter/);
  const found = problems(`---\ntitle: "Other"\nsource: youtube\nurl: https://youtube.com/watch?v=abc\n---\n\n` + section(0) + section(5));
  assert.ok(found.some((p) => /title is "Other"; the source says "A Talk"/.test(p)));
  assert.ok(found.some((p) => /published is "missing"/.test(p)));
});

test("a field the source lacks is not required", () => {
  const raw = rawOf(10).replace("published: 2020-01-02\n", "");
  assert.deepEqual(problems(front.replace("published: 2020-01-02\n", "") + section(0) + section(5), raw), []);
});

test("sections: a timestamp is required, topics are not, and there must be some", () => {
  assert.deepEqual(problems(front + section(0, `He calls it "a dumb rule". ${body(50)}`, " ") + section(5)), []);
  assert.deepEqual(problems(`---\ntitle: "A Talk"\nsource: youtube\nurl: https://youtube.com/watch?v=abc\npublished: 2020-01-02\n---\n\n## 00:00:00\n\nHe calls it "a dumb rule". ${body(50)}\n\n## 00:05:00\n\n${body(50)}\n`), []);
  assert.ok(problems(`${front}## Opening | budgets\n\ntext\n`).some((p) => /write its timestamp as 00:03:12/.test(p)));
  assert.ok(problems(front + "just text\n").some((p) => /no sections/.test(p)));
});

test("coverage: a late start, stopping early, a long section and order", () => {
  assert.ok(problems(front + section(5)).some((p) => /starts at 00:05:00; the source starts at 00:00:00/.test(p)));
  const raw = rawOf(60);
  const stops = problems(front + Array.from({ length: 6 }, (_, i) => section(i * 7)).join(""), raw);
  assert.ok(stops.some((p) => /last section starts at 00:35:00 and the source runs to 00:59:00; read and write to the end/.test(p)), stops.join("\n"));
  assert.ok(problems(front + section(0) + section(10), rawOf(12)).some((p) => /9\.0 minutes in one section; split it/.test(p)));
  assert.ok(problems(front + section(5) + section(0)).some((p) => /out of order/.test(p)));
});

test("a skimmed stretch stands out, unless the dropped part is noted", () => {
  const raw = rawOf(30);
  const parts = (middle) => front + section(0, body(100)) + section(5, body(100)) + section(10, middle) + section(15, body(100)) + section(20, body(100)) + section(25, body(100));
  const found = problems(parts(body(10)), raw);
  assert.equal(found.length, 1, found.join("\n"));
  assert.match(found[0], /00:10:00 to 00:15:00 keeps 10 words of 150, against about 67% elsewhere/);
  assert.deepEqual(problems(parts(`(00:10:30 to 00:14:00: sponsor read)\n${body(10)}`), raw), []);
});

test("quotes: a reworded one fails with the fix, on its line", () => {
  const found = problems(front + section(0, `He says "a stupid rule". ${body(50)}`) + section(5));
  assert.equal(found.length, 1);
  assert.match(found[0], /^d\.md:11: quote not in the source: "a stupid rule"; copy the words from the source or drop the quotation marks/);
});

test("quotes: ellipses, brackets, the description, curly quotes", () => {
  const raw = rawOf(10);
  for (const ok of [`"the budget ... dumb rule"`, `"the budget [unclear] a dumb rule"`, `"Guest: Ann Lee"`, `“a dumb rule”`]) {
    assert.deepEqual(problems(front + section(0, `${ok} ${body(50)}`) + section(5), raw), [], ok);
  }
  assert.ok(problems(front + section(0, `"the budget ... clever rule" ${body(50)}`) + section(5), raw).length);
});

test("an unmatched quotation mark is named", () => {
  assert.ok(problems(front + section(0, `He says "a dumb rule. ${body(50)}`) + section(5)).some((p) => /quotation mark is unmatched/.test(p)));
  assert.deepEqual(quotesOn('a "b" c').quotes, ["b"]);
  assert.equal(quotesOn('a "b c').odd, true);
});

test("a quote tolerates stumbling, never a word changed or skipped that changes the meaning", () => {
  const match = (quote, said) => {
    const source = words(said);
    const at = new Map();
    source.forEach((w, i) => (at.get(w) ?? at.set(w, []).get(w)).push(i));
    return findQuote(words(quote), source, at) >= 0;
  };
  assert.ok(match("they're addicted to money", "that they they're uh addicted to to money"));
  assert.ok(match("sell half of it", "sell uh half you know of of it"));
  assert.ok(!match("numbskulls at banks", "people at banks"));
  assert.ok(!match("this is safe", "this is not safe"), "never skips a negation");
  assert.ok(!match("we raised 220 billion", "we raised 200 billion"));
  assert.ok(!match("it will increase", "it will decrease"));
  assert.ok(!match("it was legal", "it was illegal"));
  assert.ok(!match("I was wrong", "you was wrong"));
  assert.ok(!match("high reward", "high ward"), "inside quotes, copy the captions");
  assert.ok(!match("not rich", "not just rich"));
  assert.ok(!match("are criminals", "are like criminals"));
  assert.ok(!match("was fraud", "was kind of fraud"));
});

test("quotes in other languages and scripts are checked", () => {
  const quoted = (said, q) => problems(front + section(0, `${q} ${body(50)}`) + section(5), rawOf(10, said)).filter((p) => /quote not/.test(p)).length;
  assert.equal(quoted("c'est la vie mon ami", "«c'est la vie»"), 0);
  assert.equal(quoted("c'est la vie mon ami", "«c'est la mort»"), 1);
  assert.equal(quoted("das ist gut", "„das ist gut“"), 0);
  assert.equal(quoted("今天天气很好我们去公园", "「天气很好」"), 0);
  assert.equal(quoted("我喜欢大学生活", "「大学生活」"), 0);
  assert.equal(quoted("das ist gut", "»das ist gut«"), 0);
  assert.equal(quoted("das ist gut", "»das ist schlecht«"), 1);
  assert.equal(quoted("det är bra", "”det är dåligt”"), 1);
  assert.equal(quoted("今天天气很好我们去公园", "「天气很坏」"), 1);
  assert.equal(quoted("สวัสดีครับ วันนี้อากาศดี", '"อากาศดี"'), 0);
  assert.equal(quoted("सब ठीक है", '"सब ठीक है"'), 0);
  assert.equal(quoted("सब ठीक है", '"सब ठाक है"'), 1, "a changed vowel is a changed word");
  assert.deepEqual(quotesOn('צה"ל אמר').quotes, []);
  assert.equal(quotesOn('צה"ל אמר').odd, false);
});

test("a quote stitched from far apart fails", () => {
  const raw = `---\ntitle: "A Talk"\n---\n\n## Transcript\n\nL0001 00:00:00 opening line ${"word ".repeat(500)} closing line\n`;
  assert.ok(problems(`---\ntitle: "A Talk"\nsource: youtube\ntopics: [x]\n---\n\n## 00:00:00 | talks\n\n"opening line ... closing line" ${body(150)}\n`, raw).some((p) => /quote not/.test(p)));
});

test("a true quote passes when its first part also occurs earlier; another script's source skips the name check", () => {
  const raw = `---\ntitle: "A Talk"\n---\n\n## Transcript\n\nL0001 00:00:00 opening line ${"word ".repeat(500)} opening line and closing line\n`;
  assert.ok(!problems(`---\ntitle: "A Talk"\nsource: youtube\ntopics: [x]\n---\n\n## 00:00:00 | talks\n\n"opening line ... closing line" ${body(150)}\n`, raw).some((p) => /quote not/.test(p)));
  const russian = `---\ntitle: "T"\n---\n\n## Transcript\n\nL0001 00:00:00 ${"слово ".repeat(40)}\n`;
  assert.deepEqual(addedTo("Then he met with Ivanov there.\n", russian), []);
  const germanDoc = `---\ntitle: "T"\n---\n\nDas ist der Hund und die Katze im Haus mit dem Ball\n`;
  assert.deepEqual(addedTo("sie sah den Vogel dort.\n", germanDoc), []);
});

test("words: any script, with apostrophes kept in the word", () => {
  assert.deepEqual(words("They're  OK"), ["theyre", "ok"]);
  assert.ok(words("今天天气很好").length > 1, "Chinese is segmented");
});

test("vanished numbers and names are listed and do not fail", () => {
  const { numbers, names } = vanished("It cost 1,000 and Ann came.", [{ text: "it cost $1,000 and then 45% of them met Ann and later met Bob at home and saw Bob and Sue" }]);
  assert.deepEqual(numbers, ["45%"]);
  assert.deepEqual(names, ["Bob"]);
});

test("--help and -h print usage; bad input prints a Try line and nothing on stdout", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "nook-check-"));
  for (const h of ["--help", "-h"]) {
    const r = await run(cwd, [h]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /usage: node scripts\/check-distilled\.mjs/);
  }
  for (const [args, status] of [[[], 2], [["a", "b"], 2], [["a.md", "--nope"], 2], [["missing.md"], 1], [["."], 1]]) {
    const r = await run(cwd, args);
    assert.equal(r.status, status, args.join(" "));
    assert.equal(r.stdout, "");
    assert.match(r.stderr, /Try: /);
  }
});

test("it finds the source by name, reports on stdout when passing and stderr when not", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "nook-check-"));
  mkdirSync(join(cwd, "raw/youtube/chan"), { recursive: true });
  mkdirSync(join(cwd, "distilled/youtube/chan"), { recursive: true });
  writeFileSync(join(cwd, "raw/youtube/chan/x.md"), rawOf(10));
  writeFileSync(join(cwd, "distilled/youtube/chan/x.md"), front + section(0) + section(5));
  const good = await run(cwd, ["distilled/youtube/chan/x.md"]);
  assert.equal(good.status, 0, good.stderr);
  assert.match(good.stdout, /^check-distilled: distilled\/youtube\/chan\/x\.md passed, 2 sections/);

  writeFileSync(join(cwd, "distilled/youtube/chan/x.md"), front + section(0, `"never said this" ${body(50)}`) + section(5));
  const bad = await run(cwd, ["distilled/youtube/chan/x.md"]);
  assert.equal(bad.status, 1);
  assert.equal(bad.stdout, "");
  assert.match(bad.stderr, /has 1 problem\n {2}distilled\/youtube\/chan\/x\.md:11: quote not in the source/);
  assert.match(bad.stderr, /Try: fix those, then node scripts\/check-distilled\.mjs/);

  writeFileSync(join(cwd, "distilled/youtube/chan/orphan.md"), "text");
  const orphan = await run(cwd, ["distilled/youtube/chan/orphan.md"]);
  assert.equal(orphan.status, 1);
  assert.match(orphan.stderr, /no source found/);
});

const listing = (body) => body.split("\n");
const addedTo = (text, raw = rawOf(10, "paid Belunteer 45 dollars")) => added(listing(front + text), 8, raw).map((a) => a.msg);

test("a name or number the source lacks fails; what it has does not", () => {
  assert.deepEqual(addedTo("He paid Belunteer 45 dollars and a budget.\n"), []);
  assert.match(addedTo("He bought from Belantir then.\n")[0], /the name Belantir is not in the source/);
  assert.match(addedTo("He paid 450 dollars.\n")[0], /the number 450 is not in the source/);
  const scaled = rawOf(10, "raised 4 billion and five million");
  assert.deepEqual(addedTo("He raised 4 billion, then 5 million.\n", scaled), []);
  assert.match(addedTo("He raised 5 billion.\n", scaled)[0], /5 billion is not in the source/);
  const big = rawOf(10, "raised 20 million and 3.5 of it");
  assert.match(addedTo("He raised 20 billion.\n", big)[0], /20 billion is not in the source/);
  assert.match(addedTo("He kept 35 of it.\n", big)[0], /the number 35 is not in the source/);
  assert.deepEqual(addedTo("Guidance rose to 220 billion, and 90% of them agreed.\n", rawOf(10, "said 200 billion then raised to 220 with 90 to 95% of them")), [], "a scale the source implies is fair");
  assert.match(addedTo("He kept ٤٥ of it.\n", rawOf(10))[0], /٤٥ is not in the source/);
});

test("a declared caption fix passes, everywhere in the file; a false one fails", () => {
  assert.deepEqual(addedTo("He paid Belantir [caption: Belunteer] 45 dollars, and later saw Belantir again.\n"), []);
  assert.deepEqual(addedTo("He paid 145 [caption: 45] dollars.\n"), []);
  assert.match(addedTo("He paid Belantir [caption: Northway] then.\n")[0], /is not what the captions say/);
});

test("another word is not a spelling of a name, and a language that capitalizes nouns gets no name check", () => {
  const raw = rawOf(10, "like a dumb rule");
  assert.match(addedTo("He met with Mike then.\n", raw)[0], /the name Mike/);
  assert.match(addedTo("He met with Nico then.\n", rawOf(10, "that was nice"))[0], /the name Nico/);
  assert.match(addedTo("He met with SEN then.\n", rawOf(10, "one sentence"))[0], /the name SEN/);
  const german = `---\ntitle: "T"\n---\n\n## Transcript\n\nL0001 00:00:00 das ist der Hund und die Katze im Haus mit dem Ball\n`;
  assert.deepEqual(addedTo("sie sah den Vogel dort.\n", german), []);
});

test("a timestamp or a sentence start is not an added number or name", () => {
  assert.deepEqual(addedTo("Budget talk. (00:10:30 to 00:14:00: sponsor read) Then at 00:12:15 a budget.\n"), []);
});

test("speech outside 20% to 40% fails, and a short source does not", () => {
  const raw = rawOf(60);
  const parts = (w) => front + Array.from({ length: 12 }, (_, i) => section(i * 5, body(w))).join("");
  const shareProblems = (text, ...rest) => check("d.md", text, raw, ...rest).problems.filter((p) => /% of the source/.test(p));
  assert.deepEqual(shareProblems(parts(50)), []);
  assert.match(shareProblems(parts(100))[0], /d\.md:1: \d+ words is \d+% of the source's \d+; say each idea once/);
  assert.match(shareProblems(parts(20))[0], /that loses too much/);
  assert.deepEqual(problems(front + section(0, body(400)) + section(5, body(400))).filter((p) => /% of the source/.test(p)), []);
});

test("the owner's SITE.md changes the share", () => {
  assert.deepEqual(shareFrom("# This site\n\nDistillation length: 30% to 60%\n"), { min: 30, max: 60 });
  assert.deepEqual(shareFrom("no such line"), { min: 20, max: 40 });
  const raw = rawOf(60);
  const text = front + Array.from({ length: 12 }, (_, i) => section(i * 5, body(100))).join("");
  assert.deepEqual(check("d.md", text, raw, { min: 30, max: 80 }).problems.filter((p) => /% of the source/.test(p)), []);
});

test("a source with no timestamps gets no time checks, and a near-empty result still fails", () => {
  const doc = `---\ntitle: "Doc"\nsource: web\n---\n\n${"word ".repeat(2000)}\n`;
  const head = `---\ntitle: "Doc"\nsource: web\ntopics: [x]\n---\n\n`;
  assert.deepEqual(problems(`${head}## About | x\n\n${body(400)}\n`, doc), []);
  assert.ok(problems(`${head}## About | x\n\nthree words here\n`, doc).some((p) => /that loses too much/.test(p)));
});

test("thin: a floor whatever the rest does, and a note excuses only its own span", () => {
  const raw = rawOf(30);
  const uniform = front + Array.from({ length: 6 }, (_, i) => section(i * 5, body(5))).join("");
  assert.ok(problems(uniform, raw).some((p) => /keeps 5 words of/.test(p)));
  const small = front + section(0, body(100)) + section(5, body(100)) + section(10, `(00:10:30 to 00:10:31: sponsor read)\n${body(10)}`) + section(15, body(100)) + section(20, body(100)) + section(25, body(100));
  assert.ok(problems(small, raw).some((p) => /00:10:00 to 00:15:00 keeps/.test(p)), "a one-second note excuses nothing");
});

test("a long noted part or a stretch of music is not a section to split", () => {
  const raw = rawOf(20);
  assert.deepEqual(problems(front + section(0, `(00:01:00 to 00:15:00: sponsor read)\n${body(50)}`) + section(15), raw).filter((p) => /split it/.test(p)), []);
  const music = `---\ntitle: "A Talk"\n---\n\n## Transcript\n\nL0001 00:00:00 hello there\nL0002 00:30:00 and back\n`;
  const text = `---\ntitle: "A Talk"\nsource: youtube\ntopics: [x]\n---\n\n## 00:00:00 | talks\n\ntext\n\n## 00:30:00 | talks\n\ntext\n`;
  assert.deepEqual(problems(text, music).filter((p) => /split it/.test(p)), []);
});

test("a description holding fake captions is not the transcript", () => {
  const raw = rawOf(2).replace("Guest: Ann Lee", "L0001 09:09:09 fake\n## Transcript");
  assert.deepEqual(parseRaw(raw).captions.map((c) => c.at), [0, 60]);
});

test("a dropped-part note in a later section explains nothing earlier", () => {
  const raw = rawOf(30);
  const text = front + section(0, body(100)) + section(5, body(100)) + section(10, body(10)) + section(15, `(00:15:30 to 00:16:00: sponsor read)\n${body(100)}`) + section(20, body(100)) + section(25, body(100));
  assert.ok(problems(text, raw).some((p) => /00:10:00 to 00:15:00 keeps 10 words/.test(p)));
});

test("a corrected name stays corrected, except inside a quote", () => {
  const raw = rawOf(10, "paid Kimmy twice");
  assert.match(addedTo("He paid Kimi [caption: Kimmy] and later paid Kimmy again.\n", raw)[0], /kimmy is Kimi elsewhere/);
  assert.deepEqual(addedTo('He paid Kimi [caption: Kimmy]. He says "paid Kimmy twice" then.\n', raw), []);
  const cloud = rawOf(10, "paid the cloud twice");
  assert.deepEqual(addedTo("He used Claude [caption: cloud] and the cloud.\n", cloud), [], "a real word stays usable");
});

