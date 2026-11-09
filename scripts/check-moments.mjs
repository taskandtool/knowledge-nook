#!/usr/bin/env node
// Are a source's moments and gist true to it, and easy to scan? What can be answered by
// comparing the file with its transcript, with no AI.
import { existsSync, readFileSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { added, parseRaw, quoteInSource, quotesOn, words } from "./check-distilled.mjs";
import { done, fail, has, misused, parseArgs, plain } from "../src/data/cli.mjs";

const HELP = `usage: node scripts/check-moments.mjs <moments file> [--final]

Checks moments/<path>.md against raw/<path>.md. With --final, as the align step needs, it also
requires a gist and at least one pick. Fails, with the line and what to do, on:
a line it can't read, moments out of order or past the video's end, a line over 25 words,
one opening with who said it, a quote that isn't in the captions near that moment, a name or
number the source lacks, the same in the gist, and a "Strongest" line that isn't a moment.
A web page or document has no seconds: its moments all read 00:00:00.

Hints never fail: how many moments a minute, and long stretches with none. Exit 0 passed,
1 has problems, 2 used wrongly.`;

const MAX_WORDS = 25;
const QUOTE_REACH_SECONDS = 150;
const GAP_MINUTES = 12;
const LINE = /^- (\d\d:\d\d:\d\d) \| ([^|]*) \| (.+)$/;
const STRONG = /^- (\d\d:\d\d:\d\d) (.+)$/;
const THIRD = /^(?:he|she)\b/i;
const WHO_LEADS = /^(?:\p{Lu}[\p{L}'’-]*(?: \p{Lu}[\p{L}'’-]*)?|He|She|They|The speaker|The guest) (?:says|said|argues|argued|believes|believed|thinks|thought|claims|claimed|notes|noted|explains|explained|describes|described)\b/u;
const seconds = (/** @type {string} */ t) => t.split(":").reduce((n, p) => n * 60 + Number(p), 0);
const clock = (/** @type {number} */ s) => [s / 3600, (s / 60) % 60, s % 60].map((v) => String(Math.floor(v)).padStart(2, "0")).join(":");

/** @param {string} name @param {string} text @param {string} rawText */
export function checkMoments(name, text, rawText, { final = false } = {}) {
  const problems = [];
  const hints = [];
  const note = (/** @type {number} */ n, /** @type {string} */ what) => problems.push(`${name}:${n}: ${what}`);
  const { captions } = parseRaw(rawText);
  const end = captions.length ? captions[captions.length - 1].at : Infinity;
  const pageText = rawText.replace(/^---\n[\s\S]*?\n---\n/, "");
  const indexed = (/** @type {string} */ whole) => {
    const list = words(whole);
    /** @type {Map<string, number[]>} */
    const index = new Map();
    list.forEach((w, i) => (index.get(w) ?? index.set(w, []).get(w))?.push(i));
    return { list, index };
  };
  // A page or document has no seconds, so a quote can be anywhere in it.
  const near = (/** @type {number} */ at) => indexed(captions.length ? captions.filter((c) => Math.abs(c.at - at) <= QUOTE_REACH_SECONDS).map((c) => c.text).join(" ") : pageText);
  const lines = text.split("\n");
  const moments = [];
  const strongest = [];
  let section = "";
  let last = -1;
  for (const [i, line] of lines.entries()) {
    const heading = /^## (.+)$/.exec(line);
    if (heading) section = heading[1].trim();
    if (section === "Moments" && line.trim() && !heading && !line.startsWith("- ")) note(i + 1, `can't read this under Moments; write - 00:03:12 | topic, topic | the point: ${line.slice(0, 60)}`);
    if (!line.startsWith("- ")) continue;
    if (section === "Moments") {
      const m = LINE.exec(line);
      if (!m) {
        note(i + 1, `can't read this moment; write - 00:03:12 | topic, topic | the point: ${line.slice(0, 60)}`);
        continue;
      }
      const at = seconds(m[1]);
      if (at < last) note(i + 1, `${m[1]} comes before the moment above it; keep moments in order`);
      if (at > end) note(i + 1, `${m[1]} is past the video's end at ${clock(end)}`);
      last = at;
      if (!m[2].trim()) note(i + 1, "no topic; give it one or two");
      for (const topic of m[2].split(",").map((t) => t.trim()).filter(Boolean)) {
        // A figure or quotation here makes a topic no reader would look up.
        if (/["“”«»]|^\$?\d|^(and|or) /i.test(topic)) note(i + 1, `topic ${JSON.stringify(topic)} is not a name a reader would look up; use a short plain noun phrase`);
      }
      const count = words(m[3]).length;
      if (count > MAX_WORDS) note(i + 1, `${count} words; say it in ${MAX_WORDS} or fewer: ${m[3].slice(0, 50)}`);
      if (THIRD.test(m[3])) note(i + 1, `"he" or "she" stands outside the speaker; write as them: ${m[3].slice(0, 50)}`);
      if (WHO_LEADS.test(m[3])) note(i + 1, `opens with who said it; start with the point: ${m[3].slice(0, 50)}`);
      const here = near(at);
      for (const q of quotesOn(m[3]).quotes) {
        if (!quoteInSource(q, here.list, here.index)) note(i + 1, `quote isn't in the captions near ${m[1]}: "${q.slice(0, 60)}"; copy the words, or drop the marks and paraphrase`);
      }
      moments.push({ at, stamp: m[1], line: i, text: m[3] });
    }
    if (section === "Strongest") {
      const m = STRONG.exec(line);
      if (!m) note(i + 1, `can't read this; write - 00:03:12 the point: ${line.slice(0, 60)}`);
      else {
        if (m[2].includes(" | ")) note(i + 1, "copy the line here without its topics: - 00:03:12 the point");
        strongest.push({ stamp: m[1], text: m[2], n: i + 1 });
      }
    }
  }
  if (!moments.length) note(1, "no moments; write them under ## Moments");
  for (const s of strongest) if (!moments.some((m) => m.stamp === s.stamp && (m.at > 0 || m.text === s.text))) note(s.n, `${s.stamp} is not one of the moments; pick from the list below it`);
  if (strongest.length > 3 && strongest.length > moments.length / 2) hints.push(`${strongest.length} of ${moments.length} under Strongest; only the best belong`);
  const body = moments.map((m) => m.text);
  const gist = /^## Gist\s*\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(text)?.[1]?.trim() ?? "";
  const gistAt = lines.findIndex((l) => /^## Gist\s*$/.test(l)) + 1;
  if (gist) {
    const whole = indexed(captions.length ? captions.map((c) => c.text).join(" ") : pageText);
    for (const q of quotesOn(gist.replace(/\n/g, " ")).quotes) {
      if (!quoteInSource(q, whole.list, whole.index)) note(gistAt, `gist quote isn't in the source: "${q.slice(0, 60)}"; copy the words, or drop the marks and paraphrase`);
    }
    for (const p of added(gist.split("\n"), 0, rawText)) note(gistAt, `gist: ${p.msg}`);
  }
  if (final && !gist) note(gistAt || 1, "no gist; write it above ## Moments");
  if (final && !strongest.length) note(gistAt || 1, "no picks; list about one every 5 minutes under ## Strongest");
  for (const p of added(body, 0, rawText)) note(moments[p.n - 1]?.line + 1, p.msg);
  if (moments.length && end !== Infinity) {
    const minutes = end / 60;
    hints.push(`${moments.length} moments in ${Math.round(minutes)} minutes, one per ${(minutes / moments.length).toFixed(1)}`);
    const stops = [0, ...moments.map((m) => m.at), end];
    for (let i = 1; i < stops.length; i++) if (stops[i] - stops[i - 1] > GAP_MINUTES * 60) hints.push(`nothing from ${clock(stops[i - 1])} to ${clock(stops[i])}; fine if that stretch is empty, read it if not`);
  }
  return { problems, hints, moments: moments.length, strongest: strongest.length, hasGist: !!gist };
}

function main() {
  const a = parseArgs(process.argv.slice(2), { bare: ["final"] });
  plain(a, HELP, "check-moments", { args: true, flags: ["final"] });
  const [file, ...more] = a._;
  if (!file || more.length) misused("check-moments: name one moments file", "node scripts/check-moments.mjs moments/youtube/chan/x.md");
  if (!existsSync(file) || !statSync(file).isFile()) fail(`check-moments: no file ${file}`, "ls moments/");
  const raw = file.replace(/^moments[/\\]/, "raw/");
  if (!existsSync(raw)) fail(`check-moments: no source at ${raw}`, "name a file under moments/ that has one under raw/");
  const r = checkMoments(file, readFileSync(file, "utf8"), readFileSync(raw, "utf8"), { final: has(a, "final") });
  if (r.problems.length) fail(`check-moments: ${file} has ${r.problems.length} problem${r.problems.length === 1 ? "" : "s"}\n${r.problems.slice(0, 25).map((p) => `  ${p}`).join("\n")}`, `fix those, then node scripts/check-moments.mjs ${file}`);
  done("check-moments", `${file} passed`, { lines: r.hints });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
