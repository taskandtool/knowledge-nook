#!/usr/bin/env node
// What to read and getting it: a channel's videos into sources/, their
// transcripts into raw/. ScrapeCreators through the machine's gateway, because
// YouTube blocks machines like ours. No AI, so a command job can run it.
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { done, fail, flag, flags, has, limitOf, machineEnv, misused, noMore, parseArgs, usage } from "../src/data/cli.mjs";

const HELP = `usage: node scripts/sources.mjs <command>

  list [channel] [--max-pages N] [--full] [--since YYYY-MM-DD] [--min-minutes N] [--language CODE]
      A channel's videos into sources/<channel>.json, with their count, hours and
      the credits to fetch them. Costs 1 credit per page. Safe to run again: it adds
      what is new and stops at the first page with nothing new. --full reads every
      page, and only that flags videos that have gone. With no channel, every channel
      in sources/. A channel is @handle, a channel URL or a UC... id. --since,
      --min-minutes and --language set what to leave out, and stay until changed;
      --language is a caption language such as en, and a video without it counts as
      having no captions.

  fetch [channel] [--limit N] [--id VIDEO]... [--max-minutes N] [--confirm]
      Pending videos into raw/youtube/<channel>/<date>-<id>.md, newest first. Costs
      about 2 credits a video; a video with no captions costs nothing, and is tried
      again while under 14 days old, since captions come late. Previews without
      --confirm. Resumes after a stop and never pays twice for a file it has. A video
      that fails 3 times is left alone until named with --id. Stops starting videos
      after --max-minutes (default 25).

  crawl [url] [--max-pages N]
      A website's pages into raw/web/<host>/, with tt-crawl: no credits, no AI. Remembers
      the site in sources/sites.txt; with no url, reads every site again in place and
      says how many pages changed. A site's dated posts come through where it has a feed.

Prints what happened, one line per channel; failures go to stderr with a Try line.
Exit 0 done, 1 failed or refused, 2 used wrongly.`;

const LISTED = "node scripts/sources.mjs list @handle";
const CONNECT = `python3 ~/tools/taskandtool.py request-connection scrapecreators --why "To read YouTube channels and their transcripts"`;
const SLUG = /^[\p{L}\p{N}._-]+$/u;
const WORKERS = 4;
const RETRIES = 3;
const MAX_ATTEMPTS = 3;
const YOUNG_DAYS = 14;
const LOCK = join("sources", ".fetch.lock");

/** @param {string} raw */
export function parseChannel(raw) {
  const text = raw.trim();
  const fromUrl = /^(?:https?:\/\/)?(?:www\.|m\.)?youtube\.com\/(@[^/?#]+|channel\/[^/?#]+)/i.exec(text)?.[1];
  const word = fromUrl ? decodeURIComponent(fromUrl) : text;
  const id = /^(?:channel\/)?(UC[\w-]{22})$/.exec(word)?.[1];
  if (id) return { key: id, param: { channelId: id } };
  if (word.includes("/")) return null;
  const handle = word.replace(/^@/, "");
  if (!SLUG.test(handle) || /^\.+$/.test(handle)) return null;
  // Handles ignore case, so @Chan and @chan are one channel and one file.
  return { key: handle.toLowerCase(), param: { handle } };
}

/** How this app reaches ScrapeCreators, or the ask for a connection. */
function vendor() {
  const env = machineEnv();
  if (env.PHOENIX_URL && env.MACHINE_TOKEN) return { base: `${env.PHOENIX_URL.replace(/\/+$/, "")}/api/machine/gateway/scrapecreators`, key: env.MACHINE_TOKEN };
  const own = env.SCRAPECREATORS_API_KEY ?? env.SCRAPE_CREATORS_API_KEY;
  if (own) return { base: env.SCRAPECREATORS_BASE_URL ?? "https://api.scrapecreators.com", key: own };
  return fail("sources: this app has no ScrapeCreators connection", CONNECT);
}

/** A problem that ends the whole run, because every later call would hit it too. */
class Halt extends Error {
  /** @param {string} message @param {string} tryCmd */
  constructor(message, tryCmd) {
    super(message);
    this.tryCmd = tryCmd;
  }
}

/** One video's problem; the rest carry on. */
class Skip extends Error {}

const wait = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/** A call to ScrapeCreators, with backoff inside, counting what it charged. */
function client() {
  const { base, key } = vendor();
  const spent = { credits: 0 };
  /** @param {string} path @param {Record<string, string>} params */
  const call = async (path, params) => {
    const url = `${base}${path}?${new URLSearchParams(params)}`;
    let last = "";
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
      if (attempt) await wait(1000 * 2 ** (attempt - 1));
      let res;
      try {
        res = await fetch(url, { headers: { "x-api-key": key }, signal: AbortSignal.timeout(120_000) });
      } catch (e) {
        last = `could not reach it (${e instanceof Error ? e.message : e})`;
        continue;
      }
      const refusal = res.headers.get("x-tasktool-refusal");
      // A refusal over load or an outage passes; the rest need a person.
      if (refusal && res.status !== 429 && res.status < 500) throw new Halt(`Task & Tool refused the ScrapeCreators call (${refusal})`, CONNECT);
      if (res.status === 401) throw new Halt("ScrapeCreators refused the key (401)", CONNECT);
      if (res.status === 402) throw new Halt("ScrapeCreators is out of credits (402)", "add credits at https://app.scrapecreators.com, then run this again");
      if (res.status === 429 || res.status >= 500) {
        last = `ScrapeCreators answered ${res.status}`;
        continue;
      }
      const text = await res.text();
      if (!res.ok) throw new Skip(`ScrapeCreators answered ${res.status}: ${text.slice(0, 200)}`);
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        throw new Skip(`ScrapeCreators answered something other than JSON: ${text.slice(0, 200)}`);
      }
      spent.credits += Number(body?.credits_charged) || 0;
      return body;
    }
    // An outage is no video's fault: stop, so nothing is marked failed for it.
    throw new Halt(`${last}, after ${RETRIES + 1} tries`, "run this again in a few minutes; progress is kept");
  };
  return { call, spent };
}

const fileOf = (/** @type {string} */ key) => join("sources", `${key}.json`);

/** @param {string} key */
export function loadChannel(key) {
  const path = fileOf(key);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fail(`sources: ${path} is not valid JSON`, `fix ${path}, or delete it and run ${LISTED}`);
  }
}

/** Written whole and renamed, so a stop never leaves half a file. */
function saveChannel(channel) {
  mkdirSync("sources", { recursive: true });
  const path = fileOf(channel.channel);
  writeFileSync(`${path}.tmp`, `${JSON.stringify(channel, null, 2)}\n`);
  renameSync(`${path}.tmp`, path);
}

export function knownChannels() {
  return existsSync("sources") ? readdirSync("sources").filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort() : [];
}

/** @param {string[]} rest @param {string} at */
function chosen(rest, at) {
  noMore(rest, 1, at);
  if (!rest.length) {
    const all = knownChannels();
    if (!all.length) fail(`${at}: no channels in sources/ yet`, LISTED);
    return all.map((key) => ({ key, param: loadChannel(key).param }));
  }
  const parsed = parseChannel(rest[0]);
  if (!parsed) misused(`${at}: ${rest[0]} is not a channel; give @handle, a channel URL or a UC... id`, LISTED);
  return [parsed];
}

const hours = (/** @type {any[]} */ videos) => (videos.reduce((n, v) => n + (v.seconds || 0), 0) / 3600).toFixed(1);
const isYoung = (/** @type {any} */ v) => !v.published || Date.now() - Date.parse(v.published) < YOUNG_DAYS * 86_400_000;

/** Whether the channel's scope leaves this video out. */
function leftOut(/** @type {any} */ channel, /** @type {any} */ v) {
  const scope = channel.leave_out ?? {};
  return !!((scope.since && v.published && v.published < scope.since) || (scope.min_minutes && v.seconds && v.seconds < scope.min_minutes * 60));
}

/** @param {any} channel @param {any} v */
export function isPending(channel, v) {
  if (v.gone || leftOut(channel, v)) return false;
  if (v.state === "pending") return true;
  if (v.state === "failed") return (v.attempts ?? 0) < MAX_ATTEMPTS;
  return v.state === "no_captions" && isYoung(v);
}

/** One spending run at a time, so a chat's and a job's never pay for the same video or lose each other's writes. */
function takeLock(/** @type {string} */ at) {
  mkdirSync("sources", { recursive: true });
  for (let tries = 0; tries < 2; tries++) {
    try {
      writeFileSync(LOCK, String(process.pid), { flag: "wx" });
      process.on("exit", () => rmSync(LOCK, { force: true }));
      return;
    } catch {
      const pid = Number(readFileSync(LOCK, "utf8"));
      try {
        process.kill(pid, 0);
        fail(`${at}: another list or fetch is running (process ${pid})`, "wait for it, then run this again");
      } catch (e) {
        if (/** @type {any} */ (e).code !== "ESRCH") throw e;
        rmSync(LOCK, { force: true });
      }
    }
  }
}

/** What this list's flags say to leave out, on top of what the channel already leaves out. */
function scopeFrom(/** @type {any} */ a, /** @type {any} */ before) {
  const scope = { ...(before?.leave_out ?? {}) };
  const since = flag(a, "since");
  if (since !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) misused(`sources list: --since is a date like 2020-01-31, not ${since}`, "node scripts/sources.mjs --help");
    scope.since = since;
  }
  const minutes = wholeNumber(a, "min-minutes", "sources list");
  if (minutes) scope.min_minutes = minutes;
  const language = flag(a, "language");
  if (language !== undefined) {
    if (!/^[a-zA-Z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(language)) misused(`sources list: --language is a code like en, pt-BR or zh-Hans, not ${language}`, "node scripts/sources.mjs --help");
    scope.language = language;
  }
  return scope;
}

/** @param {any} a @param {string[]} rest */
async function list(a, rest) {
  const pagesAllowed = wholeNumber(a, "max-pages", "sources list");
  const targets = chosen(rest, "sources list");
  scopeFrom(a, null);
  const { call, spent } = client();
  takeLock("sources list");
  const lines = [];
  const problems = [];
  let nextChannel = "";
  const summary = () => `${targets.length} channel${targets.length === 1 ? "" : "s"}, ${spent.credits} credits spent`;
  for (const { key, param } of targets) {
    const before = loadChannel(key);
    const known = new Map((before?.videos ?? []).map((/** @type {any} */ v) => [v.id, v]));
    const seen = [];
    const seenIds = new Set();
    let token = "";
    let pages = 0;
    let complete = false;
    let caughtUp = false;
    /** @type {unknown} */
    let failure = null;
    try {
      while (true) {
        const page = await call("/v1/youtube/channel-videos", { ...param, sort: "latest", ...(token ? { continuationToken: token } : {}) });
        pages++;
        const got = page?.videos ?? [];
        const videos = got.filter((/** @type {any} */ v) => /^[\w-]+$/.test(v?.id ?? "") && !seenIds.has(v.id));
        for (const v of videos) {
          seenIds.add(v.id);
          seen.push(v);
        }
        const next = page?.continuationToken;
        // Only a last page with videos on it ends the walk: an empty answer proves nothing.
        if (!next) {
          complete = got.length > 0;
          break;
        }
        if (next === token || !videos.length) break;
        // A channel listed in full before: once a page holds nothing new, the rest is known.
        if (before?.complete && !has(a, "full") && videos.every((/** @type {any} */ v) => known.has(v.id))) {
          caughtUp = true;
          break;
        }
        if (pagesAllowed && pages >= pagesAllowed) break;
        token = next;
      }
    } catch (e) {
      failure = e;
    }
    if (failure instanceof Halt) saveWalk();
    if (failure instanceof Halt) halted(failure, "sources list");
    if (failure && !seen.length) {
      problems.push(`${key}: ${failure instanceof Error ? failure.message : failure}`);
      continue;
    }
    if (!seen.length && !before) {
      problems.push(`${key}: no videos found`);
      continue;
    }
    // @handle and UC... are one channel: two files would pay for every video twice.
    const twin = before ? undefined : knownChannels().find((other) => other !== key && loadChannel(other).videos.some((/** @type {any} */ v) => seenIds.has(v.id)));
    if (twin) {
      problems.push(`${key}: is the channel already listed as ${twin}, left alone`);
      continue;
    }
    const channel = saveWalk();
    const pending = channel.videos.filter((/** @type {any} */ v) => isPending(channel, v));
    const gone = channel.videos.filter((/** @type {any} */ v) => v.gone).length;
    const out = channel.videos.filter((/** @type {any} */ v) => leftOut(channel, v)).length;
    lines.push(`${key}: ${channel.videos.length} videos, ${hours(channel.videos)} hours; ${channel.added} new${gone ? `, ${gone} gone` : ""}${out ? `, ${out} left out by scope` : ""}${channel.complete ? "" : `, more on later pages (first ${pages} read)`}`);
    lines.push(`  ${fileOf(key)}: ${pending.length} pending, about ${pending.length * 2} credits to fetch`);
    if (failure) problems.push(`${key}: ${failure instanceof Error ? failure.message : failure}; what was listed is kept`);
    nextChannel = key;
    delete channel.added;

    /** Writes what this walk found, paid for whatever stopped it. */
    function saveWalk() {
      let added = 0;
      // Newer than all we knew is new; older is the back catalogue, however late it was listed.
      const newest = (before?.videos ?? []).map((/** @type {any} */ v) => v.published ?? "").sort().pop() ?? "";
      const fresh = seen.map((v) => {
        const had = known.get(v.id);
        if (had) {
          delete had.gone;
          return had;
        }
        added++;
        return { id: v.id, title: v.title, url: v.url ?? `https://www.youtube.com/watch?v=${v.id}`, published: /^\d{4}-\d{2}-\d{2}/.exec(v.publishedTime ?? "")?.[0], ...(newest && (v.publishedTime ?? "").slice(0, 10) >= newest ? { fresh: true } : {}), seconds: v.lengthSeconds, state: "pending" };
      });
      const older = (before?.videos ?? []).filter((/** @type {any} */ v) => !seenIds.has(v.id));
      // Only a full walk can tell that a video has gone.
      if (complete) for (const v of older) v.gone = true;
      const scope = scopeFrom(a, before);
      // A new caption language may have what the old one lacked.
      if (scope.language !== before?.leave_out?.language) {
        for (const v of [...fresh, ...older]) if (v.state === "no_captions") v.state = "pending";
      }
      const record = { ...before, kind: "youtube", channel: key, param, listed_at: new Date().toISOString(), complete: complete || (!!before?.complete && caughtUp), leave_out: scope, videos: [...fresh, ...older] };
      saveChannel(record);
      return { ...record, added };
    }
  }
  if (problems.length) {
    fail(`sources list: ${summary()}, and ${problems.length} channel${problems.length === 1 ? "" : "s"} had a problem\n${[...lines, ...problems].map((l) => `  ${l}`).join("\n")}`, `check the channel on YouTube, then ${LISTED}`);
  }
  done("sources list", summary(), { lines, next: `node scripts/sources.mjs fetch ${targets.length === 1 ? nextChannel : ""}`.trim() });
}

/** @param {any} a @param {string} name @param {string} at */
function wholeNumber(a, name, at) {
  if (!has(a, name)) return 0;
  const v = flag(a, name) ?? "";
  if (!/^[1-9]\d*$/.test(v)) misused(`${at}: --${name} is a whole number`, "node scripts/sources.mjs --help");
  return Number(v);
}

/** @param {any} a @param {string[]} rest */
async function fetchAll(a, rest) {
  const limit = has(a, "limit") ? limitOf(a, "sources fetch", { max: 100000 }) : Infinity;
  const ids = flags(a, "id");
  const minutes = wholeNumber(a, "max-minutes", "sources fetch") || 25;
  const targets = chosen(rest, "sources fetch");
  const channels = targets.map(({ key }) => loadChannel(key) ?? fail(`sources fetch: ${key} is not listed yet`, `node scripts/sources.mjs list ${key}`));

  const every = channels.flatMap((channel) => channel.videos.map((/** @type {any} */ video) => ({ channel, video })));
  for (const id of ids) {
    if (!every.some((w) => w.video.id === id)) fail(`sources fetch: no video ${id} in sources/`, `node scripts/sources.mjs list ${targets[0].key}`);
  }
  const wanted = (/** @type {any} */ w) => (ids.length ? ids.includes(w.video.id) && w.video.state !== "fetched" : isPending(w.channel, w.video));
  const work = every.filter(wanted).slice(0, limit);
  if (!work.length) {
    const count = (/** @type {string} */ state) => every.filter((w) => w.video.state === state).length;
    const stuck = every.filter((w) => w.video.state === "failed").length;
    done("sources fetch", "nothing pending, left alone", { lines: [`${count("fetched")} fetched, ${count("no_captions")} with no captions${stuck ? `, ${stuck} failed ${MAX_ATTEMPTS} times (name one with --id to try again)` : ""}`], next: "ls raw/youtube" });
    return;
  }
  const { call, spent } = client();
  if (!has(a, "confirm")) {
    const again = ["node scripts/sources.mjs fetch", rest[0] ? targets[0].key : "", has(a, "limit") ? `--limit ${limit}` : "", ...ids.map((i) => `--id ${i}`), has(a, "max-minutes") ? `--max-minutes ${minutes}` : ""].filter(Boolean).join(" ");
    done("sources fetch", `would fetch ${work.length} videos, ${hours(work.map((w) => w.video))} hours, about ${work.length * 2} credits`, { waits: again });
    return;
  }
  takeLock("sources fetch");

  const deadline = Date.now() + minutes * 60_000;
  const queue = [...work];
  const counts = { fetched: 0, no_captions: 0, failed: 0, kept: 0 };
  const problems = [];
  /** @type {Halt | null} */
  let halt = null;
  const worker = async () => {
    while (queue.length && !halt && Date.now() < deadline) {
      const { channel, video } = /** @type {any} */ (queue.shift());
      try {
        const outcome = await fetchOne(channel, video, call, problems);
        counts[outcome]++;
        delete video.error;
        delete video.attempts;
      } catch (e) {
        if (e instanceof Halt) {
          if (video.state === "fetched") counts.fetched++;
          halt = e;
          return;
        }
        counts.failed++;
        video.state = "failed";
        video.attempts = (video.attempts ?? 0) + 1;
        video.error = e instanceof Error ? e.message : String(e);
        problems.push(`${video.id}: ${video.error}${video.attempts >= MAX_ATTEMPTS ? `; left alone after ${MAX_ATTEMPTS} tries` : ""}`);
      }
      saveChannel(channel);
    }
  };
  await Promise.all(Array.from({ length: WORKERS }, worker));

  const summary = `${counts.fetched} fetched, ${counts.kept} already on disk, ${counts.no_captions} with no captions, ${counts.failed} failed; ${spent.credits} credits spent`;
  if (halt) fail(`sources fetch: stopped: ${/** @type {Halt} */ (halt).message}\n  ${summary}; progress is kept`, /** @type {Halt} */ (halt).tryCmd);
  const left = every.filter((w) => isPending(w.channel, w.video)).length;
  const lines = [...problems.slice(0, 10), ...(problems.length > 10 ? [`${problems.length - 10} more; each video's error is in sources/`] : [])];
  if (queue.length) lines.push(`stopped at ${minutes} minutes; run it again to carry on`);
  if (left) lines.push(`${left} still pending`);
  if (counts.failed) fail(`sources fetch: ${summary}\n${lines.map((l) => `  ${l}`).join("\n")}`, "node scripts/sources.mjs fetch --confirm");
  done("sources fetch", summary, { lines, next: "ls raw/youtube" });
}

/** One video into raw/. Transcript first: it costs nothing when there are no captions. */
async function fetchOne(channel, video, call, notes) {
  const dir = join("raw", "youtube", channel.channel);
  const onDisk = existsSync(dir) ? readdirSync(dir).find((f) => f.endsWith(`-${video.id}.md`)) : undefined;
  if (onDisk) {
    video.state = "fetched";
    video.file = join(dir, onDisk);
    return "kept";
  }
  const language = channel.leave_out?.language;
  const transcript = await call("/v1/youtube/video/transcript", { url: video.url, ...(language ? { language } : {}) });
  if (!Array.isArray(transcript?.transcript) || !transcript.transcript.length) {
    video.state = "no_captions";
    return "no_captions";
  }
  // Paid for: a transcript is kept even when its details cannot be had.
  let details = {};
  /** @type {Halt | null} */
  let halt = null;
  try {
    details = (await call("/v1/youtube/video", { url: video.url })) ?? {};
  } catch (e) {
    if (e instanceof Halt) halt = e;
    else notes.push(`${video.id}: kept the transcript without its details (${e instanceof Error ? e.message : e})`);
  }
  const published = /^\d{4}-\d{2}-\d{2}/.exec(details.publishDate ?? "")?.[0] ?? video.published;
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${published ?? "undated"}-${video.id}.md`);
  writeFileSync(`${path}.tmp`, renderRaw({ ...details, id: video.id, url: video.url, title: details.title ?? video.title, published, seconds: details.durationMs ? details.durationMs / 1000 : video.seconds, language: transcript.language }, transcript.transcript));
  renameSync(`${path}.tmp`, path);
  Object.assign(video, { state: "fetched", file: path, published, title: details.title ?? video.title });
  if (details.channel?.title) channel.title = details.channel.title;
  // Written first: what stopped the run must not lose a transcript already paid for.
  if (halt) {
    saveChannel(channel);
    throw halt;
  }
  return "fetched";
}

/** @param {number} ms */
export function clock(ms) {
  const s = Math.floor(ms / 1000);
  const two = (/** @type {number} */ n) => String(n).padStart(2, "0");
  return `${two(Math.floor(s / 3600))}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}`;
}

/** The video's details, whichever it has, then one numbered line per caption. */
export function renderRaw(video, segments) {
  const head = ["---", `title: ${JSON.stringify(video.title ?? "")}`, "source: youtube", `id: ${video.id}`, `url: ${video.url}`];
  if (video.channel?.title) head.push(`channel: ${JSON.stringify(video.channel.title)}`);
  if (video.published) head.push(`published: ${video.published}`);
  if (video.seconds) head.push(`duration: ${clock(video.seconds * 1000)}`);
  if (video.language) head.push(`language: ${JSON.stringify(video.language)}`);
  if (video.keywords?.length) head.push(`keywords: ${JSON.stringify(video.keywords)}`);
  head.push("---", "");

  const parts = [head.join("\n")];
  if (video.description?.trim()) parts.push(`## Description\n\n${video.description.trim()}\n`);
  const chapters = (video.chapters ?? []).filter((/** @type {any} */ c) => c?.title);
  if (chapters.length) {
    parts.push(`## Chapters\n\n${chapters.map((/** @type {any} */ c) => (Number.isFinite(c.startSeconds) ? `${clock(c.startSeconds * 1000)} ${c.title}` : c.title)).join("\n")}\n`);
  }
  const lines = [];
  for (const seg of segments) {
    const text = String(seg?.text ?? "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    lines.push(`L${String(lines.length + 1).padStart(4, "0")} ${clock(Number(seg.startMs) || 0)} ${text}`);
  }
  parts.push(`## Transcript\n\n${lines.join("\n")}\n`);
  return parts.join("\n");
}

const SITES = join("sources", "sites.txt");
const NEW_PAGES = join("sources", "new-pages.txt");
/** Pages a later read of a known site found; a first read's pages are the owner's to queue. */
export const newPages = () => new Set(existsSync(NEW_PAGES) ? readFileSync(NEW_PAGES, "utf8").split("\n").filter(Boolean) : []);
export const knownSites = () => (existsSync(SITES) ? readFileSync(SITES, "utf8").split("\n").map((l) => l.trim()).filter(Boolean) : []);
const PAGE_HASH = /^hash: *"?([^"\n]+)"?$/m;

/** What each crawled page's content hash is now, so a second read can say what changed. */
function pageHashes(/** @type {string} */ dir) {
  /** @type {Map<string, string>} */
  const out = new Map();
  const walk = (/** @type {string} */ d) => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name));
      else if (e.name.endsWith(".md")) out.set(join(d, e.name), PAGE_HASH.exec(readFileSync(join(d, e.name), "utf8"))?.[1] ?? "");
    }
  };
  walk(dir);
  return out;
}

function crawl(/** @type {any} */ a, /** @type {string[]} */ rest) {
  noMore(rest, 1, "sources crawl");
  const given = rest[0];
  if (given && !/^https?:\/\/[^/\s]+\.[^/\s]+/.test(given)) misused(`sources crawl: ${given} is not a site's address; give it whole`, "node scripts/sources.mjs crawl https://example.com");
  const sites = given ? [given] : knownSites();
  if (!sites.length) fail("sources crawl: no websites in sources/ yet", "node scripts/sources.mjs crawl https://example.com");
  const cap = flag(a, "max-pages");
  if (cap !== undefined && !/^[1-9]\d*$/.test(String(cap))) misused(`sources crawl: --max-pages takes a number, not ${cap}`, "node scripts/sources.mjs crawl --max-pages 100");
  takeLock("sources crawl");
  const lines = [];
  const problems = [];
  for (const site of sites) {
    const host = new URL(site).hostname.replace(/^www\./, "");
    const out = join("raw", "web", host);
    const before = pageHashes(join(out, "pages"));
    const r = spawnSync("tt-crawl", ["pages", site, "--external", "--images", "none", "--out", out, ...(cap ? ["--max-pages", String(cap)] : [])], { encoding: "utf8" });
    if (r.error || r.status !== 0) {
      problems.push(`${host}: ${(r.stderr || r.error?.message || "").trim().split("\n")[0].slice(0, 200)}`);
      if (/** @type {any} */ (r.error)?.code === "ENOENT") fail("sources crawl: tt-crawl is not installed yet", "bash .taskandtool/after-setup.sh");
      continue;
    }
    // Dated posts where the site has a feed; a site without one is normal.
    spawnSync("tt-crawl", ["import", "--out", out, "--images", "none"], { encoding: "utf8" });
    const after = pageHashes(join(out, "pages"));
    const changed = [...after].filter(([f, h]) => before.has(f) && before.get(f) !== h).length;
    const added = [...after.keys()].filter((f) => !before.has(f));
    if (knownSites().includes(site) && added.length) appendFileSync(NEW_PAGES, `${added.join("\n")}\n`);
    lines.push(`${host}: ${after.size} pages, ${added.length} new, ${changed} changed`);
    if (!knownSites().includes(site)) writeFileSync(SITES, `${[...knownSites(), site].join("\n")}\n`);
  }
  if (problems.length && !lines.length) fail(`sources crawl: nothing was read\n${problems.map((l) => `  ${l}`).join("\n")}`, "tt-crawl pages --help");
  done("sources crawl", `${sites.length} site${sites.length === 1 ? "" : "s"} read`, { lines: [...lines, ...problems], next: "node scripts/pipeline.mjs status" });
}

/** @param {unknown} e @param {string} at @returns {never} */
function halted(e, at) {
  if (e instanceof Halt) return fail(`${at}: ${e.message}`, e.tryCmd);
  if (e instanceof Skip) return fail(`${at}: ${e.message}`, `check the channel on YouTube, then ${LISTED}; what was listed is kept`);
  return fail(`${at}: ${e instanceof Error ? e.message : e}`, "run it again in a few minutes; what was done is kept");
}

async function main() {
  const argv = process.argv.slice(2);
  // It prints text, so its refusal of --json is text too.
  if (argv.includes("--json")) {
    parseArgs([]);
    misused("sources: it prints text, no --json", "node scripts/sources.mjs --help");
  }
  const a = parseArgs(argv, { bare: ["full"] });
  const [cmd, ...rest] = a._;
  usage(a, cmd, ["list", "fetch", "crawl"], HELP, "sources", { list: ["max-pages", "full", "since", "min-minutes", "language"], fetch: ["limit", "id", "max-minutes", "confirm"], crawl: ["max-pages"] });
  if (cmd === "list") await list(a, rest);
  else if (cmd === "crawl") crawl(a, rest);
  else await fetchAll(a, rest);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => halted(e, "sources"));
}
