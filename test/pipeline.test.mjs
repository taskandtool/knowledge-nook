import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spread } from "../scripts/pipeline.mjs";
import { fakeVendor } from "./fake-scrapecreators.mjs";

const app = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));

/** The machine's bridge, standing in at the path scripts call: it keeps jobs and activity in files. */
const BRIDGE = `import json, os, sys
here = os.path.dirname(os.path.abspath(__file__))
args = [a for a in sys.argv[1:] if a != "--json"]
path = os.path.join(here, "jobs.json")
jobs = json.load(open(path)) if os.path.exists(path) else []
if os.path.exists(os.path.join(here, "broken")):
    print("bridge is down", file=sys.stderr); sys.exit(1)
cmd = args[0]
if cmd == "list-jobs":
    print(json.dumps({"ok": True, "jobs": jobs}))
elif cmd == "schedule-job":
    if os.path.exists(os.path.join(here, "no-schedule")):
        print(json.dumps({"ok": False, "error": "refused"}), file=sys.stderr); sys.exit(1)
    job = {"id": len(jobs) + 100, "name": args[1], "when": args[args.index("--when") + 1]}
    for k in ("--command", "--prompt"):
        if k in args: job[k[2:]] = args[args.index(k) + 1]
    jobs.append(job); json.dump(jobs, open(path, "w")); print(json.dumps({"ok": True, "job": job}))
elif cmd == "unschedule-job":
    if os.path.exists(os.path.join(here, "no-remove-" + next(j["name"] for j in jobs if str(j["id"]) == args[1]).replace(" ", "-"))):
        print(json.dumps({"ok": False, "error": "refused"}), file=sys.stderr); sys.exit(1)
    json.dump([j for j in jobs if str(j["id"]) != args[1]], open(path, "w")); print(json.dumps({"ok": True}))
elif cmd == "post-activity":
    open(os.path.join(here, "activity.txt"), "a").write(args[1] + "\\n"); print(json.dumps({"ok": True}))
elif cmd == "deploy":
    open(os.path.join(here, "deploys.txt"), "a").write("deployed\\n"); print(json.dumps({"ok": True}))
`;

function machine(files = {}, { bridge = true } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), "nook-pipe-"));
  const all = { ...(bridge ? { "tools/taskandtool.py": BRIDGE } : {}), ...files };
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), text);
  }
  return cwd;
}
const run = (cwd, args, env = {}, script = "scripts/pipeline.mjs") =>
  new Promise((finish) => execFile(process.execPath, [app(script), ...args], { cwd, env: { PATH: process.env.PATH, HOME: cwd, ...env }, encoding: "utf8", timeout: 60_000 }, (err, stdout, stderr) => finish({ status: err ? err.code : 0, stdout, stderr })));
const jobs = (cwd) => (existsSync(join(cwd, "tools/jobs.json")) ? JSON.parse(readFileSync(join(cwd, "tools/jobs.json"), "utf8")) : []);
const jobNames = (cwd) => jobs(cwd).map((j) => j.name).sort();
const activity = (cwd) => (existsSync(join(cwd, "tools/activity.txt")) ? readFileSync(join(cwd, "tools/activity.txt"), "utf8") : "");
const state = (cwd) => JSON.parse(readFileSync(join(cwd, "pipeline/state.json"), "utf8"));
const setState = (cwd, change) => { const s = state(cwd); change(s); writeFileSync(join(cwd, "pipeline/state.json"), JSON.stringify(s)); };

const stamp = (m) => `00:${String(m).padStart(2, "0")}:00`;
const rawOf = (id, date = "2020-01-02") => `---\ntitle: "Talk ${id}"\nsource: youtube\nid: ${id}\nurl: https://youtube.com/watch?v=${id}\npublished: ${date}\n---\n\n## Transcript\n\n${Array.from({ length: 10 }, (_, m) => `L${String(m + 1).padStart(4, "0")} ${stamp(m)} ${m === 0 ? "the budget is a dumb rule " : ""}${"word ".repeat(30).trim()}`).join("\n")}\n`;
const kept = "kept ".repeat(50).trim();
const goodDistilled = (id, date = "2020-01-02", topic = "budgets") => `---\ntitle: "Talk ${id}"\nsource: youtube\nurl: https://youtube.com/watch?v=${id}\npublished: ${date}\ntopics: [talks]\n---\n\n## 00:00:00 | ${topic}\n\nHe calls it "a dumb rule". ${kept}\n\n## 00:05:00 | ${topic}\n\n${kept}\n`;
const rawPath = (id, date = "2020-01-02") => `raw/youtube/chan/${date}-${id}.md`;
const channel = (videos) => JSON.stringify({ channel: "chan", param: { handle: "chan" }, videos });
const fetched = (id, date = "2020-01-02") => ({ id, state: "fetched", file: rawPath(id, date), published: date, seconds: 600 });
const withVideos = (...ids) => ({ "sources/chan.json": channel(ids.map((id) => fetched(id))), ...Object.fromEntries(ids.map((id) => [rawPath(id), rawOf(id)])) });
const distilledPath = (id) => rawPath(id).replace(/^raw/, "distilled");
const writeDistilled = (cwd, id, text = goodDistilled(id)) => { mkdirSync(dirname(join(cwd, distilledPath(id))), { recursive: true }); writeFileSync(join(cwd, distilledPath(id)), text); };

test("--help and bad input keep the contract", async () => {
  const cwd = machine();
  for (const h of ["--help", "-h"]) {
    const r = await run(cwd, [h]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /usage: node scripts\/pipeline\.mjs/);
  }
  for (const [args, status] of [[[], 2], [["nope"], 2], [["status", "--nope"], 2], [["status", "stray"], 2], [["queue"], 2], [["queue", "--all", "--new"], 2], [["queue", "--sample", "x"], 2], [["queue", "--all", "--topic", "x"], 2], [["next"], 2], [["next", "other"], 2], [["done"], 2], [["done", "raw/x.md"], 1], [["status", "--json"], 2]]) {
    const r = await run(cwd, args);
    assert.equal(r.status, status, args.join(" "));
    assert.equal(r.stdout, "", args.join(" "));
    assert.match(r.stderr, /Try: /, args.join(" "));
  }
});

test("a sample spreads across the dates and never takes one twice", () => {
  const list = Array.from({ length: 100 }, (_, i) => ({ key: String(i).padStart(3, "0"), date: `2020-01-${String((i % 28) + 1).padStart(2, "0")}` }));
  const year = Array.from({ length: 12 }, (_, m) => ({ key: `m${m}`, date: `2020-${String(m + 1).padStart(2, "0")}-01` }));
  assert.deepEqual(spread(year, 3).map((x) => x.key), ["m0", "m4", "m8"]);
  assert.equal(new Set(spread(list, 20).map((x) => x.key)).size, 20);
  assert.equal(spread(list, 500).length, 100);
});

test("queue previews what it would spend, and changes nothing until --confirm", async () => {
  const cwd = machine({ "sources/chan.json": channel([{ id: "aaa", state: "pending", published: "2020-01-02", seconds: 3600 }, { id: "bbb", state: "pending", published: "2021-01-02", seconds: 3600 }]) });
  const preview = await run(cwd, ["queue", "--all"]);
  assert.equal(preview.status, 0);
  assert.match(preview.stdout, /would add 2 sources/);
  assert.match(preview.stdout, /about 4 credits to fetch 2, 2\.0 hours of video, 6 AI runs/);
  assert.match(preview.stdout, /Nothing was queued\. If the owner agreed: node scripts\/pipeline\.mjs queue --all --confirm/);
  assert.ok(!existsSync(join(cwd, "pipeline/state.json")));
  assert.deepEqual(jobNames(cwd), []);
  const r = await run(cwd, ["queue", "--all", "--confirm"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(state(cwd).items["youtube:aaa"].stage, "fetch");
  assert.deepEqual(jobNames(cwd), ["Run the pipeline"]);
  assert.match(jobs(cwd)[0].command, /pipeline\.mjs tick/);
  const again = await run(cwd, ["queue", "--all", "--confirm"]);
  assert.match(again.stdout, /nothing new/);
  assert.deepEqual(jobNames(cwd), ["Run the pipeline"], "a job is never made twice");
  assert.match(readFileSync(join(cwd, "log.md"), "utf8"), /queued 2 sources/);
});

test("a video left out or already gone is not queued; a source starts where its files say it has got to", async () => {
  const cwd = machine({
    "sources/chan.json": JSON.stringify({ channel: "chan", param: {}, leave_out: { since: "2020-01-01" }, videos: [{ id: "old", state: "pending", published: "2019-01-01" }, { id: "gone", state: "pending", gone: true }, fetched("have")] }),
    [rawPath("have")]: rawOf("have"), [distilledPath("have")]: goodDistilled("have"),
  });
  await run(cwd, ["queue", "--all", "--confirm"]);
  assert.deepEqual(Object.keys(state(cwd).items), ["youtube:have"]);
  assert.equal(state(cwd).items["youtube:have"].stage, "moments");
});

const goodMoments = (id) => `---\ntitle: "Talk ${id}"\nurl: https://youtube.com/watch?v=${id}\n---\n\n## Gist\n\nBudgets are a dumb rule.\n\n## Strongest\n\n- 00:00:00 Budgets are "a dumb rule".\n\n## Moments\n\n- 00:00:00 | budgets | Budgets are "a dumb rule".\n`;
const writeMoments = (cwd, id, text = goodMoments(id)) => { const p = join(cwd, rawPath(id).replace(/^raw/, "moments")); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); };

test("the path of one source: notes, moments, align, each a fresh run and each checked", async () => {
  const cwd = machine(withVideos("aaa"));
  await run(cwd, ["queue", "--all", "--confirm"]);
  const raw = rawPath("aaa");
  const stage = () => state(cwd).items["youtube:aaa"].stage;
  const refused = await run(cwd, ["done", raw]);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /no run has claimed it/);

  const first = await run(cwd, ["next", "source"]);
  assert.match(first.stdout, /pipeline next: distill raw\/youtube/);
  assert.match(first.stdout, /with the distill skill/);
  assert.match(first.stdout, /Last, run the Next line below/);
  assert.match(first.stdout, /Next: node scripts\/pipeline\.mjs done raw/);
  assert.match((await run(cwd, ["next", "source"])).stdout, /nothing to do.*Stop here/, "a claimed source is nobody else's");

  const noFile = await run(cwd, ["done", raw]);
  assert.equal(noFile.status, 1);
  assert.match(noFile.stderr, /does not pass its check yet/);
  writeDistilled(cwd, "aaa", goodDistilled("aaa").replace('"a dumb rule"', '"an invented line"'));
  const bad = await run(cwd, ["done", raw]);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /invented line/);
  assert.equal(stage(), "distill");

  writeDistilled(cwd, "aaa");
  const passed = await run(cwd, ["done", raw]);
  assert.equal(passed.status, 0, passed.stderr);
  assert.match(passed.stdout, /a fresh run takes the next step/);
  assert.equal(stage(), "moments");
  const skip = await run(cwd, ["done", raw]);
  assert.equal(skip.status, 1, "the run that wrote the notes can't also pass the next step");
  assert.match(skip.stderr, /at moments and no run has claimed it/);

  const moments = await run(cwd, ["next", "source"]);
  assert.match(moments.stdout, /pipeline next: moments raw/);
  assert.match(moments.stdout, /with the moments skill/);
  writeMoments(cwd, "aaa", goodMoments("aaa").replace(/"a dumb rule"/g, '"never said aloud"'));
  const flat = await run(cwd, ["done", raw]);
  assert.equal(flat.status, 1);
  assert.match(flat.stderr, /quote isn't in the captions/);
  writeMoments(cwd, "aaa");
  assert.equal((await run(cwd, ["done", raw])).status, 0);
  assert.equal(stage(), "align");

  const align = await run(cwd, ["next", "source"]);
  assert.match(align.stdout, /pipeline next: align raw/);
  assert.match(align.stdout, /with the align skill/);
  writeDistilled(cwd, "aaa", goodDistilled("aaa").replace('"a dumb rule"', '"an invented line"'));
  assert.equal((await run(cwd, ["done", raw])).status, 1, "align answers for the notes too");
  writeDistilled(cwd, "aaa");
  assert.equal((await run(cwd, ["done", rawPath("aaa").replace(/^raw/, "moments")])).status, 0, "any of its paths names it");
  assert.equal(stage(), "done");
  const twice = await run(cwd, ["done", raw]);
  assert.equal(twice.status, 0);
  assert.match(twice.stdout, /already finished, left alone/);
  assert.match(readFileSync(join(cwd, "log.md"), "utf8"), /align finished/);
});

test("runs at the same moment never claim one source", async () => {
  const ids = ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"];
  const cwd = machine(withVideos(...ids));
  await run(cwd, ["queue", "--all", "--confirm"]);
  const out = await Promise.all(ids.map(() => run(cwd, ["next", "source"])));
  const named = out.map((r) => /distill (raw\S+)/.exec(r.stdout)?.[1]);
  assert.equal(new Set(named).size, 8, JSON.stringify(named));
  assert.ok(!named.includes(undefined));
});

test("a run that gives up, or dies, costs a try; three end it, reported, and the rest carry on", async () => {
  const cwd = machine(withVideos("aaa", "bbb"));
  await run(cwd, ["queue", "--all", "--confirm"]);
  const take = async () => /distill (raw\S+)/.exec((await run(cwd, ["next", "source"])).stdout)?.[1];
  const file = await take();
  const key = Object.keys(state(cwd).items).find((k) => state(cwd).items[k].file === file);
  assert.match((await run(cwd, ["done", file, "--failed", "garbled"])).stdout, /goes back in the queue/);
  assert.equal(await take(), file);
  // Dies: the claim is old.
  setState(cwd, (s) => { s.items[key].claimed_at = new Date(Date.now() - 7 * 3_600_000).toISOString(); });
  assert.equal(await take(), file);
  assert.equal(state(cwd).items[key].tries, 2);
  assert.match((await run(cwd, ["done", file, "--failed", "garbled again"])).stdout, /failed 3 times; left out and reported/);
  assert.equal(state(cwd).items[key].stage, "failed");
  const other = await take();
  assert.ok(other && other !== file, "the rest carry on");
  assert.match((await run(cwd, ["status"])).stdout, /failed: raw\S+: garbled again/);
});

test("pages wait for every source, then are claimed one at a time and checked", async () => {
  const page = `---\ntype: topic\ntitle: Budgets\ndescription: A long enough sentence about what the speaker thinks of budgets in general.\n---\n\nI call it "a dumb rule" ([T](https://youtube.com/watch?v=aaa&t=0s)).\n`;
  const cwd = machine({ ...withVideos("aaa"), "index/topics.md": "# Topics\n\n- budgets: 2 sources, 6 moments\n- lone: 1 source, 1 moment, under the publish gate\n- done topic: 2 sources, 6 moments\n", "content/topics/done-topic.md": page });
  await run(cwd, ["queue", "--all", "--confirm"]);
  const preview = await run(cwd, ["queue", "--pages"]);
  assert.match(preview.stdout, /would add 1 page/);
  assert.doesNotMatch(preview.stdout, /lone|done topic/);
  await run(cwd, ["queue", "--pages", "--confirm"]);
  assert.match((await run(cwd, ["next", "page"])).stdout, /pages wait until every source/);
  await run(cwd, ["next", "source"]);
  writeDistilled(cwd, "aaa");
  await run(cwd, ["done", rawPath("aaa")]);
  await run(cwd, ["next", "source"]);
  writeMoments(cwd, "aaa");
  await run(cwd, ["done", rawPath("aaa")]);
  await run(cwd, ["next", "source"]);
  assert.match((await run(cwd, ["next", "page"])).stdout, /pages wait/, "a claimed source still holds them");
  await run(cwd, ["done", rawPath("aaa")]);
  const got = await run(cwd, ["next", "page"]);
  assert.match(got.stdout, /write content\/topics\/budgets\.md/);
  assert.match(got.stdout, /index\/topics\/budgets\.md, with the write-page skill/);
  const none = await run(cwd, ["done", "content/topics/budgets.md"]);
  assert.equal(none.status, 1);
  mkdirSync(join(cwd, "content/topics"), { recursive: true });
  writeFileSync(join(cwd, "content/topics/budgets.md"), page);
  const ok = await run(cwd, ["done", "content/topics/budgets.md"]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /a fresh run takes the next step/);
  assert.equal(state(cwd).items["page:content/topics/budgets.md"].stage, "page_verify");
  assert.equal((await run(cwd, ["done", "content/topics/budgets.md"])).status, 1, "the writer cannot pass its own verify");
  const verify = await run(cwd, ["next", "page"]);
  assert.match(verify.stdout, /verify content\/topics\/budgets\.md/);
  assert.doesNotMatch(verify.stdout, /Check these links first/, "nothing to point at when no link is reused");
  assert.match(verify.stdout, /references\/verify\.md/);
  assert.equal((await run(cwd, ["done", "content/topics/budgets.md"])).status, 0);
  assert.equal(state(cwd).items["page:content/topics/budgets.md"].stage, "done");
  assert.equal(state(cwd).pages_ready, 1, "ready only once verified");
  const named = await run(cwd, ["queue", "--pages", "--topic", "lone", "--topic", "done topic", "--confirm"]);
  assert.match(named.stdout, /added 2 pages/);
  assert.equal((await run(cwd, ["queue", "--pages", "--topic", "ghost"])).status, 1);
});

test("tick: fetches, adds the jobs, rebuilds when distilling ends, queues touched pages, and removes each job as its work ends", async () => {
  const vendor = await fakeVendor({
    pages: {},
    videos: { aaa: { title: "Talk aaa", publishDate: "2020-01-02T00:00:00Z" } },
    transcripts: { aaa: Array.from({ length: 10 }, (_, m) => ({ text: `${m === 0 ? "the budget is a dumb rule " : ""}${"word ".repeat(30).trim()}`, startMs: String(m * 60000), endMs: String((m + 1) * 60000) })) },
  });
  const env = { PHOENIX_URL: vendor.url, MACHINE_TOKEN: "t" };
  const cwd = machine({
    "sources/chan.json": channel([{ id: "aaa", url: "https://www.youtube.com/watch?v=aaa", title: "Talk aaa", state: "pending", published: "2020-01-02", seconds: 600 }]),
    "content/topics/budgets.md": "---\ntype: topic\ntitle: Budgets\ndescription: x\n---\n\nOld.\n",
    "content/guides/how-to-budget.md": "---\ntype: guide\ntitle: Budget\ndescription: x\ntopic: budgets\n---\n\nOld.\n",
  });
  await run(cwd, ["queue", "--all", "--confirm"], env);
  // The topic file existed before, so a change to it touches the page.
  setState(cwd, (s) => { s.topics = { budgets: "old" }; });

  const one = await run(cwd, ["tick"], env);
  assert.equal(one.status, 0, one.stderr);
  const item = state(cwd).items["youtube:aaa"];
  assert.equal(item.stage, "distill");
  assert.ok(existsSync(join(cwd, item.file)));
  assert.deepEqual(jobNames(cwd), ["Read next source", "Read next source 2", "Run the pipeline"]);
  assert.match(jobs(cwd).find((j) => j.name === "Read next source").prompt, /next source/);
  assert.match(activity(cwd), /1 steps on sources/);
  assert.equal(vendor.calls.filter((c) => c.key !== "t").length, 0, "through the gateway, with the machine token");

  const quiet = activity(cwd);
  await run(cwd, ["tick"], env);
  assert.equal(activity(cwd), quiet, "no change, no noise");
  assert.equal(vendor.calls.filter((c) => c.path.endsWith("transcript")).length, 1, "never fetched twice");

  await run(cwd, ["next", "source"], env);
  const dest = item.file.replace(/^raw/, "distilled");
  mkdirSync(dirname(join(cwd, dest)), { recursive: true });
  writeFileSync(join(cwd, dest), goodDistilled("aaa").replace("https://youtube.com/", "https://www.youtube.com/"));
  const d = await run(cwd, ["done", item.file], env);
  assert.equal(d.status, 0, d.stderr);
  await run(cwd, ["tick"], env);
  assert.ok(jobNames(cwd).includes("Read next source"), "moments and align are still to come");
  assert.ok(!existsSync(join(cwd, "index/topics.md")), "no rebuild while a source is in hand");
  await run(cwd, ["next", "source"], env);
  writeMoments(cwd, "aaa", goodMoments("aaa").replace("https://youtube.com/", "https://www.youtube.com/"));
  assert.equal((await run(cwd, ["done", item.file], env)).status, 0);
  await run(cwd, ["next", "source"], env);
  assert.equal((await run(cwd, ["done", item.file], env)).status, 0);

  const rebuilt = await run(cwd, ["tick"], env);
  assert.match(rebuilt.stdout, /rebuilt index/);
  assert.ok(existsSync(join(cwd, "index/topics/budgets.md")));
  assert.equal(state(cwd).items["page:content/topics/budgets.md"].stage, "page", "the page new sections touched");
  assert.equal(state(cwd).items["page:content/guides/how-to-budget.md"].stage, "page", "and the guide on that topic");
  assert.deepEqual(jobNames(cwd), ["Run the pipeline", "Write next page"]);

  setState(cwd, (s) => { for (const i of Object.values(s.items)) if (i.kind === "page") { i.stage = "done"; s.pages_ready = 2; } });
  const last = await run(cwd, ["tick"], env);
  assert.equal(last.status, 0);
  assert.deepEqual(jobNames(cwd), [], "it removes itself when nothing is left");
  assert.match(activity(cwd), /2 new or updated pages are ready to deploy when you say so/);
  await vendor.close();
});

test("tick stops fetching when the vendor stops it, says so once, keeps what it has, and tries later", async () => {
  const vendor = await fakeVendor({ pages: {}, status: (path) => (path.endsWith("transcript") ? 402 : undefined) });
  const env = { PHOENIX_URL: vendor.url, MACHINE_TOKEN: "t" };
  const cwd = machine({
    ...withVideos("have"),
    "sources/chan.json": channel([fetched("have"), { id: "aaa", url: "https://www.youtube.com/watch?v=aaa", state: "pending", published: "2020-02-02" }]),
  });
  await run(cwd, ["queue", "--all", "--confirm"], env);
  const r = await run(cwd, ["tick"], env);
  assert.equal(r.status, 0, "a halted fetch is a state, not a broken job");
  assert.match(r.stdout, /fetching stopped:.*out of credits/);
  assert.match(activity(cwd), /Stopped fetching transcripts:.*out of credits/);
  assert.equal(state(cwd).items["youtube:aaa"].stage, "fetch");
  assert.ok(jobNames(cwd).includes("Read next source"), "what is fetched goes on");
  const calls = vendor.calls.length;
  await run(cwd, ["tick"], env);
  assert.equal(vendor.calls.length, calls, "it waits instead of asking every 15 minutes");
  assert.equal(activity(cwd).match(/Stopped/g).length, 1);
  assert.match((await run(cwd, ["status"], env)).stdout, /fetching stopped/);
  setState(cwd, (s) => { s.halted.at = new Date(Date.now() - 7 * 3_600_000).toISOString(); });
  await run(cwd, ["tick"], env);
  assert.ok(vendor.calls.length > calls, "and tries again later");
  await vendor.close();
});

test("a video with no captions stops holding the queue, and --new picks it up again", async () => {
  const vendor = await fakeVendor({ pages: {}, transcripts: {} });
  const env = { PHOENIX_URL: vendor.url, MACHINE_TOKEN: "t" };
  const recent = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const cwd = machine({ "sources/chan.json": channel([{ id: "aaa", url: "https://www.youtube.com/watch?v=aaa", state: "pending", published: recent }]) });
  await run(cwd, ["queue", "--all", "--confirm"], env);
  await run(cwd, ["tick"], env);
  assert.equal(state(cwd).items["youtube:aaa"].stage, "no_captions");
  assert.deepEqual(jobNames(cwd), [], "nothing left to wait on");
  assert.match((await run(cwd, ["queue", "--new", "--confirm"], env)).stdout, /added 1 source/);
  assert.equal(state(cwd).items["youtube:aaa"].stage, "fetch");
  await vendor.close();
});

test("align can't finish without a gist and picks, and a channel named _anything still gets an index", async () => {
  const cwd = machine({ "sources/chan.json": channel([fetched("aaa")]), [rawPath("aaa")]: rawOf("aaa") });
  await run(cwd, ["queue", "--all", "--confirm"]);
  await run(cwd, ["next", "source"]);
  writeDistilled(cwd, "aaa");
  await run(cwd, ["done", rawPath("aaa")]);
  await run(cwd, ["next", "source"]);
  const bare = `---\ntitle: "Talk aaa"\n---\n\n## Moments\n\n- 00:00:00 | budgets | Budgets are "a dumb rule".\n`;
  writeMoments(cwd, "aaa", bare);
  assert.equal((await run(cwd, ["done", rawPath("aaa")])).status, 0, "moments need no gist yet");
  await run(cwd, ["next", "source"]);
  const refused = await run(cwd, ["done", rawPath("aaa")]);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /no gist/);
  writeMoments(cwd, "aaa");
  assert.equal((await run(cwd, ["done", rawPath("aaa")])).status, 0);

  const under = machine({ "sources/_chan.json": JSON.stringify({ channel: "_chan", param: {}, videos: [{ id: "bbb", state: "fetched", file: "raw/youtube/_chan/2020-01-02-bbb.md", published: "2020-01-02" }] }), "raw/youtube/_chan/2020-01-02-bbb.md": rawOf("bbb"), "moments/youtube/_chan/2020-01-02-bbb.md": goodMoments("bbb"), "distilled/youtube/_chan/2020-01-02-bbb.md": goodDistilled("bbb") });
  await run(under, ["queue", "--all", "--confirm"]);
  setState(under, (st) => { for (const i of Object.values(st.items)) i.stage = "done"; });
  assert.match((await run(under, ["tick"])).stdout, /rebuilt index/);
});

test("a changed web page starts over: its stale moments leave the site, and the index rebuilds", async () => {
  const pageOf = (hash) => `---\nurl: "https://a.example/p"\ntitle: "P"\nhash: "${hash}"\n---\n\nWords.\n`;
  const cwd = machine({ "raw/web/a.example/pages/p.md": pageOf("one"), "moments/web/a.example/pages/p.md": `---\ntitle: P\n---\n\n## Moments\n\n- 00:00:00 | acme | Words.\n`, "index/topics.md": "# Topics\n" });
  await run(cwd, ["queue", "--all", "--confirm"]);
  setState(cwd, (st) => { for (const i of Object.values(st.items)) i.stage = "done"; });
  writeFileSync(join(cwd, "raw/web/a.example/pages/p.md"), pageOf("two"));
  await run(cwd, ["queue", "--new", "--confirm"]);
  assert.ok(!existsSync(join(cwd, "moments/web/a.example/pages/p.md")));
  assert.ok(!existsSync(join(cwd, "index/topics.md")));
  assert.equal(state(cwd).items["file:raw/web/a.example/pages/p.md"].stage, "distill");
});

test("a failed bridge is never read as no jobs", async () => {
  const cwd = machine(withVideos("aaa"));
  await run(cwd, ["queue", "--all", "--confirm"]);
  await run(cwd, ["tick"]);
  const before = jobNames(cwd);
  writeFileSync(join(cwd, "tools/broken"), "");
  const r = await run(cwd, ["tick"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /the jobs could not be read, so none were changed/);
  assert.deepEqual(jobNames(cwd), before);
});

test("off a machine it still works, and says no jobs were changed", async () => {
  const cwd = machine(withVideos("aaa"), { bridge: false });
  const r = await run(cwd, ["queue", "--all", "--confirm"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /no Task & Tool bridge here/);
  assert.match((await run(cwd, ["next", "source"])).stdout, /distill raw/);
});

test("--new finds a changed web page by its hash, and an unchanged one costs nothing", async () => {
  const pageOf = (hash) => `---\nurl: "https://a.example/p"\ntitle: "P"\nhash: "${hash}"\n---\n\nWords.\n`;
  const cwd = machine({ "raw/web/a.example/pages/p.md": pageOf("one"), "raw/web/a.example/_index/inventory.md": "not a source", "raw/docs/2020-01-01-deck.md": "# Deck\n" });
  await run(cwd, ["queue", "--all", "--confirm"]);
  assert.deepEqual(Object.keys(state(cwd).items).sort(), ["file:raw/docs/2020-01-01-deck.md", "file:raw/web/a.example/pages/p.md"]);
  setState(cwd, (s) => { for (const i of Object.values(s.items)) i.stage = "done"; });
  const unchanged = await run(cwd, ["queue", "--new", "--confirm"]);
  assert.match(unchanged.stdout, /nothing new/);
  writeFileSync(join(cwd, "raw/web/a.example/pages/p.md"), pageOf("two"));
  const changed = await run(cwd, ["queue", "--new", "--confirm"]);
  assert.match(changed.stdout, /added 1 source/);
  assert.equal(state(cwd).items["file:raw/web/a.example/pages/p.md"].stage, "distill", "distilled again, replacing the old one");
  assert.equal(state(cwd).items["file:raw/docs/2020-01-01-deck.md"].stage, "done");
});

test("automatic deploys happen only on the owner's line", async () => {
  const bin = machine({ "bin/npm": "#!/bin/sh\necho deployed >> \"$HOME/tools/deploys.txt\"\n" });
  chmodSync(join(bin, "bin/npm"), 0o755);
  const finish = async (files) => {
    const cwd = machine({ ...withVideos("aaa"), ...files });
    await run(cwd, ["queue", "--all", "--confirm"]);
    setState(cwd, (s) => { for (const i of Object.values(s.items)) i.stage = "done"; s.pages_ready = 1; });
    const r = await run(cwd, ["tick"], { PATH: `${join(bin, "bin")}:${process.env.PATH}` });
    assert.equal(r.status, 0, r.stderr);
    return cwd;
  };
  const asked = await finish({});
  assert.ok(!existsSync(join(asked, "tools/deploys.txt")));
  assert.match(activity(asked), /1 new or updated page is ready to deploy/);
  const auto = await finish({ "SITE.md": "Automatic deploys: yes\n" });
  assert.ok(existsSync(join(auto, "tools/deploys.txt")));
  assert.match(activity(auto), /Deployed the site/);
});

test("watch previews, adds only what applies, never twice, and --off removes them", async () => {
  const cwd = machine({ "sources/chan.json": channel([]), "SITE.md": "Address: https://pit.example\n" });
  const preview = await run(cwd, ["watch"]);
  assert.match(preview.stdout, /would add 3 standing jobs/);
  assert.match(preview.stdout, /Nothing was scheduled/);
  assert.deepEqual(jobNames(cwd), []);
  assert.equal((await run(cwd, ["watch", "--confirm"])).status, 0);
  assert.deepEqual(jobNames(cwd), ["Audit", "Check for new sources", "Site health"]);
  assert.match(jobs(cwd).find((j) => j.name === "Site health").command, /tt-crawl audit https:\/\/pit\.example/);
  assert.match(jobs(cwd).find((j) => j.name === "Check for new sources").command, /queue --new --confirm/);
  assert.match((await run(cwd, ["watch", "--confirm"])).stdout, /already there, left alone/);
  assert.equal(jobs(cwd).length, 3);
  assert.equal((await run(cwd, ["watch", "--off"])).status, 0);
  assert.deepEqual(jobNames(cwd), []);
});

test("--new takes only what appeared since: never the back catalogue, a sample's leftovers, or a first read", async () => {
  const cwd = machine({ "sources/chan.json": channel([{ id: "aaa", state: "pending", published: "2020-01-02" }, { id: "bbb", state: "pending", published: "2020-02-02" }, { id: "ccc", state: "pending", published: "2020-03-02" }, { id: "nnn", state: "pending", published: "2026-01-02", fresh: true }]), "raw/web/a.example/pages/first.md": '---\nurl: "https://a.example/first"\nhash: "1"\n---\n', "raw/web/a.example/pages/later.md": '---\nurl: "https://a.example/later"\nhash: "2"\n---\n', "sources/new-pages.txt": "raw/web/a.example/pages/later.md\n" });
  const r = await run(cwd, ["queue", "--new", "--confirm"]);
  assert.match(r.stdout, /added 2 sources/);
  assert.deepEqual(Object.keys(state(cwd).items).sort(), ["file:raw/web/a.example/pages/later.md", "youtube:nnn"]);
});

test("the preview says what pages it can lead to, and new topics stop being queued when the queue ends", async () => {
  const cwd = machine(withVideos("aaa"));
  assert.match((await run(cwd, ["queue", "--all"])).stdout, /then 2 runs for each written page the new moments touch/);
  await run(cwd, ["queue", "--all", "--confirm"]);
  setState(cwd, (s) => { s.auto_pages = true; for (const i of Object.values(s.items)) i.stage = "done"; });
  await run(cwd, ["tick"]);
  assert.equal(state(cwd).auto_pages, false);
});

test("a prompt job that cannot be removed keeps the tick that will try again", async () => {
  const cwd = machine(withVideos("aaa"));
  await run(cwd, ["queue", "--all", "--confirm"]);
  await run(cwd, ["tick"]);
  assert.ok(jobNames(cwd).includes("Read next source"));
  setState(cwd, (s) => { for (const i of Object.values(s.items)) i.stage = "done"; });
  writeFileSync(join(cwd, "tools/no-remove-Read-next-source"), "");
  await run(cwd, ["tick"]);
  assert.ok(jobNames(cwd).includes("Run the pipeline"), "the tick stays");
  rmSync(join(cwd, "tools/no-remove-Read-next-source"));
  await run(cwd, ["tick"]);
  assert.deepEqual(jobNames(cwd), []);
});

test("one video's failure is not a vendor stop", async () => {
  const vendor = await fakeVendor({ pages: {}, status: (path) => (path.endsWith("transcript") ? 404 : undefined) });
  const env = { PHOENIX_URL: vendor.url, MACHINE_TOKEN: "t" };
  const cwd = machine({ "sources/chan.json": channel([{ id: "aaa", url: "https://www.youtube.com/watch?v=aaa", state: "pending", published: "2020-02-02" }]) });
  await run(cwd, ["queue", "--all", "--confirm"], env);
  await run(cwd, ["tick"], env);
  assert.equal(state(cwd).halted, null);
  assert.doesNotMatch(activity(cwd), /Stopped fetching/);
  const calls = vendor.calls.length;
  await run(cwd, ["tick"], env);
  assert.ok(vendor.calls.length > calls, "tried again next tick");
  await run(cwd, ["tick"], env);
  assert.equal(state(cwd).items["youtube:aaa"].stage, "failed", "and three failures end it");
  await vendor.close();
});

test("a queue whose job could not be added says so, and running it again adds the job", async () => {
  const cwd = machine(withVideos("aaa"));
  writeFileSync(join(cwd, "tools/no-schedule"), "");
  const r = await run(cwd, ["queue", "--all", "--confirm"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /could not be added/);
  assert.equal(state(cwd).items["youtube:aaa"].stage, "distill", "what was asked for is kept");
  rmSync(join(cwd, "tools/no-schedule"));
  assert.equal((await run(cwd, ["queue", "--all", "--confirm"])).status, 0);
  assert.deepEqual(jobNames(cwd), ["Run the pipeline"]);
});

test("a failed source is left out of the index, and the gate is the owner's", async () => {
  const cwd = machine({ ...withVideos("aaa", "bbb"), "SITE.md": "Publish gate: 1 source, 1 moment\n" });
  writeMoments(cwd, "aaa", goodMoments("aaa").replace(/\| budgets \|/g, "| kept topic |"));
  writeMoments(cwd, "bbb", goodMoments("bbb").replace(/\| budgets \|/g, "| failed topic |"));
  await run(cwd, ["queue", "--all", "--confirm"]);
  setState(cwd, (s) => { s.items["youtube:aaa"].stage = "done"; s.items["youtube:bbb"].stage = "failed"; });
  const r = await run(cwd, [], {}, "scripts/build-index.mjs");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /1 left out: they failed/);
  const list = readFileSync(join(cwd, "index/topics.md"), "utf8");
  assert.doesNotMatch(list, /failed topic/);
  assert.match(list, /- kept topic: 1 source, 1 moment\n/, "1 source passes a gate of 1");
  writeFileSync(join(cwd, "SITE.md"), "Publish gate: 5 sources\n");
  await run(cwd, [], {}, "scripts/build-index.mjs");
  assert.match(readFileSync(join(cwd, "index/topics.md"), "utf8"), /kept topic: 1 source, 1 moment, under the publish gate/);
});

test("crawl reads a site with tt-crawl, remembers it, and reports what changed", async () => {
  const fake = `#!/bin/sh
echo "$@" >> "$HOME/crawl-calls.txt"
[ "$1" = "pages" ] || exit 0
[ "$2" = "https://broken.example" ] && { echo "the host refused" >&2; exit 1; }
out=""; while [ $# -gt 0 ]; do [ "$1" = "--out" ] && out="$2"; shift; done
mkdir -p "$out/pages"
version=$(cat "$HOME/version" 2>/dev/null || echo one)
printf -- '---\\nurl: "https://a.example/p"\\ntitle: "P"\\nhash: "%s"\\n---\\n\\nWords.\\n' "$version" > "$out/pages/p.md"
[ "$version" = two ] && printf -- '---\\nurl: "https://a.example/q"\\nhash: "q"\\n---\\n' > "$out/pages/q.md"
exit 0
`;
  const cwd = machine({ "bin/tt-crawl": fake });
  chmodSync(join(cwd, "bin/tt-crawl"), 0o755);
  const env = { PATH: `${join(cwd, "bin")}:${process.env.PATH}` };
  const go = (args) => run(cwd, args, env, "scripts/sources.mjs");
  assert.equal((await go(["crawl", "not-a-site"])).status, 2);
  assert.equal((await go(["crawl"])).status, 1, "no sites yet");
  const first = await go(["crawl", "https://www.a.example"]);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /a\.example: 1 pages, 1 new, 0 changed/);
  assert.ok(existsSync(join(cwd, "raw/web/a.example/pages/p.md")));
  assert.match(readFileSync(join(cwd, "crawl-calls.txt"), "utf8"), /--external --images none/);
  writeFileSync(join(cwd, "version"), "two");
  const second = await go(["crawl"]);
  assert.match(second.stdout, /2 pages, 1 new, 1 changed/);
  assert.equal(readFileSync(join(cwd, "sources/new-pages.txt"), "utf8"), "raw/web/a.example/pages/q.md\n", "a later read's new page counts as new, a first read's don't");
  assert.equal(readFileSync(join(cwd, "sources/sites.txt"), "utf8"), "https://www.a.example\n", "remembered once");
  const bad = await go(["crawl", "https://broken.example"]);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /the host refused/);
  assert.equal(readFileSync(join(cwd, "sources/sites.txt"), "utf8").includes("broken"), false, "a site that fails is not remembered");
  const none = await run(machine(), ["crawl", "https://a.example"], { PATH: "/nonexistent" }, "scripts/sources.mjs");
  assert.equal(none.status, 1);
  assert.match(none.stderr, /tt-crawl is not installed/);
  assert.match(none.stderr, /after-setup\.sh/);
});

test("the whole loop's output names only what the owner can act on: never a deploy in Next", async () => {
  const cwd = machine(withVideos("aaa"));
  await run(cwd, ["queue", "--all", "--confirm"]);
  for (const args of [["status"], ["tick"], ["next", "source"]]) {
    const r = await run(cwd, args);
    assert.doesNotMatch(r.stdout, /^Next:.*deploy/m, args.join(" "));
  }
});


test("a written page is rewritten whole when its moments change: new names and big topics sorted first, and a move in Related is not a change", async () => {
  const cwd = machine(withVideos("aaa", "bbb"));
  const moments = (id, lines) => writeMoments(cwd, id, `---\ntitle: "Talk ${id}"\nurl: https://youtube.com/watch?v=${id}\n---\n\n## Gist\n\nBudgets.\n\n## Strongest\n\n- 00:00:00 Budgets.\n\n## Moments\n\n${lines.join("\n")}\n`);
  for (const id of ["aaa", "bbb"]) writeDistilled(cwd, id);
  moments("aaa", ["- 00:00:00 | budgets | Budgets are \"a dumb rule\".", "- 00:05:00 | budgets | Budgets keep spending honest."]);
  await run(cwd, ["queue", "--all", "--confirm"]);
  // bbb is not read yet: only aaa counts as finished.
  setState(cwd, (s) => { s.items["youtube:aaa"].stage = "done"; delete s.items["youtube:bbb"]; });
  assert.match((await run(cwd, ["tick"])).stdout, /rebuilt index/);
  const file = "content/topics/budgets.md";
  const page = (body) => { mkdirSync(join(cwd, "content/topics"), { recursive: true }); writeFileSync(join(cwd, file), `---\ntype: topic\ntitle: Budgets\ndescription: A long enough sentence about what the speaker thinks of budgets in general.\n---\n\n${body}\n`); };
  const first = "I call it \"a dumb rule\" ([1](https://youtube.com/watch?v=aaa&t=0s)).";
  await run(cwd, ["queue", "--pages", "--topic", "budgets", "--confirm"]);
  const write = await run(cwd, ["next", "page"]);
  assert.match(write.stdout, /pipeline next: write content\/topics\/budgets\.md/);
  assert.doesNotMatch(write.stdout, /was verified/, "a first write has no verified page to keep links from");
  page(first);
  await run(cwd, ["done", file]);
  await run(cwd, ["next", "page"]);
  assert.equal((await run(cwd, ["done", file])).status, 0);
  assert.equal(Object.keys(state(cwd).pages[file].moments).length, 2, "the page knows what it was written from");

  // Rebuilt with nothing new: the page is left alone.
  moments("aaa", ["- 00:00:00 | budgets | Budgets are \"a dumb rule\".", "- 00:05:00 | budgets | Budgets keep spending honest."]);
  assert.doesNotMatch((await run(cwd, ["tick"])).stdout, /queued/);

  // A new source, with a name the site has not used.
  moments("bbb", ["- 00:00:00 | budgets | Budgets are \"a dumb rule\" for spending.", "- 00:05:00 | envelopes | Cash envelopes keep spending honest."]);
  const sorted = await run(cwd, ["tick"]);
  assert.match(sorted.stdout, /1 new topic names to sort before any page/);
  assert.equal(state(cwd).items[`page:${file}`].stage, "done", "pages wait for the sort");
  assert.match(readFileSync(join(cwd, "pipeline/briefs/batch.md"), "utf8"), /## New names[\s\S]*- envelopes: 1 moment in 1 source\(s\)\. First: Cash envelopes/);
  assert.doesNotMatch((await run(cwd, ["tick"])).stdout, /queued/, "and keep waiting while it is open");
  const tidy = await run(cwd, ["next", "page"]);
  assert.match(tidy.stdout, /sort the batch's topics/);
  assert.match(tidy.stdout, /with the topics skill: only those/);
  setState(cwd, (st) => { st.items[`page:${file}`].stage = "page"; });
  assert.match((await run(cwd, ["next", "page"])).stdout, /pages wait until another run has sorted the topics/, "no page while a sort is open");
  setState(cwd, (st) => { st.items[`page:${file}`].stage = "done"; delete st.items[`page:${file}`].claimed_at; });
  writeFileSync(join(cwd, "index/aliases.yaml"), "envelopes: budgets\n");
  assert.equal((await run(cwd, ["done", "index/aliases.yaml"])).status, 0);
  assert.match((await run(cwd, ["tick"])).stdout, /queued 1 pages whose moments changed/);

  // The page is rewritten whole, then verified, and remembers its new moments.
  const again = await run(cwd, ["next", "page"]);
  assert.match(again.stdout, /pipeline next: rewrite content\/topics\/budgets\.md/);
  assert.match(again.stdout, /Rewrite that page whole from index\/topics\/budgets\.md/);
  assert.match(again.stdout, /The page there now was verified: a point you keep keeps its link/);
  page(`${first}\n\nCash envelopes keep spending honest ([2](https://youtube.com/watch?v=bbb&t=300s)).\n\nEnvelopes again ([3](https://youtube.com/watch?v=bbb&t=300s)).\n\nFrom the notes ([4](https://youtube.com/watch?v=bbb&t=280s)).`);
  assert.equal((await run(cwd, ["done", file])).status, 0);
  const check = await run(cwd, ["next", "page"]);
  assert.match(check.stdout, /pipeline next: verify content\/topics\/budgets\.md/);
  assert.match(check.stdout, /Check these links first[^\n]*\n\s+https:\/\/youtube\.com\/watch\?v=bbb&t=300s: "Cash envelopes keep spending honest…", "Envelopes again \(\[3\]\(https:\/\/youtube\.com\/watch\?v=bbb&t=300s\)\)\.…"/);
  assert.doesNotMatch(check.stdout, /v=aaa&t=0s:/, "a link used once is not listed");
  assert.match(check.stdout, /These links are no moment of index\/topics\/budgets\.md, so the writer took them from the notes: https:\/\/youtube\.com\/watch\?v=bbb&t=280s\n/);
  assert.equal((await run(cwd, ["done", file])).status, 0);
  assert.equal(Object.keys(state(cwd).pages[file].moments).length, 4);
  assert.equal((await run(cwd, ["done", file, "--rewrite", "x"])).status, 2, "there is no update to hand back");

  // Grown past the split size: one look before the page, and the next only once it has doubled.
  const many = (n, from = 0) => Array.from({ length: n }, (_, k) => `- 00:${String(Math.floor((k + from) / 6) % 60).padStart(2, "0")}:${String(((k + from) % 6) * 10).padStart(2, "0")} | budgets | Budgets point ${k + from}.`);
  moments("bbb", many(31));
  const big = await run(cwd, ["tick"]);
  assert.match(big.stdout, /1 big topics to sort before any page/);
  const brief = readFileSync(join(cwd, "pipeline/briefs/batch.md"), "utf8");
  assert.match(brief, /## Big enough to split[\s\S]*one point said many ways, or separate questions\?[\s\S]*### budgets\n\n- Talk aaa, 2020-01-02 00:00:00: Budgets are "a dumb rule"\./);
  assert.match(brief, /Budgets point 30\./, "every moment, one a line");
  await run(cwd, ["next", "page"]);
  assert.equal((await run(cwd, ["done", "index/aliases.yaml"])).status, 0);
  assert.match((await run(cwd, ["tick"])).stdout, /queued 1 pages/);
  setState(cwd, (s) => { s.items[`page:${file}`].stage = "done"; });
  moments("bbb", many(40));
  assert.doesNotMatch((await run(cwd, ["tick"])).stdout, /big topics/, "42 is not double 33");
  setState(cwd, (s) => { s.items[`page:${file}`].stage = "done"; });
  moments("bbb", many(70));
  assert.match((await run(cwd, ["tick"])).stdout, /1 big topics to sort/);
});

test("names a tidy made, rebuilding the index itself, are not new to the next batch", async () => {
  const cwd = machine(withVideos("aaa", "bbb"));
  for (const id of ["aaa", "bbb"]) writeDistilled(cwd, id);
  writeMoments(cwd, "aaa");
  await run(cwd, ["queue", "--all", "--confirm"]);
  setState(cwd, (s) => { s.items["youtube:aaa"].stage = "done"; delete s.items["youtube:bbb"]; });
  await run(cwd, ["tick"]);
  writeFileSync(join(cwd, "index/aliases.yaml"), "budgets: money\n");
  assert.equal((await run(cwd, [], {}, "scripts/build-index.mjs")).status, 0);
  writeMoments(cwd, "bbb", goodMoments("bbb").replace("| budgets |", "| envelopes |"));
  assert.match((await run(cwd, ["tick"])).stdout, /1 new topic names/);
  assert.doesNotMatch(readFileSync(join(cwd, "pipeline/briefs/batch.md"), "utf8"), /money/);
});
