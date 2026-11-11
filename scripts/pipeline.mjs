#!/usr/bin/env node
// The state of everything, and what moves it along with no AI: what is queued, who has
// what, and the recurring jobs that come and go with the work. Works only through what a
// person queued, so spending stays their decision.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { done, fail, flag, flags, has, misused, noMore, parseArgs, usage } from "../src/data/cli.mjs";
import { SPLIT_MOMENTS, reusedLinks, slugOf, topicEntries, topicHash } from "./build-index.mjs";
import { isPending, knownChannels, knownSites, loadChannel, newPages, YT_PER_DAY } from "./sources.mjs";

const HELP = `usage: node scripts/pipeline.mjs <command>

  status
      What is at each stage: to fetch, notes, moments, align and write, what is done, what failed.

  queue --sample N | --all | --new | --pages [--topic NAME]... [--confirm]
      Adds work and starts the "Run the pipeline" job. Previews what it would spend without
      --confirm. --sample takes N sources spread across their dates, --all the rest in
      shuffled order, --new what appeared since (a changed web page counts). --pages takes the
      topics that pass the publish gate and have no page, strongest first; --topic names some.

  next source | page
      Claims one step on one item for this run and prints what to do. "Nothing to do" means stop.
      A page that exists is rewritten whole from its topic file.

  done <file> [--failed "why"]
      Marks the claimed step after its check passes: a source goes notes, moments, align, each a
      fresh run, and a page goes write, verify. --failed gives it back; after 3 tries it is left
      out and reported.

  tick
      The job's command. Fetches what is queued, adds and removes the jobs, rebuilds index/
      when the sources finish, has a run sort the batch's new topic names and any topic grown
      big enough to split, queues the pages whose moments changed, posts what changed, and removes its own job when nothing is left.

  watch [--off] [--confirm]
      The standing jobs: new sources weekly, websites monthly, site health weekly, the audit
      monthly. They spend credits and AI, so they need --confirm. --off removes them.

Prints what happened. Failures go to stderr with a Try line.
Exit 0 done (nothing to do included), 1 failed or refused, 2 used wrongly.`;

const STATE = join("pipeline", "state.json");
const LOCK = join("pipeline", ".lock");
const LOG = "log.md";
const MAX_TRIES = 3;
const CLAIM_HOURS = 6;
const FETCH_BUDGET_MINUTES = 25;
const FETCH_BATCH = 100;
const HALT_HOURS = 6;
const CRON = "*/15 * * * *";
const DISTILL_JOBS = 2;
const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const script = (/** @type {string} */ name) => join(SCRIPTS, name);

const JOB = {
  tick: "Run the pipeline",
  source: (/** @type {number} */ n) => `Read next source${n ? ` ${n + 1}` : ""}`,
  page: "Write next page",
  newSources: "Check for new sources",
  websites: "Crawl websites",
  health: "Site health",
  audit: "Audit",
};
const nextPrompt = (/** @type {string} */ what) => `Run \`node scripts/pipeline.mjs next ${what}\` and do exactly what it prints, for that one item. If it says there is nothing to do, stop.`;

const SOURCE_STAGES = ["fetch", "distill", "moments", "align"];
const PAGE_STAGES = ["tidy", "page", "page_verify"];
const isActiveSource = (/** @type {any} */ i) => i.kind !== "page" && SOURCE_STAGES.includes(i.stage);
const distilledOf = (/** @type {string} */ file) => file.replace(/^raw[/\\]/, "distilled/");
const momentsOf = (/** @type {string} */ file) => file.replace(/^raw[/\\]/, "moments/");
/** Each step of a source, its check, and what comes next. */
const NEXT_STAGE = { distill: "moments", moments: "align", page: "page_verify" };
const now = () => new Date();

function fresh() {
  return { items: /** @type {Record<string, any>} */ ({}), topics: /** @type {Record<string, string>} */ ({}), pages: /** @type {Record<string, any>} */ ({}), triaged: /** @type {string[]} */ ([]), split_checked: /** @type {Record<string, number>} */ ({}), auto_pages: false, halted: null, pages_ready: 0 };
}

const sleep = (/** @type {number} */ ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Changes the state under a lock held only for the change, so a long fetch never blocks a claim. */
function withState(/** @type {(state: ReturnType<typeof fresh>) => any} */ change) {
  mkdirSync("pipeline", { recursive: true });
  for (let tries = 0; ; tries++) {
    try {
      writeFileSync(LOCK, String(process.pid), { flag: "wx" });
      break;
    } catch {
      let holder = 0;
      try {
        holder = Number(readFileSync(LOCK, "utf8"));
        process.kill(holder, 0);
      } catch (e) {
        // Gone with no release: the lock is free to take.
        if (/** @type {any} */ (e).code === "ESRCH") rmSync(LOCK, { force: true });
      }
      if (tries > 100) fail(`pipeline: another run has held the state for 10 seconds (process ${holder})`, "run it again in a minute");
      sleep(100);
    }
  }
  try {
    const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : fresh();
    const out = change(state);
    writeFileSync(`${STATE}.tmp`, `${JSON.stringify(state, null, 1)}\n`);
    renameSync(`${STATE}.tmp`, STATE);
    return out;
  } catch (e) {
    if (e instanceof SyntaxError) fail(`pipeline: ${STATE} is not valid JSON`, `fix ${STATE}; delete it only to start the queue over`);
    throw e;
  } finally {
    rmSync(LOCK, { force: true });
  }
}

const say = (/** @type {string} */ line) => appendFileSync(LOG, `${now().toISOString().slice(0, 16).replace("T", " ")} ${line}\n`);

/** The platform, when this is a machine on it. A failure is never taken for "no jobs". */
function bridge(/** @type {string[]} */ args) {
  const tool = join(homedir(), "tools", "taskandtool.py");
  if (!existsSync(tool)) return { missing: true };
  const r = spawnSync("python3", [tool, ...args, "--json"], { encoding: "utf8" });
  // With --json it answers on stdout when done and on stderr when not.
  try {
    if (r.status === 0) return JSON.parse(r.stdout || "{}");
    return { failed: JSON.parse(r.stderr).error ?? "the bridge failed" };
  } catch {
    return { failed: (r.stderr || r.stdout || "the bridge failed").trim().slice(0, 200) };
  }
}

const postActivity = (/** @type {string} */ line) => bridge(["post-activity", line.slice(0, 300)]);

/** The jobs that should exist, made and removed to match. Says what changed. */
function matchJobs(/** @type {Record<string, { when: string, command?: string, prompt?: string } | null>} */ wanted) {
  const listed = bridge(["list-jobs"]);
  if (listed.missing) return { changes: [], failures: 0, note: "no Task & Tool bridge here, so no jobs were changed" };
  if (listed.failed) return { changes: [], failures: 1, note: `the jobs could not be read, so none were changed: ${listed.failed}` };
  const jobs = listed.jobs ?? [];
  const changes = [];
  let failures = 0;
  for (const [name, spec] of Object.entries(wanted)) {
    const have = jobs.filter((/** @type {any} */ j) => j.name === name);
    if (spec && !have.length) {
      const r = bridge(["schedule-job", name, "--when", spec.when, ...(spec.command ? ["--command", spec.command] : ["--prompt", spec.prompt ?? ""])]);
      if (r.failed) failures++;
      changes.push(r.failed ? `could not add "${name}": ${r.failed}` : `added the job "${name}"`);
    }
    if (!spec) {
      for (const j of have) {
        const r = bridge(["unschedule-job", String(j.id)]);
        if (r.failed) failures++;
        changes.push(r.failed ? `could not remove "${name}": ${r.failed}` : `removed the job "${name}"`);
      }
    }
  }
  return { changes, failures };
}

/** The job that moves the queue. A queue with no job would sit for good, so failing to add it is a failure. */
function ensureTick(/** @type {string} */ at) {
  const { changes, note, failures } = matchJobs({ [JOB.tick]: { when: CRON, command: "node scripts/pipeline.mjs tick" } });
  if (failures) fail(`${at}: the queue is saved, but its job could not be added\n  ${[...changes, ...(note ? [note] : [])].join("\n  ")}`, "run the same queue command again; it adds the job");
  return [...changes, ...(note ? [note] : [])];
}

const walkMd = (/** @type {string} */ dir) =>
  !existsSync(dir) ? [] : readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name.startsWith("_") || e.name === "structured" ? [] : walkMd(p);
    return e.name.endsWith(".md") ? [p] : [];
  });

/** Web pages and documents in raw/, each with what says it changed. */
function fileSources() {
  return [...walkMd(join("raw", "web")), ...walkMd(join("raw", "docs"))].map((file) => {
    const text = readFileSync(file, "utf8");
    return { file, hash: /^hash: *"?([^"\n]+)"?$/m.exec(text)?.[1] ?? createHash("sha256").update(text).digest("hex").slice(0, 16), date: /^published: *"?(\d{4}-\d\d-\d\d)/m.exec(text)?.[1] ?? "" };
  });
}

/** Everything that could be queued, each with its date, whether or not it was. */
function candidates() {
  const out = [];
  for (const key of knownChannels()) {
    const channel = loadChannel(key);
    for (const v of channel.videos ?? []) {
      const fresh = !!v.fresh;
      if (v.state === "fetched" && v.file) out.push({ key: `youtube:${v.id}`, kind: "youtube", id: v.id, channel: key, file: v.file, date: v.published ?? "", seconds: v.seconds ?? 0, hash: "", fresh });
      else if (isPending(channel, v)) out.push({ key: `youtube:${v.id}`, kind: "youtube", id: v.id, channel: key, date: v.published ?? "", seconds: v.seconds ?? 0, hash: "", fresh });
    }
  }
  const later = newPages();
  for (const f of fileSources()) out.push({ key: `file:${f.file}`, kind: "file", file: f.file, date: f.date, seconds: 0, hash: f.hash, fresh: later.has(f.file) });
  return out;
}

/** An item starts where its files say it has got to. */
function newItem(/** @type {any} */ c) {
  const stage = c.kind === "youtube" && !c.file ? "fetch" : !existsSync(distilledOf(c.file)) ? "distill" : existsSync(momentsOf(c.file)) ? "align" : "moments";
  return { ...c, stage, tries: 0 };
}

/** N spread evenly across the dates, so a sample sees the whole history. */
export function spread(/** @type {any[]} */ list, /** @type {number} */ n) {
  const dated = [...list].sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999") || a.key.localeCompare(b.key));
  if (n >= dated.length) return dated;
  return Array.from({ length: n }, (_, i) => dated[Math.floor((i * dated.length) / n)]);
}

const shuffled = (/** @type {any[]} */ list) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/** Topics from index/topics.md, strongest first as it lists them. */
function topicRows() {
  if (!existsSync(join("index", "topics.md"))) return [];
  return [...readFileSync(join("index", "topics.md"), "utf8").matchAll(/^- (.+?): (\d+) sources?, (\d+) moments?(, under the publish gate)?/gm)].map((m) => ({ name: m[1], slug: slugOf(m[1]), moments: Number(m[3]), passes: !m[4] }));
}

const pageItem = (/** @type {string} */ slug, /** @type {string} */ name, file = join("content", "topics", `${slug}.md`)) => ({ key: `page:${file}`, kind: "page", slug, name, file, stage: "page", tries: 0 });

/** The guides written on a topic, which change when it does. */
function guidesOn(/** @type {string} */ slug) {
  return walkMd(join("content", "guides")).filter((f) => {
    const topic = /^topic: *"?([^"\n]+)"?$/m.exec(readFileSync(f, "utf8").split("\n---")[0])?.[1];
    return topic && slugOf(topic) === slug;
  });
}

/** Pages that name this topic as broader: this page summarizes their points and links down. */
function narrowerOf(/** @type {string} */ slug) {
  return [...walkMd(join("content", "topics")), ...walkMd(join("content", "guides"))].filter((f) => {
    const m = /^broader: *\[(.*)\]$/m.exec(readFileSync(f, "utf8").split("\n---")[0]);
    return !!m && m[1].split(",").some((t) => slugOf(t.trim().replace(/^["']|["']$/g, "")) === slug);
  });
}

const topicPath = (/** @type {string} */ slug) => join("index", "topics", `${slug}.md`);
const entriesOf = (/** @type {string} */ slug) => (existsSync(topicPath(slug)) ? topicEntries(readFileSync(topicPath(slug), "utf8")) : []);
const BATCH = join("pipeline", "briefs", "batch.md");

/** A claimed page is written fresh or rewritten whole; either way it remembers the moments it saw. */
function planPage(/** @type {any} */ i) {
  i.snapshot = Object.fromEntries(entriesOf(i.slug).map((e) => [e.id, e.link]));
  i.mode = existsSync(i.file) ? "rewrite" : "write";
}

function counts(/** @type {any} */ state) {
  const items = Object.values(state.items);
  const n = (/** @type {(i: any) => boolean} */ test) => items.filter(test).length;
  return {
    fetch: n((i) => i.stage === "fetch"), distill: n((i) => i.stage === "distill"), moments: n((i) => i.stage === "moments"), align: n((i) => i.stage === "align"),
    done: n((i) => i.kind !== "page" && i.stage === "done"), page: n((i) => PAGE_STAGES.includes(i.stage)), written: n((i) => i.kind === "page" && i.stage === "done"),
    failed: n((i) => i.stage === "failed"), noCaptions: n((i) => i.stage === "no_captions"), claimed: n((i) => !!i.claimed_at),
  };
}

function status() {
  const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : fresh();
  const c = counts(state);
  const waiting = candidates().filter((x) => !state.items[x.key]).length;
  const items = Object.values(state.items);
  const failed = items.filter((/** @type {any} */ i) => i.stage === "failed").slice(0, 10).map((/** @type {any} */ i) => `failed: ${i.file ?? i.key}: ${i.why ?? "no reason given"}`);
  done("pipeline status", `${c.fetch} to fetch, ${c.distill} for notes, ${c.moments} for moments, ${c.align} to align, ${c.done} done; ${c.page} pages to write, ${c.written} written; ${c.failed} failed`, {
    lines: [...(c.claimed ? [`${c.claimed} claimed by a run now`] : []), ...(c.noCaptions ? [`${c.noCaptions} have no captions yet`] : []), ...(waiting ? [`${waiting} sources not queued`] : []), ...(state.halted ? [`fetching stopped: ${state.halted.why}`] : []), ...failed],
    next: waiting ? "node scripts/pipeline.mjs queue --sample 20" : undefined,
  });
}

function queue(/** @type {any} */ a, /** @type {string[]} */ rest) {
  noMore(rest, 0, "pipeline queue");
  const sample = flag(a, "sample");
  const modes = [sample !== undefined, has(a, "all"), has(a, "new"), has(a, "pages")].filter(Boolean).length;
  if (modes !== 1) misused("pipeline queue: choose one of --sample N, --all, --new or --pages", "node scripts/pipeline.mjs queue --sample 20");
  if (sample !== undefined && !/^[1-9]\d*$/.test(String(sample))) misused(`pipeline queue: --sample takes a number, not ${sample}`, "node scripts/pipeline.mjs queue --sample 20");
  const names = flags(a, "topic");
  if (names.length && !has(a, "pages")) misused("pipeline queue: --topic goes with --pages", "node scripts/pipeline.mjs queue --pages --topic pricing");
  const confirmed = has(a, "confirm");
  const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : fresh();

  /** @type {any[]} */
  let chosen;
  if (has(a, "pages")) {
    const rows = topicRows();
    if (!rows.length) fail("pipeline queue: no topics yet", "node scripts/build-index.mjs");
    const wanted = names.map((n) => slugOf(n));
    for (const s of wanted) if (!rows.some((r) => r.slug === s)) fail(`pipeline queue: no topic ${s} in index/topics.md`, "read index/topics.md");
    chosen = rows.filter((r) => (wanted.length ? wanted.includes(r.slug) : r.passes && !existsSync(join("content", "topics", `${r.slug}.md`)))).map((r) => pageItem(r.slug, r.name)).filter((i) => !PAGE_STAGES.includes(state.items[i.key]?.stage));
  } else {
    const all = candidates();
    const isNew = (/** @type {any} */ x) => {
      const had = state.items[x.key];
      // Only what appeared since: the back catalogue waits for a person's --sample or --all.
      if (!had) return x.fresh;
      if (x.kind === "file") return had.hash !== x.hash && had.stage !== "distill";
      return had.stage === "no_captions";
    };
    if (has(a, "new")) chosen = all.filter(isNew);
    else {
      const open = all.filter((x) => !state.items[x.key]);
      chosen = sample !== undefined ? spread(open, Number(sample)) : shuffled(open);
    }
  }
  if (!chosen.length) {
    const active = Object.values(state.items).some((/** @type {any} */ i) => isActiveSource(i) || PAGE_STAGES.includes(i.stage));
    return done("pipeline queue", has(a, "pages") ? "no topics to add: each one that passes the gate has a page or is queued" : "nothing new to queue", { lines: active && confirmed ? ensureTick("pipeline queue") : [] });
  }

  const isPages = has(a, "pages");
  const fetching = chosen.filter((x) => x.kind === "youtube" && !x.file);
  // The owner's own channel comes through YouTube, which charges no credits but allows about 40 a day.
  const ownChannels = new Set(knownChannels().filter((key) => loadChannel(key)?.via === "youtube"));
  const viaYouTube = fetching.filter((x) => ownChannels.has(x.channel)).length;
  const toFetch = fetching.length - viaYouTube;
  const hours = (chosen.reduce((n, x) => n + (x.seconds || 0), 0) / 3600).toFixed(1);
  const cost = isPages ? `${chosen.length * 2} AI runs (write and verify)` : `about ${toFetch * 2} credits to fetch ${toFetch}${viaYouTube ? `, ${viaYouTube} more through YouTube at about ${YT_PER_DAY} a day` : ""}, ${hours} hours of video, ${chosen.length * 3} AI runs (notes, moments and align), then 2 runs for each ${has(a, "new") ? "page the new moments touch, or new topic that passes the gate" : "written page the new moments touch"}`;
  if (!confirmed) {
    const flagsNow = [sample !== undefined ? `--sample ${sample}` : "", has(a, "all") ? "--all" : "", has(a, "new") ? "--new" : "", isPages ? "--pages" : "", ...names.map((n) => `--topic "${n}"`)].filter(Boolean).join(" ");
    console.log(`pipeline queue: would add ${chosen.length} ${isPages ? "page" : "source"}${chosen.length === 1 ? "" : "s"}\n  ${cost}\n${chosen.slice(0, 8).map((x) => `  ${x.name ?? x.file ?? x.id}`).join("\n")}${chosen.length > 8 ? `\n  ${chosen.length - 8} more` : ""}\n\nNothing was queued. If the owner agreed: node scripts/pipeline.mjs queue ${flagsNow} --confirm`);
    return undefined;
  }
  withState((s) => {
    for (const x of chosen) s.items[x.key] = x.kind === "page" ? x : newItem(x);
    if (has(a, "new")) s.auto_pages = true;
    if (has(a, "new")) {
      for (const x of chosen) {
        if (x.kind !== "file") continue;
        s.items[x.key].stage = "distill";
        // A changed page starts over: its old moments must not stay on the site or pass as new.
        rmSync(momentsOf(x.file), { force: true });
        rmSync(join("index", "topics.md"), { force: true });
      }
    }
    s.halted = null;
  });
  if (isPages && existsSync(join("index", "topics.md"))) markTold();
  say(`queued ${chosen.length} ${isPages ? "pages" : "sources"} (${cost})`);
  const jobLines = ensureTick("pipeline queue");
  done("pipeline queue", `added ${chosen.length} ${isPages ? "page" : "source"}${chosen.length === 1 ? "" : "s"}; ${cost}`, {
    lines: [...jobLines, "the next tick starts it, within 15 minutes"],
    next: "node scripts/pipeline.mjs status",
  });
}

const claimExpired = (/** @type {any} */ i) => i.claimed_at && now().getTime() - Date.parse(i.claimed_at) > CLAIM_HOURS * 3_600_000;

/** A claim whose run died counts as a try, and three tries end it. */
function expireClaims(/** @type {any} */ state) {
  for (const i of Object.values(state.items)) {
    const item = /** @type {any} */ (i);
    if (!claimExpired(item)) continue;
    item.claimed_at = undefined;
    item.tries = (item.tries ?? 0) + 1;
    item.why = `a run claimed it and did not finish in ${CLAIM_HOURS} hours`;
    if (item.tries >= MAX_TRIES) item.stage = "failed";
  }
}

function next(/** @type {string[]} */ rest) {
  const [what, ...more] = rest;
  if (what !== "source" && what !== "page") misused(`pipeline next: say source or page, not ${what ?? "nothing"}`, "node scripts/pipeline.mjs next source");
  noMore(more, 0, "pipeline next");
  const picked = withState((state) => {
    expireClaims(state);
    const items = Object.values(state.items).map((i) => /** @type {any} */ (i));
    if (what === "page" && items.some(isActiveSource)) return { wait: true };
    // Verify first, so a source is finished before another is started.
    const ready = (/** @type {string} */ stage) => items.find((i) => i.stage === stage && !i.claimed_at);
    // New names are sorted before any page is written, so a merge reaches the pages.
    // A page waits while the topics are being sorted, even by another run: the sort may move its moments.
    const sorting = items.some((i) => i.stage === "tidy");
    const item = what === "page" ? (ready("page_verify") ?? ready("tidy") ?? (sorting ? undefined : ready("page"))) : (ready("align") ?? ready("moments") ?? ready("distill"));
    if (!item && what === "page" && sorting) return { sorting: true };
    if (item) item.claimed_at = now().toISOString();
    if (item?.stage === "page") planPage(item);
    return { item: item && { ...item } };
  });
  if (picked.wait) return done("pipeline next", "nothing to do yet: pages wait until every source is finished. Stop here");
  if (picked.sorting) return done("pipeline next", "nothing to do yet: pages wait until another run has sorted the topics. Stop here");
  if (!picked.item) return done("pipeline next", `nothing to do: no ${what === "page" ? "pages" : "sources"} are waiting. Stop here`);
  const i = picked.item;
  const closing = (/** @type {string} */ what) => ["Last, run the Next line below: the page isn't finished until it passes.", `If it cannot be finished: node scripts/pipeline.mjs done ${what} --failed "why"`];
  if (i.stage === "tidy") {
    return done("pipeline next", "sort the batch's topics", {
      lines: [`Sort what ${BATCH} lists with the topics skill: only those. This run does only that.`, ...closing(i.file)],
      next: `node scripts/pipeline.mjs done ${i.file}`,
    });
  }
  if (i.stage === "page_verify") {
    const text = existsSync(i.file) ? readFileSync(i.file, "utf8") : "";
    const reused = reusedLinks(text);
    const known = new Set(entriesOf(i.slug).map((e) => e.link));
    const offList = known.size ? [...new Set([...text.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map((m) => m[1]))].filter((u) => !known.has(u)) : [];
    return done("pipeline next", `verify ${i.file}`, {
      lines: [`Verify that page against its sources, with the write-page skill's references/verify.md. This run did not write it, and does this one page.`,
        ...(reused.length ? ["Check these links first: each closes more than one paragraph, so one paragraph may have borrowed it.", ...reused.map((r) => `  ${r.url}: ${r.paras.map((p) => `"${p}…"`).join(", ")}`)] : []),
        ...(offList.length ? [`These links are no moment of index/topics/${i.slug}.md, so the writer took them from the notes: ${offList.join(", ")}`] : []),
      "Last, run the Next line below: the page isn't finished until it passes.", `If it cannot be finished: node scripts/pipeline.mjs done ${i.file} --failed "why"`],
      next: `node scripts/pipeline.mjs done ${i.file}`,
    });
  }
  if (i.stage === "page") {
    const narrower = narrowerOf(i.slug);
    return done("pipeline next", `${i.mode === "rewrite" ? "rewrite" : "write"} ${i.file}`, {
      lines: [`${i.mode === "rewrite" ? "Rewrite that page whole" : "Write that page"} from index/topics/${i.slug}.md, with the write-page skill. This run does this one page.`,
        ...(i.mode === "rewrite" ? ["The page there now was verified: a point you keep keeps its link."] : []),
        ...(narrower.length ? [`Narrower pages, which it summarizes in a sentence each and links to: ${narrower.join(", ")}`] : []), ...closing(i.file)],
      next: `node scripts/pipeline.mjs done ${i.file}`,
    });
  }
  const steps = { distill: `Write its notes to ${distilledOf(i.file)}, with the distill skill.`, moments: `Write its moments to ${momentsOf(i.file)}, with the moments skill.`, align: `Align its moments and notes against it and write the gist, with the align skill. This run wrote neither.` };
  return done("pipeline next", `${i.stage} ${i.file}`, {
    lines: [
      `${steps[/** @type {"distill" | "moments" | "align"} */ (i.stage)]} This run does this one step.`,
      "Last, run the Next line below: the step isn't finished until it passes.",
      `If it cannot be finished: node scripts/pipeline.mjs done ${i.file} --failed "why"`,
    ],
    next: `node scripts/pipeline.mjs done ${i.file}`,
  });
}

function finish(/** @type {any} */ a, /** @type {string[]} */ rest) {
  const [given, ...more] = rest;
  if (!given) misused("pipeline done: name the file", "node scripts/pipeline.mjs status");
  noMore(more, 0, "pipeline done");
  const failed = flag(a, "failed");
  const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : fresh();
  const raw = given.replace(/^(distilled|moments)[/\\]/, "raw/");
  const item = /** @type {any} */ (Object.values(state.items).find((i) => /** @type {any} */ (i).file === given || /** @type {any} */ (i).file === raw));
  if (!item) fail(`pipeline done: ${given} is not in the queue`, "node scripts/pipeline.mjs status");
  if (item.stage === "done") return done("pipeline done", `${item.file} is already finished, left alone`);
  if (!item.claimed_at) fail(`pipeline done: ${item.file} is at ${item.stage} and no run has claimed it`, `node scripts/pipeline.mjs next ${item.kind === "page" || item.kind === "tidy" ? "page" : "source"}`);

  if (failed !== undefined) {
    const why = failed;
    const left = withState((s) => {
      const i = s.items[item.key];
      i.claimed_at = undefined;
      i.tries = (i.tries ?? 0) + 1;
      i.why = why;
      if (i.tries >= MAX_TRIES) i.stage = "failed";
      return i.stage;
    });
    say(`gave back ${item.file}: ${why}`);
    return done("pipeline done", left === "failed" ? `${item.file} failed ${MAX_TRIES} times; left out and reported` : `${item.file} goes back in the queue`, { lines: [why] });
  }

  // The check decides: a run cannot mark work that does not pass.
  const run = (/** @type {string} */ name, /** @type {string[]} */ args) => spawnSync(process.execPath, [script(name), ...args], { encoding: "utf8" });
  const checks = item.kind === "tidy" ? [["build-index.mjs", []]] : item.kind === "page" ? [["check.mjs", ["pages", item.file]]]
    : [...(item.stage !== "moments" ? [["check-distilled.mjs", [distilledOf(item.file)]]] : []), ...(item.stage !== "distill" ? [["check-moments.mjs", [momentsOf(item.file), ...(item.stage === "align" ? ["--final"] : [])]]] : [])];
  const check = checks.map(([name, args]) => run(/** @type {string} */ (name), /** @type {string[]} */ (args))).find((r) => r.status !== 0) ?? { status: 0, stderr: "", stdout: "" };
  if (check.status !== 0) fail(`pipeline done: ${item.file} does not pass its check yet\n${(check.stderr || check.stdout).trim().split("\n").slice(0, 30).map((l) => `  ${l}`).join("\n")}`, `fix those, then node scripts/pipeline.mjs done ${item.file}`);
  const stage = withState((s) => {
    const i = s.items[item.key];
    i.claimed_at = undefined;
    i.tries = 0;
    i.why = undefined;
    i.stage = /** @type {Record<string, string>} */ (NEXT_STAGE)[i.stage] ?? "done";
    if (i.kind === "page" && i.stage === "done") {
      // What the page was written from, so it is rewritten only when its moments change.
      if (i.snapshot) s.pages = { ...s.pages, [i.file]: { moments: i.snapshot, at: now().toISOString() } };
      s.pages_ready = (s.pages_ready ?? 0) + 1;
    }
    return i.stage;
  });
  say(`${item.stage} finished: ${item.file}`);
  done("pipeline done", stage === "done" ? `${item.file} is finished. Stop here` : `${item.file} passes its check; a fresh run takes the next step. Stop here`);
}

/** Fetches what is queued, within the job's 30 minutes. Stops for hours when the vendor stops it. */
function fetchQueued() {
  const state = JSON.parse(readFileSync(STATE, "utf8"));
  const items = Object.values(state.items).map((i) => /** @type {any} */ (i)).filter((i) => i.stage === "fetch");
  if (!items.length) return [];
  if (state.halted && now().getTime() - Date.parse(state.halted.at) < HALT_HOURS * 3_600_000) return [];
  const started = Date.now();
  const lines = [];
  /** @type {string | null} */
  let halted = null;
  for (const channel of new Set(items.map((i) => i.channel))) {
    const minutes = FETCH_BUDGET_MINUTES - Math.floor((Date.now() - started) / 60000);
    if (minutes < 1) break;
    const ids = items.filter((i) => i.channel === channel).slice(0, FETCH_BATCH).flatMap((i) => ["--id", i.id]);
    const r = spawnSync(process.execPath, [script("sources.mjs"), "fetch", channel, ...ids, "--max-minutes", String(minutes), "--confirm"], { encoding: "utf8" });
    const said = (r.stderr || r.error?.message || "the fetch failed").trim().split("\n")[0];
    // Only a stop the vendor made holds fetching back; one video's failure or a busy lock does not.
    if (r.status === 0) lines.push(r.stdout.split("\n")[0]);
    else if (/^sources fetch: stopped:/.test(said)) halted = said.replace(/^sources fetch: stopped: /, "");
    else lines.push(said);
    const after = new Map((loadChannel(channel)?.videos ?? []).map((/** @type {any} */ v) => [v.id, v]));
    withState((s) => {
      for (const i of items.filter((x) => x.channel === channel)) {
        const v = /** @type {any} */ (after.get(i.id));
        const it = s.items[i.key];
        if (v?.state === "fetched" && v.file) Object.assign(it, { file: v.file, date: v.published ?? it.date, stage: "distill" });
        else if (v?.state === "no_captions") it.stage = "no_captions";
        else if (v?.state === "failed" && (v.attempts ?? 0) >= MAX_TRIES) Object.assign(it, { stage: "failed", why: v.error ?? "the fetch failed" });
      }
    });
  }
  withState((s) => {
    if (halted && !s.halted) postActivity(`Stopped fetching transcripts: ${halted}`);
    s.halted = halted ? { at: now().toISOString(), why: halted } : null;
  });
  return halted ? [...lines, `fetching stopped: ${halted}`] : lines;
}

/** Every file under a folder: a channel may be called _anything, which walkMd's crawl rule would skip. */
const everyFile = (/** @type {string} */ dir) =>
  !existsSync(dir) ? [] : readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? everyFile(join(dir, e.name)) : [join(dir, e.name)]));
const newestMtime = (/** @type {string} */ dir) => everyFile(dir).reduce((n, f) => Math.max(n, statSync(f).mtimeMs), 0);
const hashTopic = (/** @type {string} */ slug) => (existsSync(topicPath(slug)) ? topicHash(readFileSync(topicPath(slug), "utf8")) : "");

/** What one run sorts before pages: the batch's new names, and topics grown big enough to split, every moment one line. */
function batchBrief(/** @type {ReturnType<typeof topicRows>} */ fresh, /** @type {ReturnType<typeof topicRows>} */ big) {
  const out = ["# This batch's topics", ""];
  if (fresh.length) {
    out.push("## New names", "", "Moments were tagged with names the site had not used. index/topics.md lists the rest.", "");
    for (const row of fresh) {
      const e = entriesOf(row.slug);
      out.push(`- ${row.name}: ${e.length} moment${e.length === 1 ? "" : "s"} in ${new Set(e.map((x) => x.source.path)).size} source(s). First: ${e[0]?.text ?? ""}`);
    }
    out.push("");
  }
  if (big.length) {
    out.push("## Big enough to split", "", "Each topic's moments, one a line: one point said many ways, or separate questions?", "");
    for (const row of big) out.push(`### ${row.name}`, "", ...entriesOf(row.slug).map((e) => `- ${e.source.title} ${e.at}: ${e.text}`), "");
  }
  return `${out.join("\n")}`;
}

/** Once no source is in hand: new topic files, new names sorted, and the pages whose moments changed queued. */
function rebuildIndex() {
  const built = existsSync(join("index", "topics.md")) ? statSync(join("index", "topics.md")).mtimeMs : 0;
  const aliases = existsSync(join("index", "aliases.yaml")) ? statSync(join("index", "aliases.yaml")).mtimeMs : 0;
  const saved = JSON.parse(readFileSync(STATE, "utf8"));
  if (saved.items["tidy:batch"]?.stage === "tidy") return [];
  if (!saved.reindex && Math.max(newestMtime("moments"), aliases) <= built) return [];
  // New names are new against the last list built, which a tidy may have rebuilt itself.
  const known = new Set(topicRows().map((row) => row.slug));
  const r = spawnSync(process.execPath, [script("build-index.mjs")], { encoding: "utf8" });
  if (r.status !== 0) return [`index/ could not be rebuilt: ${(r.stderr || "").trim().split("\n")[0]}`];
  const rows = topicRows();
  const lines = withState((s) => {
    const had = Object.keys(s.topics).length > 0;
    const triaged = new Set(s.triaged ?? []);
    const fresh = had && known.size ? rows.filter((row) => !known.has(row.slug) && !triaged.has(row.slug)) : [];
    // A big topic is looked at once, and again only when it has doubled.
    const checked = s.split_checked ?? {};
    const big = had ? rows.filter((row) => row.moments > SPLIT_MOMENTS && row.moments >= 2 * (checked[row.slug] ?? 0)) : [];
    if (fresh.length || big.length) {
      // Pages wait for the sort, then this runs again.
      mkdirSync(dirname(BATCH), { recursive: true });
      writeFileSync(BATCH, batchBrief(fresh, big));
      s.triaged = [...triaged, ...fresh.map((row) => row.slug)];
      s.split_checked = { ...checked, ...Object.fromEntries(big.map((row) => [row.slug, row.moments])) };
      s.items["tidy:batch"] = { key: "tidy:batch", kind: "tidy", file: join("index", "aliases.yaml"), name: "the batch's topics", stage: "tidy", tries: 0 };
      s.reindex = true;
      return [`rebuilt index/: ${rows.length} topics`, `${[fresh.length ? `${fresh.length} new topic names` : "", big.length ? `${big.length} big topics` : ""].filter(Boolean).join(" and ")} to sort before any page`];
    }
    s.reindex = false;
    const touched = [];
    for (const row of rows) {
      const hash = hashTopic(row.slug);
      const moved = s.topics[row.slug] !== hash;
      s.topics[row.slug] = hash;
      const now = Object.fromEntries(entriesOf(row.slug).map((e) => [e.id, e.link]));
      const page = join("content", "topics", `${row.slug}.md`);
      const exists = existsSync(page);
      const files = [...(had && exists || (s.auto_pages && row.passes && !exists) ? [page] : []), ...(had ? guidesOn(row.slug) : [])];
      for (const file of files) {
        // A page that knows what it was written from waits for its moments to change; a link moving in Related is not one.
        const rec = s.pages?.[file];
        const differs = rec ? Object.keys(now).length !== Object.keys(rec.moments).length || Object.keys(now).some((id) => !(id in rec.moments)) : moved;
        if (!differs) continue;
        const item = pageItem(row.slug, row.name, file);
        if (PAGE_STAGES.includes(s.items[item.key]?.stage)) continue;
        s.items[item.key] = item;
        touched.push(file);
      }
    }
    return [`rebuilt index/: ${rows.length} topics`, ...(touched.length ? [`queued ${touched.length} pages whose moments changed`] : [])];
  });
  if (lines.some((l) => l.startsWith("queued "))) markTold();
  return lines;
}

/** Rebuilt once pages are queued, so each topic file marks the stories a queued page will tell. */
function markTold() {
  spawnSync(process.execPath, [script("build-index.mjs")], { encoding: "utf8" });
}

function autoDeploy() {
  return /^Automatic deploys: *yes/im.test(existsSync("SITE.md") ? readFileSync("SITE.md", "utf8") : "");
}

function tick(/** @type {string[]} */ rest) {
  noMore(rest, 0, "pipeline tick");
  if (!existsSync(STATE)) return done("pipeline tick", "nothing is queued");
  withState(expireClaims);
  const lines = [...fetchQueued()];
  const peek = () => JSON.parse(readFileSync(STATE, "utf8"));
  if (!Object.values(peek().items).some(isActiveSource)) lines.push(...rebuildIndex());

  const state = peek();
  const items = Object.values(state.items).map((i) => /** @type {any} */ (i));
  const c = counts(state);
  const sourcesLeft = items.some(isActiveSource);
  const toRead = items.some((i) => ["distill", "moments", "align"].includes(i.stage));
  const toWrite = !sourcesLeft && c.page > 0;
  const anything = sourcesLeft || c.page > 0;

  /** @type {Record<string, any>} */
  const wanted = { [JOB.page]: toWrite ? { when: CRON, prompt: nextPrompt("page") } : null };
  for (let n = 0; n < DISTILL_JOBS; n++) wanted[JOB.source(n)] = toRead ? { when: CRON, prompt: nextPrompt("source") } : null;
  const { changes, note, failures } = matchJobs(wanted);
  lines.push(...changes, ...(note ? [note] : []));

  if (!anything && state.pages_ready > 0) {
    const n = state.pages_ready;
    if (autoDeploy()) {
      const r = spawnSync("npm", ["run", "--silent", "deploy"], { encoding: "utf8" });
      const line = r.status === 0 ? `Deployed the site with ${n} new or updated pages.` : `The automatic deploy stopped: ${(r.stderr || "").trim().split("\n")[0].slice(0, 200)}`;
      postActivity(line);
      lines.push(line);
    } else {
      const line = `${n} new or updated page${n === 1 ? " is" : "s are"} ready to deploy when you say so.`;
      postActivity(line);
      lines.push(line);
    }
    withState((s) => { s.pages_ready = 0; });
  } else if (changes.length && !anything) postActivity(`Finished the queue: ${c.done} sources done, ${c.failed} failed.`);
  else if (changes.length) postActivity(`Pipeline: ${c.fetch} to fetch, ${c.distill + c.moments + c.align} steps on sources, ${c.page} pages to write.`);
  if (!anything) withState((s) => { s.auto_pages = false; });
  // Last, and only if every other job went as asked: a prompt job with nothing left to remove it would cost a turn every 15 minutes for good.
  if (anything || !failures) {
    const own = matchJobs({ [JOB.tick]: anything ? { when: CRON, command: "node scripts/pipeline.mjs tick" } : null });
    lines.push(...own.changes);
  }
  if (lines.length) say(`tick: ${lines.join("; ")}`);
  done("pipeline tick", `${c.fetch} to fetch, ${c.distill} for notes, ${c.moments} for moments, ${c.align} to align, ${c.page} pages to write, ${c.failed} failed`, { lines });
}

function watch(/** @type {any} */ a, /** @type {string[]} */ rest) {
  noMore(rest, 0, "pipeline watch");
  const names = [JOB.newSources, JOB.websites, JOB.health, JOB.audit];
  if (has(a, "off")) {
    const { changes, note } = matchJobs(Object.fromEntries(names.map((n) => [n, null])));
    return done("pipeline watch", changes.length ? `removed ${changes.length} standing jobs` : "no standing jobs to remove", { lines: [...changes, ...(note ? [note] : [])] });
  }
  const address = /^Address: *(\S+)/m.exec(existsSync("SITE.md") ? readFileSync("SITE.md", "utf8") : "")?.[1];
  /** @type {Record<string, any>} */
  const wanted = {};
  if (knownChannels().length) wanted[JOB.newSources] = { when: "7 6 * * 1", command: "node scripts/sources.mjs list && node scripts/pipeline.mjs queue --new --confirm" };
  if (knownSites().length) wanted[JOB.websites] = { when: "0 6 1 * *", command: "node scripts/sources.mjs crawl && node scripts/pipeline.mjs queue --new --confirm" };
  if (address) wanted[JOB.health] = { when: "0 7 * * 1", command: `tt-crawl audit ${address}` };
  wanted[JOB.audit] = { when: "0 8 1 * *", prompt: "Audit the site with the cross-check skill. Read the latest audit first, and stop early if nothing has changed and nothing is wrong." };
  if (!has(a, "confirm")) {
    console.log(`pipeline watch: would add ${Object.keys(wanted).length} standing jobs\n${Object.entries(wanted).map(([n, j]) => `  ${n}: "${j.when}"`).join("\n")}\n  New sources are fetched, distilled and written without asking again, which spends credits and AI; the audit costs an AI turn a month.\n\nNothing was scheduled. If the owner agreed: node scripts/pipeline.mjs watch --confirm`);
    return undefined;
  }
  const { changes, note } = matchJobs(wanted);
  done("pipeline watch", changes.length ? `${changes.length} standing jobs added` : "the standing jobs are already there, left alone", { lines: [...changes, ...(note ? [note] : [])], next: "python3 ~/tools/taskandtool.py list-jobs" });
}

function main() {
  const argv = process.argv.slice(2);
  // It prints text, so its refusal of --json is text too.
  if (argv.includes("--json")) {
    parseArgs([]);
    misused("pipeline: it prints text, no --json", "node scripts/pipeline.mjs --help");
  }
  const a = parseArgs(argv, { bare: ["all", "new", "pages", "off"] });
  const [cmd, ...rest] = a._;
  usage(a, cmd, ["status", "queue", "next", "done", "tick", "watch"], HELP, "pipeline", { status: [], queue: ["sample", "all", "new", "pages", "topic", "confirm"], next: [], done: ["failed"], tick: [], watch: ["off", "confirm"] });
  if (cmd === "status") {
    noMore(rest, 0, "pipeline status");
    status();
  } else if (cmd === "queue") queue(a, rest);
  else if (cmd === "next") next(rest);
  else if (cmd === "done") finish(a, rest);
  else if (cmd === "tick") tick(rest);
  else watch(a, rest);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
