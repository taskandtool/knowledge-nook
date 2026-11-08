// Everything the site shows, read from the working folders at build time: pages from
// content/, the topic list from index/, each source's moments and read. Never a
// transcript's body: that stays private.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import YAML from "yaml";
import { failedFiles, parseDistilled, slugOf } from "../scripts/build-index.mjs";
import { quotesOn, words } from "../scripts/check-distilled.mjs";
import { videoId } from "../scripts/check.mjs";
import { secondsIn } from "./markdown";

export type PageType = "topic" | "guide" | "speaker" | "channel";
export const TYPES: PageType[] = ["topic", "guide", "speaker", "channel"];
export const PLURAL: Record<PageType, string> = { topic: "topics", guide: "guides", speaker: "speakers", channel: "channels" };

export type Citation = { sourceKey: string; href: string; at: number | null; quotes: string[]; label: string; claim: string };
export type Page = {
  type: PageType; slug: string; path: string; file: string; title: string; description: string; topic: string;
  broader: string[]; related: string[]; partOf: string[]; body: string; citations: Citation[]; sourceKeys: string[]; words: number;
  noindex: boolean; indexable: boolean; first?: string; updated?: string;
};
/** The source in full, in the speaker's voice: each part where it starts. */
export type ReadPart = { label: string; at: number | null; text: string };
export type Moment = { at: number; stamp: string; topics: string[]; text: string; strong: boolean; punch?: string };
export type Source = {
  key: string; path: string; title: string; url: string; channel: string; published: string; duration: string; speakers: string[];
  gist: string; moments: Moment[]; read: ReadPart[]; citedBy: Page[]; indexable: boolean;
};
export type TopicRow = { name: string; slug: string; sources: number; moments: number; passes: boolean; latest: string; page?: Page };
export type TopicEntry = { sourceKey: string; title: string; published: string; moments: number; link: string };
export type Group = { name: string; topics: TopicRow[] };
export type Settings = { name: string; url: string; language: string; corrections: string; about: string; audience: string; gateSources: number; gateWords: number };
export type Site = {
  /** The written pages that have their own picture for shared links, set by the build. */
  shareImages?: Set<string>;
  settings: Settings; pages: Page[]; byPath: Map<string, Page>; sources: Map<string, Source>; topics: TopicRow[]; groups: Group[];
  entriesOf: (slug: string) => TopicEntry[]; nearbyOf: (slug: string) => { name: string; slug: string; page?: Page }[];
  resolve: (name: string) => Page | undefined;
};

export const DATES_FILE = join("content", ".dates.json");
const DEFAULT_GATE = { sources: 2, words: 300 };

const clean = (text: unknown) => String(text ?? "").replace(/[<>]/g, "").trim();
const list = (value: unknown): string[] => (Array.isArray(value) ? value : value ? [value] : []).map(clean).filter(Boolean);

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : f.endsWith(".md") ? [p] : [];
  });
}

/** The owner's lines in SITE.md: `Site name: ...`, and the prose under two headings. */
export function readSettings(text: string): Settings {
  const bare = text.replace(/<!--[\s\S]*?-->/g, "");
  const line = (label: string) => new RegExp(`^${label}: *(.*)$`, "mi").exec(bare)?.[1]?.trim() ?? "";
  const section = (heading: string) => new RegExp(`^## ${heading}\\s*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, "m").exec(bare)?.[1]?.trim() ?? "";
  const gate = /(\d+) sources?(?:,? *(\d+) words)?/i.exec(line("Publish gate"));
  return {
    name: clean(line("Site name")) || "Knowledge Nook",
    url: clean(line("Address")).replace(/\/+$/, ""),
    language: /^[a-z]{2,3}(-[A-Za-z0-9]+)*$/.test(line("Language")) ? line("Language") : "en",
    corrections: clean(line("Corrections")),
    about: clean(section("What it's about")),
    audience: clean(section("Who it's for")),
    gateSources: gate ? Number(gate[1]) : DEFAULT_GATE.sources,
    gateWords: gate?.[2] ? Number(gate[2]) : DEFAULT_GATE.words,
  };
}

/** Which source a link names, by the key the source goes by here. */
function keyOfLink(href: string, known: Map<string, string>) {
  return videoId(href) ?? known.get(href.split("#")[0]);
}

/** The last sentence of the words a link vouches for, as plain text. */
function lastSentence(text: string) {
  const plain = text.replace(/^\s*(?:[-*]|\d+[.)])\s+/, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, "").replace(/\(\s*$/, "").replace(/^[\s)]*[.,;:]?\s*/, "").trim();
  const parts = plain.split(/(?<=[.!?][”"]?)\s+(?=[“"A-Z])/);
  let last = parts.length - 1;
  // A sentence break inside a quotation is not the sentence's start.
  const open = (text: string) => (text.match(/“/g) ?? []).length - (text.match(/”/g) ?? []).length;
  let balance = open(parts[last]);
  while (balance < 0 && last > 0) balance += open(parts[--last]);
  const sentence = clean(parts.slice(last).join(" "));
  // Mid-sentence, after an earlier link: say so rather than pass it off as whole.
  return /^\p{Ll}/u.test(sentence) ? `…${sentence}` : sentence;
}

/** Each link in a page's body, with the quotes in the words since the link before it. */
export function citationsIn(body: string, known: Map<string, string>): Citation[] {
  const out: Citation[] = [];
  for (const line of body.split("\n")) {
    let from = 0;
    let said = "";
    for (const link of line.matchAll(/\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g)) {
      const claim = line.slice(from, link.index).replace(/\[[^\]]*$/, "");
      from = (link.index ?? 0) + link[0].length;
      const sourceKey = keyOfLink(link[2], known);
      // A second link straight after the first vouches for the same words.
      said = lastSentence(claim) || said;
      if (sourceKey) out.push({ sourceKey, href: link[2], at: secondsIn(link[2]), quotes: quotesOn(claim).quotes, label: link[1], claim: said });
    }
  }
  return out;
}

const seconds = (stamp: string) => stamp.split(":").reduce((n, p) => n * 60 + Number(p), 0);

/** A moments file: its gist, and each moment, marked where the gist's picks name it. */
export function parseMoments(text: string) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  const fields: Record<string, string> = {};
  for (const line of (m?.[1] ?? "").split("\n")) {
    const f = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (f) fields[f[1]] = f[2].trim().replace(/^(["'])(.*)\1$/, "$2").replace(/\\"/g, '"');
  }
  const body = m ? text.slice(m[0].length) : text;
  const part = (name: string) => new RegExp(`^## ${name}\\s*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m").exec(body)?.[1]?.trim() ?? "";
  const picks = [...part("Strongest").matchAll(/^- (\d\d:\d\d:\d\d) (.+)$/gm)];
  // With no seconds, as on a web page, the words are what match.
  const pickOf = (stamp: string, text: string) => picks.find((x) => x[1] === stamp && (seconds(stamp) > 0 || x[2].trim() === text.trim()));
  // A pick's own line is the short one, for showing large; its outer quote marks go with it.
  const punchOf = (pick: RegExpMatchArray) => clean(pick[2]).replace(/^["“](.*)["”]$/, "$1");
  const moments: Moment[] = [...part("Moments").matchAll(/^- (\d\d:\d\d:\d\d) \| ([^|]*) \| (.+)$/gm)].map((x) => {
    const pick = pickOf(x[1], x[3]);
    return { at: seconds(x[1]), stamp: x[1], topics: x[2].split(",").map((t) => clean(t).toLowerCase()).filter(Boolean), text: clean(x[3]), strong: !!pick, punch: pick ? punchOf(pick) : undefined };
  });
  const speakers = (fields.speakers ?? "").replace(/^\[|\]$/g, "").split(",").map(clean).filter(Boolean);
  return { fields, speakers, gist: part("Gist").replace(/[<>]/g, ""), moments };
}

const sourceKeyOf = (file: string, id?: string) => id || slugOf(file.replace(/^distilled\//, "").replace(/\.md$/, ""));

export type Turn = { speaker: string; paragraphs: string[] };

/** "Sam Ortiz: Hello." and the paragraphs after it, as one person's turn. A name counts only when the source names that speaker. */
export function turnsOf(text: string, speakers: string[], current = ""): Turn[] {
  const known = (name: string) => speakers.find((s) => s === name || s.split(" ").includes(name));
  const turns: Turn[] = [];
  for (const paragraph of text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)) {
    const m = /^(\p{Lu}[\p{L}.'’-]*(?: \p{Lu}[\p{L}.'’-]*){0,2}): +([\s\S]+)$/u.exec(paragraph);
    const named = m ? known(m[1]) : undefined;
    const speaker = named ?? current;
    const words = named ? (m as RegExpExecArray)[2] : paragraph;
    if (turns.length && turns[turns.length - 1].speaker === speaker && !named) turns[turns.length - 1].paragraphs.push(words);
    else if (turns.length && turns[turns.length - 1].speaker === speaker) turns[turns.length - 1].paragraphs.push(words);
    else turns.push({ speaker, paragraphs: [words] });
    current = speaker;
  }
  return turns;
}

/** "Sam Ortiz" to "SO". */
export const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase()).slice(0, 2).join("");

/** What a reader sees of the read: not caption fixes, and not the notes of what was cut. */
function readOf(sections: { at: string; text: string }[]): ReadPart[] {
  return sections.map((s) => ({
    label: s.at, at: /^\d\d:\d\d:\d\d$/.test(s.at) ? seconds(s.at) : null,
    text: s.text.replace(/\s*\[caption: [^\]]*\]/g, "").replace(/^\(\d\d:\d\d:\d\d to \d\d:\d\d:\d\d:[^\n]*\)\s*$/gm, "").trim(),
  })).filter((p) => p.text);
}

/** A source's public details: the top of its raw file for the channel, the distillation for the rest. */
function readSources(cwd: string) {
  const sources = new Map<string, Source>();
  const byFile = new Map<string, string>();
  const byUrl = new Map<string, string>();
  for (const abs of walk(join(cwd, "distilled"))) {
    const file = relative(cwd, abs);
    const d = parseDistilled(readFileSync(abs, "utf8"));
    const rawFile = join(cwd, "raw", relative(join(cwd, "distilled"), abs));
    const top = existsSync(rawFile) ? parseDistilled(readFileSync(rawFile, "utf8")).fields : ({} as Record<string, string>);
    const url = d.fields.url ?? top.url ?? "";
    const key = sourceKeyOf(file, top.id ?? videoId(url));
    const speakers = d.fields.speakers ? d.fields.speakers.replace(/^\[|\]$/g, "").split(",").map(clean).filter(Boolean) : [];
    sources.set(key, {
      key, path: `/sources/${key}`, title: clean(d.fields.title) || key, url, channel: clean(top.channel), published: d.fields.published ?? "",
      duration: top.duration ?? "", speakers, gist: "", moments: [], read: readOf(d.sections), citedBy: [], indexable: false,
    });
    byFile.set(file, key);
    if (url) byUrl.set(url, key);
  }
  // A source's moments are enough for its page, notes or no notes.
  const failed = failedFiles(cwd);
  // A source that kept failing shows nothing.
  for (const f of failed) {
    const s = sources.get(byFile.get(String(f).replace(/^moments/, "distilled")) ?? "");
    if (s) s.read = [];
  }
  for (const abs of walk(join(cwd, "moments"))) {
    if (failed.has(relative(cwd, abs))) continue;
    const rawFile = join(cwd, "raw", relative(join(cwd, "moments"), abs));
    const top = existsSync(rawFile) ? parseDistilled(readFileSync(rawFile, "utf8")).fields : ({} as Record<string, string>);
    const parsed = parseMoments(readFileSync(abs, "utf8"));
    const url = parsed.fields.url ?? top.url ?? "";
    const key = sourceKeyOf(join("distilled", relative(join(cwd, "moments"), abs)), top.id ?? videoId(url));
    const known = sources.get(key);
    const entry: Source = known ?? {
      key, path: `/sources/${key}`, title: clean(parsed.fields.title ?? top.title) || key, url, channel: clean(top.channel), published: top.published ?? "",
      duration: top.duration ?? "", speakers: parsed.speakers, gist: "", moments: [], read: [], citedBy: [], indexable: false,
    };
    entry.gist = parsed.gist;
    entry.moments = parsed.moments;
    if (!entry.speakers.length) entry.speakers = parsed.speakers;
    sources.set(key, entry);
    byFile.set(relative(cwd, abs), key);
    if (url) byUrl.set(url, key);
  }
  return { sources, byFile, byUrl };
}

function readPage(cwd: string, abs: string, type: PageType, known: Map<string, string>, gate: { sources: number; words: number }): Page | null {
  const text = readFileSync(abs, "utf8");
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!m) return null;
  let front: Record<string, unknown>;
  try {
    front = YAML.parse(m[1]) ?? {};
  } catch {
    return null;
  }
  const slug = abs.split("/").pop()!.replace(/\.md$/, "");
  // The title is shown from the front matter, so a heading repeating it goes.
  const body = text.slice(m[0].length).replace(/^\s*# .*\n/, "").trim();
  const citations = citationsIn(body, known);
  const sourceKeys = [...new Set(citations.map((c) => c.sourceKey))];
  const count = words(body.replace(/\]\([^)]*\)/g, "]")).length;
  const noindex = front.noindex === true;
  return {
    type, slug, path: `/${PLURAL[type]}/${slug}`, file: relative(cwd, abs), title: clean(front.title) || slug, description: clean(front.description), topic: clean(front.topic),
    broader: list(front.broader), related: list(front.related), partOf: list(front.part_of), body, citations, sourceKeys, words: count, noindex,
    indexable: !noindex && sourceKeys.length >= gate.sources && count >= gate.words,
  };
}

function parseTopicRows(text: string) {
  const rows: { name: string; sources: number; moments: number; passes: boolean }[] = [];
  for (const m of text.matchAll(/^- (.+?): (\d+) sources?, (\d+) moments?(, under the publish gate)?/gm)) {
    rows.push({ name: m[1], sources: Number(m[2]), moments: Number(m[3]), passes: !m[4] });
  }
  return rows;
}

/** Which sources a topic file draws on, and how many moments from each. Never its notes. */
export function parseTopicFile(text: string, keyOfFile: (file: string) => string | undefined) {
  // The header's line only: below it is a section's private text.
  const related = /^Related: (.+)$/m.exec(text.split(/^## /m)[0])?.[1]?.split(", ").map((t) => t.trim()) ?? [];
  const entries = new Map<string, TopicEntry>();
  for (const part of text.split(/^(?=## )/m).slice(1)) {
    const file = /^Source file: (.+)$/m.exec(part)?.[1]?.trim();
    const key = file && keyOfFile(file);
    if (!key) continue;
    const link = /^Link: (.+)$/m.exec(part)?.[1]?.trim() ?? "";
    const entry = entries.get(key) ?? { sourceKey: key, title: "", published: "", moments: 0, link };
    entry.moments += (part.match(/^Moment \d/gm) ?? []).length;
    entries.set(key, entry);
  }
  return { related, entries: [...entries.values()] };
}

/** index/tree.md's top branches, each with the topics anywhere under it. */
function readGroups(text: string | null, topics: TopicRow[]): Group[] {
  const bySlug = new Map(topics.map((t) => [t.slug, t]));
  // Only what a reader can open.
  const shown = (t: TopicRow) => !!t.page;
  const groups: Group[] = [];
  const placed = new Set<string>();
  for (const line of (text ?? "").split("\n")) {
    const m = /^(\s*)- (.+)$/.exec(line);
    if (!m) continue;
    if (!m[1].length) groups.push({ name: clean(m[2]), topics: [] });
    const row = bySlug.get(slugOf(m[2]));
    if (row && shown(row) && !placed.has(row.slug)) {
      placed.add(row.slug);
      groups[groups.length - 1]?.topics.push(row);
    }
  }
  const rest = topics.filter((t) => shown(t) && !placed.has(t.slug));
  if (rest.length) groups.push({ name: groups.length ? "Other topics" : "Topics", topics: rest });
  return groups.filter((g) => g.topics.length);
}

export function loadSite(cwd = process.cwd()): Site {
  const read = (file: string) => (existsSync(join(cwd, file)) ? readFileSync(join(cwd, file), "utf8") : null);
  const settings = readSettings(read("SITE.md") ?? "");
  const { sources, byFile, byUrl } = readSources(cwd);
  const gate = { sources: settings.gateSources, words: settings.gateWords };
  const pages = TYPES.flatMap((type) =>
    walk(join(cwd, "content", PLURAL[type])).flatMap((abs) => readPage(cwd, abs, type, byUrl, gate) ?? []),
  ).sort((a, b) => a.title.localeCompare(b.title));
  const dates: Record<string, { first?: string; updated?: string }> = JSON.parse(read(DATES_FILE) ?? "{}");
  for (const p of pages) Object.assign(p, dates[p.file] ?? {});
  const byPath = new Map(pages.map((p) => [p.path, p]));

  // A source page is here because a page cites it, or the owner wrote a summary of it.
  for (const p of pages) for (const key of p.sourceKeys) sources.get(key)?.citedBy.push(p);
  for (const s of sources.values()) s.indexable = !!s.gist && s.citedBy.some((p) => p.indexable);

  const pageOfTopic = new Map<string, Page>();
  for (const p of pages) if (p.type === "topic") for (const n of [p.slug, slugOf(p.topic)]) if (n && !pageOfTopic.has(n)) pageOfTopic.set(n, p);
  const anyPage = new Map<string, Page>();
  for (const p of [...pages].sort((a, b) => TYPES.indexOf(a.type) - TYPES.indexOf(b.type))) if (!anyPage.has(p.slug)) anyPage.set(p.slug, p);
  const resolve = (name: string) => pageOfTopic.get(slugOf(name)) ?? anyPage.get(slugOf(name)) ?? anyPage.get(name);

  const topicFiles = new Map<string, ReturnType<typeof parseTopicFile>>();
  const parsed = (slug: string) => {
    if (!topicFiles.has(slug)) topicFiles.set(slug, parseTopicFile(read(join("index", "topics", `${slug}.md`)) ?? "", (f) => byFile.get(f)));
    return topicFiles.get(slug)!;
  };
  const entriesOf = (slug: string) =>
    parsed(slug).entries.map((e) => {
      const s = sources.get(e.sourceKey);
      return { ...e, title: s?.title ?? e.sourceKey, published: s?.published ?? "" };
    }).sort((a, b) => (a.published || "9999").localeCompare(b.published || "9999"));
  const topics: TopicRow[] = parseTopicRows(read(join("index", "topics.md")) ?? "").map((r) => {
    const slug = slugOf(r.name);
    return { ...r, slug, page: pageOfTopic.get(slug), latest: "" };
  });
  for (const t of topics) t.latest = entriesOf(t.slug).map((e) => e.published).filter(Boolean).pop() ?? "";
  return {
    settings, pages, byPath, sources, topics, groups: readGroups(read(join("index", "tree.md")), topics), entriesOf, resolve,
    nearbyOf: (slug) => parsed(slug).related.map((name) => ({ name, slug: slugOf(name), page: pageOfTopic.get(slugOf(name)) })),
  };
}
