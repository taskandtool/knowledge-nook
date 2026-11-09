#!/usr/bin/env node
// What blocks a public page, with no AI. Grows with the site: `npm run check`.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { done, fail, misused, parseArgs, usage } from "../src/data/cli.mjs";
import { parseRaw, quoteInSource, quotesOn, words } from "./check-distilled.mjs";
import YAML from "yaml";
import { checkMoments } from "./check-moments.mjs";
import { siteProblems } from "./check-site.mjs";
import { failedFiles } from "./build-index.mjs";

const HELP = `usage: node scripts/check.mjs <all | pages [file] | site>

all: pages, every source's moments, then builds the site, then site. What npm run check runs, and blocks a deploy.

site: reads dist/ as a visitor gets it, after a build: broken links and anchors, pages
nothing links to, titles, descriptions, headings, canonical tags and structured data, the
sitemap against the publish gate, long runs of transcript text, unsafe HTML and
links, and file counts and sizes.

pages: checks one page, or every page under content/: each quote is in raw/ and at most 30
words, nothing attributes instead of teaching ("he argues", "Ortiz says") or points at another page instead
of making the point ("told under [x]"), a link at least every 4 sentences, each link to a
video names a video in raw/ at a moment it has, each other link is a source in raw/,
a quote or figure in a video's captions is within 4 minutes of the moment linked after
it, and the front matter is whole. Then tropes for AI tells.

Failures say the line and what to do. Exit 0 passed, 1 has problems, 2 used wrongly.`;

const MAX_QUOTE_WORDS = 30;
/** How a third party writes about someone. Past tense stays: a speaker tells what others said. */
const THIRD_PERSON = /\b(?:(?:he|she) (?:says|argues|contends|believes|recalls|warns|claims|thinks|describes|calls)\b|in (?:his|her) (?:view|reading|telling|account|words)\b|(?:his|her) (?:sharpest|strongest|central|main|best) (?:example|point|claim|story)\b)/i;
/** A sentence about where a story is told, instead of the story's point with the link on its words. */
const POINTER = /\b(?:(?:is|are|was|were) (?:told|covered|explained|discussed|treated) (?:under|on|in|at) \[|belongs? (?:with|in|under|on) \[|the (?:dedicated|separate) (?:guide|page)\b)/i;
const MAX_SENTENCES_PER_LINK = 4;
/** How far a claim may sit from the moment its link opens, before a reader gives up looking. */
const NEAR_SECONDS = 240;
const TROPES = fileURLToPath(new URL("../.claude/skills/tropes/tropes.mjs", import.meta.url));

function walk(/** @type {string} */ dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : f.endsWith(".md") ? [p] : [];
  });
}

/** Every source in raw/, ready to look quotes and moments up in. */
export function loadRaw(/** @type {string[]} */ paths) {
  const source = [];
  /** @type {Map<string, number[]>} */
  const at = new Map();
  /** @type {Map<string, number>} */
  const videos = new Map();
  /** @type {Map<string, { at: number, text: string }[]>} */
  const captionsOf = new Map();
  const pages = new Set();
  for (const path of paths) {
    const text = readFileSync(path, "utf8");
    const { captions, fields } = parseRaw(text);
    if (fields.id && captions.length) {
      videos.set(fields.id, captions[captions.length - 1].at);
      captionsOf.set(fields.id, captions);
    }
    if (fields.url) pages.add(fields.url);
    const start = source.length;
    const list = words(text.replace(/^L\d+ \d\d:\d\d:\d\d /gm, ""));
    list.forEach((w, i) => (at.get(w) ?? at.set(w, []).get(w))?.push(start + i));
    for (const w of list) source.push(w);
  }
  return { source, at, videos, pages, captionsOf };
}

/** The video a link names, only on YouTube's own hosts. */
export function videoId(/** @type {string} */ url) {
  try {
    const u = new URL(url);
    if (/^(www\.|m\.)?youtube\.com$/.test(u.hostname)) return u.searchParams.get("v") ?? undefined;
    if (u.hostname === "youtu.be") return u.pathname.slice(1);
  } catch {
    // Not a URL: the caller reports it as no source.
  }
  return undefined;
}

const NUMBERS = /\p{Nd}[\p{Nd},.]*\p{Nd}/gu;
const bareNumber = (/** @type {string} */ n) => n.replace(/,/g, "");

/** Words and figures of a video's captions, whole or within reach of one moment. */
function reach(/** @type {{ at: number, text: string }[]} */ captions, /** @type {number | null} */ t) {
  const text = captions.filter((c) => t === null || Math.abs(c.at - t) <= NEAR_SECONDS).map((c) => c.text).join(" ");
  const source = words(text);
  /** @type {Map<string, number[]>} */
  const at = new Map();
  source.forEach((w, i) => (at.get(w) ?? at.set(w, []).get(w))?.push(i));
  return { source, at, numbers: new Set([...text.matchAll(NUMBERS)].map((m) => bareNumber(m[0]))) };
}

/** Where a thing was said nearest a moment, exactly, in the form a link takes. */
function momentOf(/** @type {{ at: number, text: string }[]} */ captions, /** @type {number} */ from, /** @type {(r: ReturnType<typeof reach>) => boolean} */ has) {
  const inWindow = (/** @type {number} */ i) => has(reach(captions.filter((x) => x.at >= captions[i].at && x.at < captions[i].at + NEAR_SECONDS), null));
  // The last window to hold it starts at the line that says it, or close.
  const moments = captions.map((c) => c.at).filter((_, i) => inWindow(i) && !(i + 1 < captions.length && inWindow(i + 1)));
  if (!moments.length) return "another moment; link there";
  return `t=${moments.reduce((best, m) => (Math.abs(m - from) < Math.abs(best - from) ? m : best))}s; link there`;
}

/**
 * What a link vouches for: the words since the link before it. A quote or figure from
 * that video's captions must be near the moment it opens, or a reader clicks and finds nothing.
 */
export function misplaced(/** @type {string} */ line, /** @type {ReturnType<typeof loadRaw>} */ raw) {
  const out = [];
  let from = 0;
  for (const link of line.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)) {
    const claim = line.slice(from, link.index).replace(/\[[^\]]*$/, "");
    from = (link.index ?? 0) + link[0].length;
    const id = videoId(link[1]);
    const t = /[?&]t=(\d+)s?/.exec(link[1]);
    const captions = id ? raw.captionsOf.get(id) : undefined;
    if (!captions || !t) continue;
    const near = reach(captions, Number(t[1]));
    const whole = reach(captions, null);
    for (const quote of quotesOn(claim).quotes) {
      if (quoteInSource(quote, whole.source, whole.at) && !quoteInSource(quote, near.source, near.at)) out.push(`"${quote.slice(0, 60)}" is not near ${t[1]}s in that video; it was said at ${momentOf(captions, Number(t[1]), (r) => quoteInSource(quote, r.source, r.at))}`);
    }
    for (const m of claim.matchAll(NUMBERS)) {
      const n = bareNumber(m[0]);
      if (whole.numbers.has(n) && !near.numbers.has(n)) out.push(`${m[0]} is not near ${t[1]}s in that video; it was said at ${momentOf(captions, Number(t[1]), (r) => r.numbers.has(n))}`);
    }
  }
  return out;
}

/** @param {string} name @param {string} text @param {ReturnType<typeof loadRaw>} raw */
export function checkPage(name, text, raw, names = []) {
  const problems = [];
  // A name belongs in a story, never as a source.
  const speakers = names.length ? new RegExp(`\\b(?:${names.map((n) => n.replace(/[.*+?^\${}()|[\\]\\\\]/g, "\\$&")).join("|")})(?:,? (?:says|said|argues|argued|contends|believes|claims|thinks|describes|recalls|warns|explains|adds|calls)\\b)|\\baccording to (?:${names.map((n) => n.replace(/[.*+?^\${}()|[\\]\\\\]/g, "\\$&")).join("|")})\\b`, "u") : null;
  const note = (/** @type {number} */ n, /** @type {string} */ msg) => problems.push(`${name}:${n}: ${msg}`);
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) note(1, "no front matter; open with --- and type, title, description, as the write-page skill shows");
  try {
    if (m) YAML.parse(m[1]);
  } catch (e) {
    note(1, `front matter does not parse, so the page would not be built: ${String(/** @type {any} */ (e).message).split("\n")[0]}; put quotes around a value with a colon`);
  }
  for (const field of ["type", "title", "description"]) {
    if (m && !new RegExp(`^${field}: *\\S`, "m").test(m[1])) note(1, `front matter has no ${field}`);
  }
  const lines = text.split("\n");
  const start = m ? m[0].split("\n").length - 1 : 0;
  // A paragraph or list item: consecutive lines, broken by a blank or a new bullet.
  let block = { n: 0, text: "" };
  const close = () => {
    const links = (block.text.match(/\]\(https?:\/\//g) ?? []).length;
    const sentences = (block.text.replace(/\]\([^)]*\)/g, "]").match(/[.!?]["”)]*(\s|$)/g) ?? []).length;
    if (block.text.trim() && !links) note(block.n, `no link here; every paragraph and list item links to its source: ${block.text.trim().slice(0, 70)}`);
    else if (block.text.trim() && sentences > links * MAX_SENTENCES_PER_LINK) note(block.n, `${sentences} sentences and ${links} link${links === 1 ? "" : "s"}; footnote each point, at the moment it was said: ${block.text.trim().slice(0, 60)}`);
    block = { n: 0, text: "" };
  };
  let section = { n: 0, name: "", quotes: 0 };
  const endSection = () => {};
  for (const [i, line] of lines.entries()) {
    if (i < start) continue;
    if (line.startsWith("## ")) {
      endSection();
      section = { n: i + 1, name: line.slice(3).trim(), quotes: 0 };
    }
    if (!line.trim() || line.startsWith("#")) close();
    else {
      if (/^\s*[-*\d]+[.)]?\s/.test(line)) close();
      if (!block.n) block.n = i + 1;
      block.text += ` ${line}`;
    }
    const clean = line.replace(/\]\([^)]*\)/g, "]");
    // We write as them, so nothing stands outside them to say what they said.
    if (i >= start && !line.startsWith("#")) {
      const ours = quotesOn(clean).quotes.reduce((rest, q) => rest.replace(q, ""), clean);
      const third = THIRD_PERSON.exec(ours)?.[0] ?? speakers?.exec(ours)?.[0];
      if (third) note(i + 1, `"${third}" attributes instead of teaching; say the point itself, and let the footnote show the source: ${ours.trim().slice(0, 60)}`);
      const pointer = POINTER.exec(line)?.[0];
      if (pointer) note(i + 1, `"${pointer}" points at another page; make the point in a sentence and put the link on its words: ${ours.trim().slice(0, 60)}`);
    }
    const { quotes, odd } = quotesOn(clean);
    section.quotes += quotes.length;
    if (odd) note(i + 1, 'a quotation mark is unmatched on this line; keep each quote on one line');
    for (const quote of quotes) {
      if (words(quote).length > MAX_QUOTE_WORDS) note(i + 1, `quote runs ${words(quote).length} words; keep quotes under ${MAX_QUOTE_WORDS} and say the rest in your own words`);
      if (!quoteInSource(quote, raw.source, raw.at)) note(i + 1, `quote not in raw/: "${quote.slice(0, 80)}"; copy it from the topic file or drop the quotation marks`);
    }
    for (const msg of misplaced(line, raw)) note(i + 1, msg);
    for (const link of line.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)) {
      const url = link[1];
      const id = videoId(url);
      if (id) {
        if (!raw.videos.has(id)) note(i + 1, `${url} is not a video in raw/; use a Link: line from the topic file`);
        const t = /[?&]t=(\d+)s?/.exec(url);
        if (raw.videos.has(id) && t && Number(t[1]) > (raw.videos.get(id) ?? 0)) note(i + 1, `${url} is past the video's end; use a Link: line from the topic file`);
      } else if (!raw.pages.has(url.split("#")[0])) note(i + 1, `${url} is not a source in raw/; use a Link: line from the topic file`);
    }
  }
  close();
  endSection();
  return problems;
}

/** Every page's problems, the AI tells among them. */
function pageProblems(/** @type {string[]} */ files) {
  // A crawl's own reports and indexes are not sources.
  const raw = loadRaw(walk("raw").filter((f) => !/(^|\/)(_index|_cache|structured|audit)\//.test(f)));
  // Full names and surnames of everyone the sources name.
  const names = [...new Set(walk("moments").flatMap((f) => (/^speakers: *\[(.*)\]/m.exec(readFileSync(f, "utf8"))?.[1] ?? "").split(",").map((n) => n.trim()).filter(Boolean).flatMap((n) => [n, n.split(" ").pop() ?? n])))].filter((n) => n.length > 2);
  const problems = files.flatMap((f) => checkPage(f, readFileSync(f, "utf8"), raw, names));
  for (const f of files) {
    // Only our own words: a speaker's quote may say what it likes.
    const ours = readFileSync(f, "utf8").split("\n").map((l) => quotesOn(l).quotes.reduce((rest, q) => rest.replace(q, ""), l)).join("\n");
    const r = spawnSync(process.execPath, [TROPES, "--kind", "text", "-"], { input: ours, encoding: "utf8" });
    if (r.status === 1) problems.push(...r.stdout.split("\n").filter((l) => /^\s+error /.test(l)).map((l) => `${f}: ${l.trim()}`));
    else if (r.status !== 0) problems.push(`${f}: tropes could not run: ${(r.stderr || r.error?.message || "").trim().slice(0, 150)}`);
  }
  return problems;
}

const SHOWN = 30;
function refuse(/** @type {string} */ what, /** @type {string[]} */ all, /** @type {string} */ again) {
  fail(`${what}: ${all.length} problem${all.length === 1 ? "" : "s"}\n${all.slice(0, SHOWN).map((p) => `  ${p}`).join("\n")}${all.length > SHOWN ? `\n  ${SHOWN} of ${all.length}; fix these and run it again` : ""}`, again);
}

/** The built site, or nothing when a build was asked for and failed. */
function build() {
  const tsx = fileURLToPath(new URL("../node_modules/.bin/tsx", import.meta.url));
  const r = spawnSync(tsx, [fileURLToPath(new URL("./build.ts", import.meta.url))], { encoding: "utf8" });
  if (r.status !== 0) fail(`check: the build failed\n${`${r.stdout || ""}${r.stderr || r.error?.message || ""}`.trim().split("\n").slice(-12).join("\n")}`, "npm run build");
}

function main() {
  const argv = process.argv.slice(2);
  // It prints text, so its refusal of --json is text too.
  if (argv.includes("--json")) {
    parseArgs([]);
    misused("check: it prints text, no --json", "node scripts/check.mjs --help");
  }
  const a = parseArgs(argv);
  const [cmd, ...rest] = a._;
  usage(a, cmd, ["all", "pages", "site"], HELP, "check", { all: [], pages: [], site: [] });
  if (cmd !== "pages" && rest.length) misused(`check ${cmd}: takes no file`, `node scripts/check.mjs ${cmd}`);
  if (cmd === "site") {
    if (!existsSync(join("dist", "index.html"))) fail("check site: no dist/ yet", "npm run build");
    const { problems, notes } = siteProblems();
    if (problems.length) refuse("check site", problems, "fix those, then npm run check");
    return done("check site", "the built site passed", { lines: notes });
  }
  if (rest.length > 1) misused(`check pages: name one file at most, not ${rest.length}`, "node scripts/check.mjs pages");
  if (rest[0] && !(existsSync(rest[0]) && statSync(rest[0]).isFile())) fail(`check pages: no file ${rest[0]}`, "node scripts/check.mjs pages");
  const files = rest.length ? rest : walk("content");
  if (!files.length) fail("check pages: content/ holds no pages yet", "write one with the write-page skill");
  const pages = pageProblems(files);
  if (cmd === "pages") {
    if (pages.length) refuse(`check pages: ${files.length} page${files.length === 1 ? "" : "s"} checked`, pages, `fix those, then node scripts/check.mjs pages${rest[0] ? ` ${rest[0]}` : ""}`);
    return done("check pages", `${files.length} page${files.length === 1 ? "" : "s"} passed`);
  }
  // Everything is said at once, so one pass fixes it all.
  build();
  const { problems, notes } = siteProblems();
  // Moments are public, so a source's must hold up too.
  const failed = failedFiles();
  const moments = walk("moments").filter((f) => !failed.has(f)).flatMap((f) => {
    const source = f.replace(/^moments[/\\]/, "raw/");
    return existsSync(source) ? checkMoments(f, readFileSync(f, "utf8"), readFileSync(source, "utf8")).problems : [];
  });
  const all = [...pages, ...moments, ...problems];
  if (all.length) refuse("check", all, "fix those, then npm run check");
  done("check", `${files.length} page${files.length === 1 ? "" : "s"} and the built site passed`, { lines: notes });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
