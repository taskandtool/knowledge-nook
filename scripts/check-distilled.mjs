#!/usr/bin/env node
// Is a source's read complete and honest to it? What can be answered by
// comparing the two files, with no AI: front matter, coverage to the end, length,
// thin stretches, quotes, and names and numbers added or dropped. Any language.
import { existsSync, readFileSync, statSync } from "node:fs";
import { relative } from "node:path";
import { pathToFileURL } from "node:url";
import { done, fail, flag, misused, parseArgs, plain } from "../src/data/cli.mjs";

const HELP = `usage: node scripts/check-distilled.mjs <distilled file> [--raw <raw file>]

Checks one distillation against its source, found at the same path under raw/ unless
--raw names it. Failures say the line, what is wrong and what to do:

  check-distilled: distilled/youtube/chan/x.md has 2 problems
    distilled/youtube/chan/x.md:40: quote not in the source: "..."; copy the words from the source or drop the quotation marks
    distilled/youtube/chan/x.md:52: 00:40:10 to 00:51:00 is 10.8 minutes in one section; split it
    Try: fix those, then node scripts/check-distilled.mjs distilled/youtube/chan/x.md

It fails on quotes, names and numbers the source lacks, on speech kept outside 20% to
40% of its words (SITE.md can change that), and on stretches left thin. It lists
numbers and names the source repeats and the distillation lacks. Those do not fail:
keep any that matter.

Exit 0 passed, 1 has problems, 2 used wrongly.`;

/** The longest one section may run before citations stop landing near the moment. */
const MAX_SECTION_MINUTES = 8;
/** How far from the source's end the last section may start. */
const MAX_END_MINUTES = 8;
/** Below this share of the source's usual density, a section is a skim. */
const THIN_SHARE = 0.3;
/** Below this share of its own words, a section is a skim whatever the rest does. */
const THIN_FLOOR = 0.05;
/** Speech repeats itself: outside this share of its words, a distillation retells it or loses it. */
const SPEECH_SHARE = { min: 20, max: 40 };
/** A page or document has no such rhythm, so only a near-empty distillation is plainly wrong. */
const DOCUMENT_MIN_SHARE = 5;
/** Below this many words a source has too little to measure. */
const MIN_TO_MEASURE = 1500;
/** Mid-sentence capitals in over this share of a source's words: its language capitalizes nouns. */
const NOUN_CAPITALS = 0.08;
const SHOWN = 25;

const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
const seconds = (/** @type {string} */ t) => t.split(":").reduce((n, p) => n * 60 + Number(p), 0);
const stamp = (/** @type {number} */ s) => [s / 3600, (s / 60) % 60, s % 60].map((v) => String(Math.floor(v)).padStart(2, "0")).join(":");

/** Words in any script, lowercase, without apostrophes; Chinese and Thai have no spaces to split on. */
export function words(/** @type {string} */ text) {
  const clean = text.normalize("NFC").toLowerCase().replace(/['’]/g, "");
  return [...segmenter.segment(clean)].filter((s) => s.isWordLike).map((s) => s.segment);
}

/** Said while thinking, so a tidy quote may leave them out. Never a word that changes it: "just", "like", "not". */
const SOFT = new Set("um uh er ah you know i mean so yeah right okay ok and the a an".split(" "));

/**
 * Each place a quote ends in the source. Its words must come in order. The source
 * may hold more only where a speaker stumbled: a soft word, a repeat, or the start of
 * the next word ("they they're"). Skipping anything else could flip the meaning.
 */
export function* quoteEnds(/** @type {string[]} */ quote, /** @type {string[]} */ source, /** @type {Map<string, number[]>} */ at, from = 0, within = Infinity) {
  if (!quote.length) {
    yield from;
    return;
  }
  for (const start of at.get(quote[0]) ?? []) {
    if (start < from || start > from + within) continue;
    let q = 1;
    let i = start + 1;
    while (q < quote.length && i < source.length) {
      if (source[i] === quote[q]) q++;
      else if (!(SOFT.has(source[i]) || source[i] === quote[q - 1] || quote[q].startsWith(source[i]))) break;
      i++;
    }
    if (q === quote.length) yield i;
  }
}

export function findQuote(/** @type {string[]} */ quote, /** @type {string[]} */ source, /** @type {Map<string, number[]>} */ at, from = 0, within = Infinity) {
  for (const end of quoteEnds(quote, source, at, from, within)) return end;
  return -1;
}

/** Words in scripts with no spaces, where a word's edges depend on what surrounds it. */
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

/** Each part of a quote cut with ... or [unclear], in order and from one stretch of the source. */
export function quoteInSource(/** @type {string} */ quote, /** @type {string[]} */ source, /** @type {Map<string, number[]>} */ at) {
  const parts = quote.split(/\.\.\.|…|\[[^\]]*\]/).map(words).filter((p) => p.length);
  if (UNSPACED.test(quote)) {
    const joined = source.join("");
    let from = 0;
    return parts.every((p) => {
      const found = joined.indexOf(p.join(""), from);
      from = found + 1;
      return found >= 0;
    });
  }
  const rest = (/** @type {number} */ n, /** @type {number} */ from) => {
    if (n === parts.length) return true;
    for (const end of quoteEnds(parts[n], source, at, from, n === 0 ? Infinity : 400)) if (rest(n + 1, end)) return true;
    return false;
  };
  return rest(0, 0);
}

/** The quoted runs on a line. A straight quote between letters (Hebrew's צה"ל) is not a quotation mark. */
export function quotesOn(/** @type {string} */ line) {
  const out = [];
  let rest = line.replace(/(?<=\p{L})"(?=\p{L})/gu, "");
  for (const pair of [/“([^”]+)”/g, /„([^“”]+)[“”]/g, /«([^»]+)»/g, /»([^«]+)«/g, /”([^”]+)”/g, /「([^」]+)」/g, /『([^』]+)』/g, /‘([^’]+)’/g]) {
    rest = rest.replace(pair, (_, q) => {
      out.push(q);
      return " ";
    });
  }
  const marks = (rest.match(/"/g) ?? []).length;
  if (marks % 2) return { quotes: out, odd: true };
  return { quotes: [...out, ...[...rest.matchAll(/"([^"]*)"/g)].map((m) => m[1])], odd: false };
}

/** @param {string} text */
function frontMatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) return null;
  /** @type {Record<string, string>} */
  const fields = {};
  for (const line of m[1].split("\n")) {
    const f = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (f) fields[f[1]] = f[2].trim().replace(/^(["'])(.*)\1$/, "$2").replace(/\\"/g, '"');
  }
  return { fields, lines: m[0].split("\n").length - 1 };
}

/** @param {string} rawText */
export function parseRaw(rawText) {
  // The last heading: a description can hold anything, a caption line never starts with ##.
  const at = rawText.lastIndexOf("\n## Transcript\n");
  const captions = [...(at < 0 ? "" : rawText.slice(at)).matchAll(/^L\d+ (\d\d:\d\d:\d\d) (.*)$/gm)].map((m) => ({ at: seconds(m[1]), text: m[2] }));
  return { captions, fields: frontMatter(rawText)?.fields ?? {} };
}

/** The owner's share for speech, from a line in SITE.md: `Distillation length: 30% to 60%`. */
export function shareFrom(/** @type {string} */ site) {
  const m = /^Distillation length:\s*(\d+)%\s*to\s*(\d+)%/im.exec(site);
  return m ? { min: Number(m[1]), max: Number(m[2]) } : SPEECH_SHARE;
}

/** A caption's spelling of the same word: "IPO'd" for "IPOed". Never another word: "Mike" is not "like". */
function sameName(/** @type {string} */ a, /** @type {string} */ b) {
  if (a[0] !== b[0] || a.length < 4 || b.length < 4 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  const rest = (/** @type {string} */ s, /** @type {number} */ n) => s.slice(n);
  return rest(a, i + 1) === rest(b, i + 1) || rest(a, i + 1) === rest(b, i) || rest(a, i) === rest(b, i + 1);
}

const NUMBER = /\p{Nd}[\p{Nd},.]*\p{Nd}|\p{Nd}/gu;
/** Commas only: 3.5 is not 35. */
const plainNumber = (/** @type {string} */ n) => n.replace(/,/g, "");
const UNIT = "million|billion|trillion|thousand|percent|%";
const SPELLED = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };

/**
 * Names and numbers the distillation has and the source lacks, which only a run can
 * have put there. `Belantir [caption: Belunteer]` declares a fix of what the captions
 * misheard; the caption's word must be in the source.
 */
export function added(/** @type {string[]} */ lines, /** @type {number} */ start, /** @type {string} */ rawText) {
  const source = rawText.replace(/^L\d+ \d\d:\d\d:\d\d /gm, "");
  const list = words(source);
  const known = new Set(list);
  const numbers = new Set([...source.matchAll(NUMBER)].map((m) => plainNumber(m[0])));
  const scaled = new Set(
    [...source.matchAll(new RegExp(`(\\d[\\d,.]*\\d|\\d|\\b(?:${Object.keys(SPELLED).join("|")})\\b)\\s*(${UNIT})`, "gi"))].map((m) => `${SPELLED[m[1].toLowerCase()] ?? plainNumber(m[1])} ${m[2].toLowerCase()}`),
  );
  const midCapitals = (source.match(/(?<=[\p{Ll},;] )\p{Lu}/gu) ?? []).length;
  const latin = (source.match(/\p{Script=Latin}/gu) ?? []).length;
  const letters = (source.match(/\p{L}/gu) ?? []).length;
  // Nouns capitalized, as in German, or a source in another script written up in this one: no name check.
  const checkNames = midCapitals / Math.max(list.length, 1) <= NOUN_CAPITALS && latin > letters / 2;
  const capitalized = new Set(words((source.match(/\p{Lu}[\p{L}\p{N}'’-]+/gu) ?? []).join(" ")));
  const lowercase = new Set(source.split(/[^\p{L}\p{N}'’]+/u).filter((w) => w && w === w.toLowerCase()).map((w) => w.replace(/['’]/g, "")));
  const out = [];
  const declared = new Set();
  /** @type {Map<string, string>} the caption's word, to what it was corrected to */
  const fixes = new Map();
  for (const [i, line] of lines.entries()) {
    if (i < start) continue;
    for (const m of line.matchAll(/((?:[^\s[\]]+ ){0,3}[^\s[\]]+) \[caption: ([^\]]+)\]/g)) {
      for (const w of words(m[1])) declared.add(w);
      for (const n of m[1].match(NUMBER) ?? []) declared.add(plainNumber(n));
      if (!words(m[2]).every((w) => known.has(w))) out.push({ n: i + 1, msg: `[caption: ${m[2]}] is not what the captions say; copy their word` });
      const caption = words(m[2]);
      const right = words(m[1]);
      // Only a name: "Claude [caption: cloud]" says nothing about a real cloud.
      if (caption.length === 1 && !right.includes(caption[0]) && !lowercase.has(caption[0])) fixes.set(caption[0], m[1].split(" ").pop() ?? "");
    }
  }
  // A misheard name, once corrected, is corrected everywhere but inside a quote.
  for (const [i, line] of lines.entries()) {
    if (i < start || line.startsWith("## ")) continue;
    let text = line.replace(/\[caption: [^\]]+\]/g, " ");
    for (const q of quotesOn(line).quotes) text = text.replace(q, " ");
    for (const w of words(text)) if (fixes.has(w)) out.push({ n: i + 1, msg: `${w} is ${fixes.get(w)} elsewhere in this file; write it the same way` });
  }
  const inSource = (/** @type {string} */ w, /** @type {boolean} */ acronym) =>
    known.has(w) || declared.has(w) || (acronym && w.length >= 2 && [...capitalized].some((k) => k.startsWith(w))) || [...capitalized].some((k) => sameName(k, w));
  for (const [i, line] of lines.entries()) {
    if (i < start || line.startsWith("## ")) continue;
    const text = line.replace(/\[caption: [^\]]+\]/g, " ").replace(/\b\d\d:\d\d:\d\d\b/g, " ");
    for (const m of text.matchAll(NUMBER)) {
      const n = plainNumber(m[0]);
      if (n.replace(/[^\p{Nd}]/gu, "").length >= 2 && !numbers.has(n) && !declared.has(n)) out.push({ n: i + 1, msg: `the number ${m[0]} is not in the source; write what it says, or the right figure then [caption: its figure]` });
    }
    for (const m of text.matchAll(new RegExp(`(?<![\\d,.])(\\d[\\d,.]*\\d|\\d)\\s*(${UNIT})`, "gi"))) {
      const n = plainNumber(m[1]);
      const unit = m[2].toLowerCase();
      if (scaled.has(`${n} ${unit}`) || declared.has(n)) continue;
      // "90 to 95%" and "200 billion, increase to 220" leave the scale to the reader. Only a figure the
      // source gives another scale, or a lone digit, which any source holds somewhere, is plainly wrong.
      const otherScale = [...scaled].some((pair) => pair.startsWith(`${n} `));
      const loneDigit = n.length === 1 && /illion/.test(unit);
      if (otherScale || loneDigit) out.push({ n: i + 1, msg: `${m[0]} is not in the source; write what it says, or the right figure then [caption: its figure]` });
    }
    if (!checkNames) continue;
    for (const m of text.matchAll(/(?<=[\p{Ll},;] )\p{Lu}[\p{L}\p{N}'’-]+/gu)) {
      const name = m[0].replace(/['’]s$/i, "");
      if (!words(name).every((w) => inSource(w, name === name.toUpperCase()))) out.push({ n: i + 1, msg: `the name ${m[0]} is not in the source; write what the captions say, or the right name then [caption: their word]` });
    }
  }
  return out;
}

/** Numbers and names the source repeats and the distillation lacks. */
export function vanished(/** @type {string} */ text, /** @type {{ text: string }[]} */ captions) {
  const said = captions.map((c) => c.text).join(" ");
  const has = new Set(words(text));
  const kept = new Set([...text.matchAll(NUMBER)].map((m) => plainNumber(m[0])));
  const numbers = [...new Set([...said.matchAll(/\$?\d[\d,.]*\d%?/g)].map((m) => m[0].replace(/[.,]$/, "")))].filter((n) => !kept.has(plainNumber(n.replace(/[$%]/g, ""))));
  // Capitalized mid-sentence, more than once, and never lowercase: names rather than sentence starts.
  const counts = new Map();
  for (const m of said.matchAll(/(?<=[\p{Ll},] )\p{Lu}\p{L}{2,}/gu)) counts.set(m[0], (counts.get(m[0]) ?? 0) + 1);
  const lower = new Set(said.split(/[^\p{L}]+/u).filter((w) => w === w.toLowerCase()));
  const names = [...counts.keys()].filter((n) => counts.get(n) > 1 && !lower.has(n.toLowerCase()) && !words(n).every((w) => has.has(w))).sort((x, y) => counts.get(y) - counts.get(x));
  return { numbers, names };
}

/**
 * @param {string} name the distillation's name, for findings
 * @param {string} text the distillation
 * @param {string} rawText its source
 * @param {{ min: number, max: number }} [share] how much of speech to keep, in percent
 */
export function check(name, text, rawText, share = SPEECH_SHARE) {
  const problems = [];
  const note = (/** @type {number} */ n, /** @type {string} */ msg) => problems.push(`${name}:${n}: ${msg}`);
  const { captions, fields: rawFields } = parseRaw(rawText);
  const lines = text.split("\n");
  const timed = captions.length > 0;

  const front = frontMatter(text);
  if (!front) note(1, "no front matter; open with --- and title, source, url, as the distill skill shows");
  else {
    for (const field of ["title", "source"]) if (!front.fields[field] || front.fields[field] === "[]") note(1, `front matter has no ${field}`);
    for (const field of ["title", "url", "published"]) {
      if (rawFields[field] && front.fields[field] !== rawFields[field]) note(1, `${field} is ${JSON.stringify(front.fields[field] ?? "missing")}; the source says ${JSON.stringify(rawFields[field])}`);
    }
  }

  const headings = lines.flatMap((line, i) => {
    const m = /^##\s+(.*)$/.exec(line);
    return m ? [{ n: i + 1, text: m[1] }] : [];
  });
  if (!headings.length) note(front?.lines ?? 1, "no sections; each opens ## <timestamp or location>");
  /** @type {{ n: number, last: number, at: number, words: number }[]} */
  const sections = [];
  for (const [i, h] of headings.entries()) {
    // Older notes carry topics after a bar; moments hold topics now.
    const m = /^([^|]+?)\s*(?:\|.*)?$/.exec(h.text) ?? [h.text, h.text];
    if (!timed) continue;
    if (!/^\d\d:\d\d:\d\d$/.test(m[1])) {
      note(h.n, `section opens with ${JSON.stringify(m[1])}; write its timestamp as 00:03:12`);
      continue;
    }
    const until = headings[i + 1]?.n ?? lines.length + 1;
    sections.push({ n: h.n, last: until - 1, at: seconds(m[1]), words: words(lines.slice(h.n, until - 1).join(" ")).length });
  }

  const body = lines.slice(front?.lines ?? 0);
  const said = timed ? captions.reduce((n, c) => n + words(c.text).length, 0) : words(rawText.slice(rawText.indexOf("\n---\n") + 1)).length;
  const wrote = words(body.filter((l) => !l.startsWith("## ")).join(" ")).length;
  if (said >= MIN_TO_MEASURE) {
    const percent = Math.round((100 * wrote) / said);
    if (timed && percent > share.max) note(1, `${wrote} words is ${percent}% of the source's ${said}; say each idea once and bring it under ${share.max}% without dropping an idea, story, number or name`);
    const min = timed ? share.min : DOCUMENT_MIN_SHARE;
    if (percent < min) note(1, `${wrote} words is ${percent}% of the source's ${said}; that loses too much, so reread it and bring back what was dropped until it is over ${min}%`);
  }

  if (timed && sections.length) {
    const end = captions[captions.length - 1].at;
    const [first, final] = [sections[0], sections[sections.length - 1]];
    if (first.at > captions[0].at + 120) note(first.n, `starts at ${stamp(first.at)}; the source starts at ${stamp(captions[0].at)}`);
    if (end - final.at > MAX_END_MINUTES * 60) note(final.n, `the last section starts at ${stamp(final.at)} and the source runs to ${stamp(end)}; read and write to the end`);
    const measured = sections.map((s, i) => {
      const until = sections[i + 1]?.at ?? end + 1;
      const dropped = [...lines.slice(s.n, s.last).join("\n").matchAll(/\((\d\d:\d\d:\d\d) to (\d\d:\d\d:\d\d): /g)].map((m) => ({ from: seconds(m[1]), to: seconds(m[2]) }));
      const kept = captions.filter((c) => c.at >= s.at && c.at < until && !dropped.some((d) => c.at >= d.from && c.at < d.to));
      // Speech only: a noted part or a stretch of music is not a section to split.
      const talk = kept.length ? kept[kept.length - 1].at - kept[0].at : 0;
      return { ...s, until, talk, source: kept.reduce((n, c) => n + words(c.text).length, 0) };
    });
    for (const s of measured) {
      if (s.until < s.at) note(s.n, `out of order: ${stamp(s.at)} comes before ${stamp(s.until)} in the file`);
      else if (s.talk > MAX_SECTION_MINUTES * 60) note(s.n, `${stamp(s.at)} to ${stamp(s.until)} is ${(s.talk / 60).toFixed(1)} minutes in one section; split it`);
    }
    // Words kept per source word, section by section: a skimmed middle stands out against the rest.
    const rated = measured.filter((s) => s.source >= 100).map((s) => ({ ...s, ratio: s.words / s.source }));
    const usual = [...rated].sort((x, y) => x.ratio - y.ratio)[Math.floor(rated.length / 2)]?.ratio ?? 0;
    for (const s of rated) {
      if (s.ratio < usual * THIN_SHARE || s.ratio < THIN_FLOOR) note(s.n, `${stamp(s.at)} to ${stamp(s.until)} keeps ${s.words} words of ${s.source}, against about ${Math.round(usual * 100)}% elsewhere; reread that stretch, or note a dropped part as (00:41:10 to 00:43:00: sponsor read)`);
    }
  }

  for (const a of added(lines, front?.lines ?? 0, rawText)) note(a.n, a.msg);

  // Quotes may come from anywhere in the source, a description naming a guest included.
  const source = words(rawText.replace(/^L\d+ \d\d:\d\d:\d\d /gm, ""));
  /** @type {Map<string, number[]>} */
  const at = new Map();
  source.forEach((w, i) => (at.get(w) ?? at.set(w, []).get(w))?.push(i));
  let quoted = 0;
  for (const [i, line] of lines.entries()) {
    if (i < (front?.lines ?? 0)) continue;
    const { quotes, odd } = quotesOn(line);
    quoted += quotes.length;
    if (odd) note(i + 1, 'a quotation mark is unmatched on this line; quote speech as "words" and keep each quote on one line');
    for (const quote of quotes) {
      if (!quoteInSource(quote, source, at)) note(i + 1, `quote not in the source: "${quote.slice(0, 90)}"; copy the words from the source or drop the quotation marks`);
    }
  }

  return { problems, ...vanished(text, captions), sections: headings.length };
}

/** The source of distilled/<path>: raw/<path>. */
function rawFor(/** @type {string} */ path) {
  const m = /(?:^|\/)distilled\/(.+)$/.exec(path.replace(/\\/g, "/"));
  return m ? `raw/${m[1]}` : null;
}

const isFile = (/** @type {string} */ p) => existsSync(p) && statSync(p).isFile();

function main() {
  const a = parseArgs(process.argv.slice(2));
  plain(a, HELP, "check-distilled", { flags: ["raw"], args: true });
  if (a._.length !== 1) misused(`check-distilled: name one distilled file${a._.length ? `, not ${a._.length}` : ""}`, "node scripts/check-distilled.mjs distilled/youtube/<channel>/<file>.md");
  const [path] = a._;
  if (!isFile(path)) fail(`check-distilled: no file ${path}`, "ls distilled/*/*");
  const rawPath = flag(a, "raw") ?? rawFor(path);
  if (!rawPath || !isFile(rawPath)) fail(`check-distilled: no source found for ${path}${rawPath ? ` at ${rawPath}` : ""}`, `node scripts/check-distilled.mjs ${path} --raw raw/youtube/<channel>/<file>.md`);

  const shown = relative(process.cwd(), path) || path;
  const share = existsSync("SITE.md") ? shareFrom(readFileSync("SITE.md", "utf8")) : SPEECH_SHARE;
  const { problems, numbers, names, sections } = check(shown, readFileSync(path, "utf8"), readFileSync(rawPath, "utf8"), share);
  if (problems.length) {
    const more = problems.length > SHOWN ? [`${SHOWN} of ${problems.length}; fix these and run it again for the rest`] : [];
    fail(`check-distilled: ${shown} has ${problems.length} problem${problems.length === 1 ? "" : "s"}\n${[...problems.slice(0, SHOWN), ...more].map((p) => `  ${p}`).join("\n")}`, `fix those, then node scripts/check-distilled.mjs ${shown}`);
  }
  const lines = [];
  if (numbers.length) lines.push(`numbers the source has and this lacks: ${numbers.slice(0, 40).join(", ")}${numbers.length > 40 ? `, and ${numbers.length - 40} more` : ""}`);
  if (names.length) lines.push(`names the source repeats and this lacks: ${names.slice(0, 40).join(", ")}${names.length > 40 ? `, and ${names.length - 40} more` : ""}`);
  if (lines.length) lines.push("keep any of those that matter");
  done("check-distilled", `${shown} passed, ${sections} sections`, { lines });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
