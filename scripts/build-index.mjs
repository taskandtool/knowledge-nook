#!/usr/bin/env node
// The topic files, from each source's moments: every moment on a topic, in date order, with
// its exact link and the notes around it. No run ever edits them, so a change of alias needs
// only a rebuild.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { done, fail, parseArgs, plain } from "../src/data/cli.mjs";

const HELP = `usage: node scripts/build-index.mjs

Rebuilds index/topics.md and every index/topics/<topic>.md from moments/, applying
index/aliases.yaml, whose lines read \`other name: name to keep\`. A topic file holds every
moment tagged with it, by source and date, each with its link, and the notes around it.
Safe to run again: it replaces those files and never touches aliases.yaml.

index/topics.md lists each topic, its sources and moments, what it shares moments with, and
whether it passes the publish gate. By default a topic passes with 2 sources giving at least
2 moments each and 5 moments in all; \`Publish gate:\` in SITE.md changes the numbers. It also
says when a topic is so big it should split.

Prints the counts and the strongest topics. Exit 0 done, 1 refused, 2 used wrongly.`;

/** A page needs more than one voice and more than a passing mention: Google's scaled content policy. */
const GATE = { sources: 2, moments: 5, perSource: 2 };
/** Past this, a topic is several: the topics skill should split it. */
const SPLIT_MOMENTS = 30;
const RELATED_SHOWN = 12;
/** A topic in nearly every source may just be what the site is about. */
const WIDE_SHARE = 0.8;
const WIDE_FROM = 4;

/** `Publish gate: 2 sources, 5 moments` in SITE.md. */
export function gateFrom(/** @type {string} */ site) {
  const line = /^Publish gate:(.*)$/im.exec(site.replace(/<!--[\s\S]*?-->/g, ""))?.[1] ?? "";
  const sources = /(\d+) sources?/i.exec(line)?.[1];
  const moments = /(\d+) moments?/i.exec(line)?.[1];
  return { sources: sources ? Number(sources) : GATE.sources, moments: moments ? Number(moments) : GATE.moments, perSource: GATE.perSource };
}

/** Enough sources each saying enough, not one interview and a passing mention. */
export function passesGate(/** @type {Map<string, number>} */ perSource, /** @type {ReturnType<typeof gateFrom>} */ gate) {
  const counts = [...perSource.values()];
  const solid = counts.filter((n) => n >= Math.min(gate.perSource, Math.max(gate.moments, 1))).length;
  const total = counts.reduce((a, b) => a + b, 0);
  return solid >= gate.sources && total >= gate.moments;
}

/** A topic's name as a file name, in any script. */
export function slugOf(/** @type {string} */ topic) {
  return topic.normalize("NFC").toLowerCase().replace(/\+/g, " plus").replace(/#/g, " sharp").replace(/[^\p{L}\p{N}\p{M}]+/gu, "-").replace(/^-+|-+$/g, "");
}

/** `other name: name to keep`, one a line. A chain resolves to its end. */
export function parseAliases(/** @type {string} */ text) {
  const map = new Map();
  const bare = (/** @type {string} */ v) => v.trim().replace(/^(["'])(.*)\1$/, "$2").trim();
  for (const line of text.split("\n")) {
    if (/^\s*#/.test(line)) continue;
    const at = line.indexOf(": ");
    if (at < 0) continue;
    const name = bare(line.slice(at + 2).replace(/\s+#.*$/, ""));
    if (name) map.set(bare(line.slice(0, at)).toLowerCase(), name);
  }
  return map;
}

function resolve(/** @type {Map<string, string>} */ aliases, /** @type {string} */ topic) {
  let name = topic.trim();
  const seen = new Set();
  while (aliases.has(name.toLowerCase()) && !seen.has(name.toLowerCase())) {
    seen.add(name.toLowerCase());
    name = aliases.get(name.toLowerCase()) ?? name;
  }
  return name.toLowerCase();
}

const topicList = (/** @type {string} */ text) => text.replace(/^\[|\]$/g, "").split(",").map((t) => t.trim().replace(/^["']|["']$/g, "")).filter(Boolean);

/** One distillation or raw file: its front matter and sections. A section's heading may carry old topics. */
export function parseDistilled(/** @type {string} */ text) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  /** @type {Record<string, string>} */
  const fields = {};
  for (const line of (m?.[1] ?? "").split("\n")) {
    const f = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (f) fields[f[1]] = f[2].trim().replace(/^(["'])(.*)\1$/, "$2").replace(/\\"/g, '"');
  }
  const body = m ? text.slice(m[0].length) : text;
  const sections = [];
  for (const part of body.split(/^(?=## )/m)) {
    const h = /^## ([^|\n]+?)\s*(?:\|\s*(.*))?\n/.exec(part);
    if (h) sections.push({ at: h[1], topics: topicList(h[2] ?? ""), text: part.slice(h[0].length).trim() });
  }
  return { fields, topics: topicList(fields.topics ?? ""), sections, body: body.trim() };
}

const seconds = (/** @type {string} */ t) => t.split(":").reduce((n, p) => n * 60 + Number(p), 0);
const STAMP = /^\d\d:\d\d:\d\d$/;

/** A timestamped link to the moment, for a video; the page itself otherwise. */
export function linkTo(/** @type {string} */ url, /** @type {string} */ at) {
  // Only a video has a moment to open at.
  if (!STAMP.test(at) || !url || !/^https?:\/\/([^/]*\.)?(youtube\.com|youtu\.be)\//.test(url)) return url ?? "";
  return `${url}${url.includes("?") ? "&" : "?"}t=${seconds(at)}s`;
}

/** The moments in a moments file. */
export function momentsIn(/** @type {string} */ text) {
  const start = text.search(/^## Moments\s*$/m);
  if (start < 0) return [];
  const rest = text.slice(start + 1);
  const next = rest.search(/^## /m);
  return [...(next < 0 ? rest : rest.slice(0, next)).matchAll(/^- (\d\d:\d\d:\d\d) \| ([^|]*) \| (.+)$/gm)].map((m) => ({ at: m[1], topics: topicList(m[2]), text: m[3].trim() }));
}

/** @param {{ path: string, text: string, notes?: string }[]} files @param {Map<string, string>} aliases @param {ReturnType<typeof gateFrom>} [gate] */
export function buildIndex(files, aliases, gate = GATE) {
  /** One topic per file name, so "ai capex" and "ai-capex" are one and nothing overwrites anything. */
  const names = new Map();
  const nameOf = (/** @type {string} */ raw) => {
    const name = resolve(aliases, raw);
    const slug = slugOf(name);
    if (!slug) return "";
    if (!names.has(slug)) names.set(slug, name);
    return names.get(slug);
  };
  /** @type {Map<string, { entries: any[], perSource: Map<string, number>, moments: number }>} */
  const topics = new Map();
  /** @type {Map<string, Map<string, number>>} */
  const shared = new Map();
  const problems = [];
  for (const { path, text, notes } of files) {
    const list = momentsIn(text);
    if (!list.length) {
      problems.push(`${path}: no moments, left out`);
      continue;
    }
    const d = parseDistilled(text);
    const noted = parseDistilled(notes ?? "");
    const source = { path, title: d.fields.title ?? path, url: d.fields.url ?? noted.fields.url ?? "", published: noted.fields.published ?? d.fields.published ?? "", speakers: d.fields.speakers ?? noted.fields.speakers ?? "" };
    /** @type {any} */
    let whole;
    const sectionOf = (/** @type {string} */ at) => {
      // A page or document has no seconds, so its whole notes go with it.
      if (!noted.sections.some((s) => STAMP.test(s.at))) return noted.body ? (whole ??= { at: "the page", text: noted.body }) : undefined;
      const timed = noted.sections.filter((s) => STAMP.test(s.at) && seconds(s.at) <= seconds(at));
      return timed[timed.length - 1];
    };
    for (const m of list) {
      const here = [...new Set(m.topics.map(nameOf).filter(Boolean))];
      for (const name of here) {
        if (!topics.has(name)) topics.set(name, { entries: [], perSource: new Map(), moments: 0 });
        const topic = /** @type {any} */ (topics.get(name));
        topic.entries.push({ source, at: m.at, text: m.text, section: sectionOf(m.at) });
        topic.perSource.set(path, (topic.perSource.get(path) ?? 0) + 1);
        topic.moments++;
      }
      for (const a of here) for (const b of here) {
        if (a === b) continue;
        if (!shared.has(a)) shared.set(a, new Map());
        const row = /** @type {Map<string, number>} */ (shared.get(a));
        row.set(b, (row.get(b) ?? 0) + 1);
      }
    }
  }
  const relatedOf = (/** @type {string} */ name) =>
    [...(shared.get(name) ?? new Map()).entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).slice(0, RELATED_SHOWN).map(([n]) => n);
  const ordered = [...topics.entries()].map(([name, t]) => /** @type {[string, any]} */ ([name, { ...t, sources: new Set(t.perSource.keys()), passes: passesGate(t.perSource, gate) }]))
    .sort((x, y) => Number(y[1].passes) - Number(x[1].passes) || y[1].sources.size - x[1].sources.size || y[1].moments - x[1].moments || x[0].localeCompare(y[0]));
  return { ordered, relatedOf, problems };
}

const plural = (/** @type {number} */ n, /** @type {string} */ word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** One topic's file: its moments by source, oldest source first, each passage of notes once, under its moments. */
export function topicFile(/** @type {string} */ name, /** @type {any} */ topic, /** @type {string[]} */ related) {
  const when = (/** @type {any} */ e) => e.source.published || "9999";
  const entries = [...topic.entries].sort((x, y) => when(x).localeCompare(when(y)) || x.source.path.localeCompare(y.source.path) || seconds(x.at) - seconds(y.at));
  const head = [`# ${name}`, "", `${plural(topic.sources.size, "source")}, ${plural(topic.moments, "moment")}. Built by build-index.mjs; do not edit.`];
  if (related.length) head.push("", `Related: ${related.join(", ")}`);
  const parts = [];
  /** @type {any} */
  let source = null;
  /** @type {any} */
  let section = null;
  for (const e of entries) {
    if (e.source !== source) {
      source = e.source;
      section = null;
      parts.push(`## ${source.title}${source.published ? `, ${source.published}` : ""}\n\nSource file: ${source.path}`);
    }
    parts.push(`Moment ${e.at}: ${e.text}\nLink: ${linkTo(source.url, e.at)}`);
    if (e.section && e.section !== section) {
      section = e.section;
      parts.push(`Notes from ${section.at}:\n\n${section.text}`);
    }
  }
  return `${[head.join("\n"), ...parts].join("\n\n")}\n`;
}

function walk(/** @type {string} */ dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : f.endsWith(".md") ? [p] : [];
  });
}

/** Sources that kept failing are reported and never published from: their moments files. */
export function failedFiles(cwd = ".") {
  try {
    return new Set(Object.values(JSON.parse(readFileSync(join(cwd, "pipeline", "state.json"), "utf8")).items).flatMap((/** @type {any} */ i) => (i.stage === "failed" && i.file ? [i.file.replace(/^raw[/\\]/, "moments/")] : [])));
  } catch {
    return new Set();
  }
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  plain(a, HELP, "build-index");
  if (!existsSync("moments")) fail("build-index: no moments/ yet, so nothing to index", "node scripts/pipeline.mjs status");
  const failed = failedFiles();
  const every = walk("moments").sort();
  const paths = every.filter((p) => !failed.has(p));
  if (!every.length) fail("build-index: moments/ holds no files yet", "node scripts/pipeline.mjs next source");
  const aliases = existsSync("index/aliases.yaml") ? parseAliases(readFileSync("index/aliases.yaml", "utf8")) : new Map();
  const gate = existsSync("SITE.md") ? gateFrom(readFileSync("SITE.md", "utf8")) : GATE;
  const files = paths.map((path) => {
    const noteFile = join("distilled", relative("moments", path));
    return { path, text: readFileSync(path, "utf8"), ...(existsSync(noteFile) ? { notes: readFileSync(noteFile, "utf8") } : {}) };
  });
  const { ordered, relatedOf, problems } = buildIndex(files, aliases, gate);

  // Built aside and swapped in, so a stop never leaves half an index.
  mkdirSync("index", { recursive: true });
  const fresh = join("index", ".topics.new");
  rmSync(fresh, { recursive: true, force: true });
  mkdirSync(fresh);
  for (const [name, topic] of ordered) writeFileSync(join(fresh, `${slugOf(name)}.md`), topicFile(name, topic, relatedOf(name)));
  rmSync(join("index", "topics"), { recursive: true, force: true });
  renameSync(fresh, join("index", "topics"));
  const passing = ordered.filter(([, t]) => t.passes);
  const rows = ordered.map(([name, t]) => {
    const related = relatedOf(name);
    return `- ${name}: ${plural(t.sources.size, "source")}, ${plural(t.moments, "moment")}${t.passes ? "" : ", under the publish gate"}${t.moments > SPLIT_MOMENTS ? ", big enough to split" : ""}${paths.length >= WIDE_FROM && t.sources.size / paths.length >= WIDE_SHARE ? ", in nearly every source: is this the site's whole subject?" : ""}${related.length ? `; with ${related.slice(0, 3).join(", ")}` : ""}`;
  });
  writeFileSync(join("index", "topics.md"), `# Topics\n\n${plural(ordered.length, "topic")} from ${plural(paths.length, "source")}; ${passing.length} pass the publish gate. Built by build-index.mjs; do not edit. To merge names, edit aliases.yaml and rebuild.\n\n${rows.join("\n")}\n`);

  done("build-index", `${plural(ordered.length, "topic")} from ${plural(paths.length, "source")}, ${passing.length} pass the publish gate`, {
    lines: [...problems, ...(every.length > paths.length ? [`${every.length - paths.length} left out: they failed and are not published from`] : []), ...ordered.slice(0, 10).map(([name, t]) => `${name}: ${plural(t.sources.size, "source")}, ${plural(t.moments, "moment")}`), ...(ordered.length > 10 ? [`10 of ${ordered.length}; the rest are in index/topics.md`] : [])],
    next: "read index/topics.md",
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
