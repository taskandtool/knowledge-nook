import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseChannel, renderRaw } from "../scripts/sources.mjs";
import { fakeVendor } from "./fake-scrapecreators.mjs";

const script = fileURLToPath(new URL("../scripts/sources.mjs", import.meta.url));

const run = (cwd, args, env = {}) =>
  new Promise((finish) => {
    // HOME is empty so the machine's own ~/.env never counts.
    const clean = { PATH: process.env.PATH, HOME: cwd, ...env };
    execFile(process.execPath, [script, ...args], { cwd, env: clean, encoding: "utf8", timeout: 60_000 }, (err, stdout, stderr) =>
      finish({ status: err ? err.code : 0, stdout, stderr }),
    );
  });

const folder = () => mkdtempSync(join(tmpdir(), "nook-sources-"));
const gateway = (vendor) => ({ PHOENIX_URL: vendor.url, MACHINE_TOKEN: "machine-token" });
const listed = (id, extra = {}) => ({ type: "video", id, url: `https://www.youtube.com/watch?v=${id}`, title: `Video ${id}`, publishedTime: "2026-10-01T10:00:00.000Z", lengthSeconds: 1800, ...extra });
const captions = (...words) => words.map((text, i) => ({ text, startMs: String(i * 61_000), endMs: String((i + 1) * 61_000), startTimeText: "" }));
const state = (cwd, key = "chan") => JSON.parse(readFileSync(join(cwd, "sources", `${key}.json`), "utf8"));

test("--help and -h print the usage and exit 0, before any network", async () => {
  for (const h of ["--help", "-h"]) {
    const r = await run(folder(), [h]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /usage: node scripts\/sources\.mjs/);
  }
});

for (const [name, args, status] of [
  ["no command", [], 2],
  ["an unknown command", ["crawl-all"], 2],
  ["an unknown flag", ["list", "@chan", "--nope"], 2],
  ["a stray argument", ["list", "@chan", "extra"], 2],
  ["a video URL as a channel", ["list", "https://www.youtube.com/watch?v=abc"], 2],
  ["a bad --max-pages", ["list", "@chan", "--max-pages", "x"], 2],
  ["a fetch with nothing listed", ["fetch"], 1],
  ["a list with no connection", ["list", "@chan"], 1],
]) {
  test(`${name} prints nothing on stdout and a Try line on stderr`, async () => {
    const r = await run(folder(), args);
    assert.equal(r.status, status, r.stderr);
    assert.equal(r.stdout, "");
    assert.match(r.stderr, /Try: /);
  });
}

test("--json, which it does not print, is misuse in plain text", async () => {
  const r = await run(folder(), ["list", "@chan", "--json"]);
  assert.equal(r.status, 2);
  assert.equal(r.stdout, "");
  assert.match(r.stderr, /Try: /);
});

test("a missing connection names the ask", async () => {
  const r = await run(folder(), ["list", "@chan"]);
  assert.match(r.stderr, /request-connection scrapecreators/);
});

test("channels: handles, URLs and ids", () => {
  assert.deepEqual(parseChannel("@ExampleChannel").param, { handle: "ExampleChannel" });
  assert.deepEqual(parseChannel("https://www.youtube.com/@ExampleChannel/videos").param, { handle: "ExampleChannel" });
  const id = "UCaaaaaaaaaaaaaaaaaaaaaa";
  assert.deepEqual(parseChannel(id).param, { channelId: id });
  assert.deepEqual(parseChannel(`https://youtube.com/channel/${id}`).param, { channelId: id });
  assert.deepEqual(parseChannel("@AnotherChannel"), { key: "anotherchannel", param: { handle: "AnotherChannel" } });
  assert.equal(parseChannel("@Chan").key, parseChannel("@chan").key);
  assert.equal(parseChannel("../../etc"), null);
  assert.equal(parseChannel("@.."), null);
  assert.equal(parseChannel("https://youtu.be/abc"), null);
});

test("the raw file: details first, then one numbered line per caption", () => {
  const raw = renderRaw(
    { id: "abc", url: "https://youtube.com/watch?v=abc", title: 'He said "hi"', channel: { title: "Chan" }, published: "2019-03-02", seconds: 3700, language: "English", description: "Guest: Ann Lee", chapters: [{ title: "Start", startSeconds: 0 }, { title: "Later" }] },
    [{ text: "first\nline ", startMs: "160" }, { text: "   " }, { text: "after an hour", startMs: "3672000" }],
  );
  assert.match(raw, /^---\ntitle: "He said \\"hi\\""\nsource: youtube\nid: abc\n/);
  assert.match(raw, /channel: "Chan"\npublished: 2019-03-02\nduration: 01:01:40\n/);
  assert.match(raw, /## Description\n\nGuest: Ann Lee\n/);
  assert.match(raw, /00:00:00 Start\nLater\n/);
  assert.match(raw, /## Transcript\n\nL0001 00:00:00 first line\nL0002 01:01:12 after an hour\n$/);
});

test("the raw file leaves out what the video does not have", () => {
  const raw = renderRaw({ id: "abc", url: "u", title: "T" }, captions("words"));
  for (const absent of ["channel:", "published:", "duration:", "language:", "## Description", "## Chapters"]) assert.ok(!raw.includes(absent), absent);
});

test("list pages through a channel, records it and spends only the listing's credits", async () => {
  const vendor = await fakeVendor({ pages: { chan: [[listed("a"), listed("b")], [listed("c")]] } });
  const cwd = folder();
  const r = await run(cwd, ["list", "@chan"], gateway(vendor));
  await vendor.close();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^sources list: 1 channel, 2 credits spent/);
  assert.match(r.stdout, /chan: 3 videos, 1\.5 hours; 3 new/);
  assert.match(r.stdout, /3 pending, about 6 credits/);
  assert.match(r.stdout, /Next: node scripts\/sources\.mjs fetch chan/);
  assert.deepEqual(state(cwd).videos.map((v) => [v.id, v.state]), [["a", "pending"], ["b", "pending"], ["c", "pending"]]);
  assert.equal(vendor.calls[0].key, "machine-token");
  assert.equal(vendor.calls[0].query.sort, "latest");
  assert.equal(vendor.calls[1].query.continuationToken, "1");
});

test("--max-pages stops early and the next plain list still finishes the walk", async () => {
  const pages = { chan: [[listed("a")], [listed("b")]] };
  const vendor = await fakeVendor({ pages });
  const cwd = folder();
  const first = await run(cwd, ["list", "@chan", "--max-pages", "1"], gateway(vendor));
  assert.match(first.stdout, /more on later pages/);
  assert.equal(state(cwd).complete, false);
  await run(cwd, ["list", "@chan"], gateway(vendor));
  await vendor.close();
  assert.deepEqual(state(cwd).videos.map((v) => v.id), ["a", "b"]);
  assert.equal(state(cwd).complete, true);
});

test("listing again adds what is new, keeps state, flags what has gone, and stops at known pages", async () => {
  const pages = { chan: [[listed("a"), listed("b")], [listed("c")]] };
  const vendor = await fakeVendor({ pages });
  const cwd = folder();
  await run(cwd, ["list", "@chan"], gateway(vendor));
  const before = state(cwd);
  before.videos[0].state = "fetched";
  writeFileSync(join(cwd, "sources", "chan.json"), JSON.stringify(before));

  // New video on the first page: the known second page is still walked, only because page one held something new.
  pages.chan = [[listed("new"), listed("a")], [listed("b")], [listed("c")]];
  vendor.calls.length = 0;
  const again = await run(cwd, ["list", "@chan"], gateway(vendor));
  assert.match(again.stdout, /1 new/);
  assert.equal(vendor.calls.length, 2, "stops at the first page with nothing new");
  assert.deepEqual(state(cwd).videos.map((v) => v.id), ["new", "a", "b", "c"]);
  assert.equal(state(cwd).videos[1].state, "fetched");

  // A full walk that misses one flags it.
  pages.chan = [[listed("new")], [listed("a"), listed("b")]];
  const unflagged = await run(cwd, ["list", "@chan"], gateway(vendor));
  assert.ok(!/gone/.test(unflagged.stdout), "a list that stops early cannot tell");
  const gone = await run(cwd, ["list", "@chan", "--full"], gateway(vendor));
  await vendor.close();
  assert.match(gone.stdout, /1 gone/);
  assert.equal(state(cwd).videos.find((v) => v.id === "c").gone, true);
});

test("a list with no channel relists every known channel", async () => {
  const vendor = await fakeVendor({ pages: { one: [[listed("a")]], two: [[listed("b")]] } });
  const cwd = folder();
  await run(cwd, ["list", "@one"], gateway(vendor));
  await run(cwd, ["list", "@two"], gateway(vendor));
  const r = await run(cwd, ["list"], gateway(vendor));
  await vendor.close();
  assert.match(r.stdout, /^sources list: 2 channels/);
  assert.match(r.stdout, /Next: node scripts\/sources\.mjs fetch\n?$/);
});

test("fetch previews without --confirm and spends nothing", async () => {
  const vendor = await fakeVendor({ pages: { chan: [[listed("a"), listed("b")]] } });
  const cwd = folder();
  await run(cwd, ["list", "@chan"], gateway(vendor));
  vendor.calls.length = 0;
  const r = await run(cwd, ["fetch", "@chan", "--limit", "1"], gateway(vendor));
  await vendor.close();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /would fetch 1 videos, 0\.5 hours, about 2 credits/);
  assert.match(r.stdout, /Nothing was sent\. If the owner asked for it: node scripts\/sources\.mjs fetch chan --limit 1 --confirm/);
  assert.equal(vendor.calls.length, 0);
});

test("fetch writes raw files, skips no-captions at no cost, and a second run pays nothing", async () => {
  const vendor = await fakeVendor({
    pages: { chan: [[listed("a"), listed("none")]] },
    videos: { a: { title: "From details", publishDate: "2019-02-22T03:19:54-08:00", durationMs: 348000, channel: { title: "The Channel" }, description: "Guest: Ann", chapters: [] } },
    transcripts: { a: captions("hello there", "second minute") },
  });
  const cwd = folder();
  await run(cwd, ["list", "@chan"], gateway(vendor));
  const r = await run(cwd, ["fetch", "--confirm"], gateway(vendor));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /1 fetched, 0 already on disk, 1 with no captions, 0 failed; 2 credits spent/);
  const file = join(cwd, "raw/youtube/chan/2019-02-22-a.md");
  const raw = readFileSync(file, "utf8");
  assert.match(raw, /title: "From details"/);
  assert.match(raw, /channel: "The Channel"/);
  assert.match(raw, /L0002 00:01:01 second minute/);
  const after = state(cwd);
  assert.equal(after.title, "The Channel");
  assert.deepEqual(after.videos.map((v) => v.state), ["fetched", "no_captions"]);
  assert.ok(vendor.calls.every((c) => c.path === "/v1/youtube/channel-videos" || c.query.url), "videos go by URL");

  vendor.calls.length = 0;
  const twice = await run(cwd, ["fetch", "--confirm"], gateway(vendor));
  await vendor.close();
  assert.match(twice.stdout, /nothing pending, left alone/);
  assert.match(twice.stdout, /1 fetched, 1 with no captions/);
  assert.equal(vendor.calls.length, 0);
});

test("a file already on disk is adopted without paying again", async () => {
  const vendor = await fakeVendor({ pages: { chan: [[listed("a")]] } });
  const cwd = folder();
  await run(cwd, ["list", "@chan"], gateway(vendor));
  mkdirSync(join(cwd, "raw/youtube/chan"), { recursive: true });
  writeFileSync(join(cwd, "raw/youtube/chan/2020-01-01-a.md"), "kept");
  vendor.calls.length = 0;
  const r = await run(cwd, ["fetch", "--confirm"], gateway(vendor));
  await vendor.close();
  assert.match(r.stdout, /0 fetched, 1 already on disk/);
  assert.equal(vendor.calls.length, 0);
  assert.equal(state(cwd).videos[0].file, "raw/youtube/chan/2020-01-01-a.md");
});

test("a video whose details fail keeps its transcript, dated from the listing", async () => {
  const vendor = await fakeVendor({ pages: { chan: [[listed("a")]] }, transcripts: { a: captions("words") } });
  const cwd = folder();
  await run(cwd, ["list", "@chan"], gateway(vendor));
  const r = await run(cwd, ["fetch", "--confirm"], gateway(vendor));
  await vendor.close();
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(cwd, "raw/youtube/chan/2026-10-01-a.md")));
});

test("one video failing leaves the rest, exits 1 and is tried again next run", async () => {
  let refuseFirst = true;
  const vendor = await fakeVendor({
    pages: { chan: [[listed("a"), listed("b")]] },
    videos: { a: { title: "A" }, b: { title: "B" } },
    transcripts: { a: captions("words"), b: captions("words") },
    status: (path, nth) => {
      if (path === "/v1/youtube/video/transcript" && refuseFirst && nth === 1) return 404;
    },
  });
  const cwd = folder();
  await run(cwd, ["list", "@chan"], gateway(vendor));
  const r = await run(cwd, ["fetch", "--confirm"], gateway(vendor));
  assert.equal(r.status, 1);
  assert.equal(r.stdout, "");
  assert.match(r.stderr, /1 failed/);
  assert.match(r.stderr, /[ab]: ScrapeCreators answered 404/);
  assert.match(r.stderr, /Try: /);
  const first = state(cwd).videos;
  assert.equal(first.filter((v) => v.state === "failed").length, 1);
  assert.equal(first.filter((v) => v.state === "fetched").length, 1, "the rest carried on");

  refuseFirst = false;
  const again = await run(cwd, ["fetch", "--confirm"], gateway(vendor));
  await vendor.close();
  assert.equal(again.status, 0, again.stderr);
  assert.ok(state(cwd).videos.every((v) => v.state === "fetched" && v.error === undefined));
});

test("a 429 backs off and succeeds without the agent doing anything", async () => {
  const vendor = await fakeVendor({
    pages: { chan: [[listed("a")]] },
    status: (path, nth) => (path === "/v1/youtube/channel-videos" && nth === 1 ? 429 : undefined),
  });
  const r = await run(folder(), ["list", "@chan"], gateway(vendor));
  await vendor.close();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(vendor.calls.length, 2);
});

test("out of credits stops the run at once, keeps progress and says what to do", async () => {
  const videos = Array.from({ length: 12 }, (_, i) => listed(`v${i}`));
  const vendor = await fakeVendor({
    pages: { chan: [videos] },
    transcripts: Object.fromEntries(videos.map((v) => [v.id, captions("words")])),
    status: (path, nth) => (path === "/v1/youtube/video/transcript" && nth > 2 ? 402 : undefined),
  });
  const cwd = folder();
  await run(cwd, ["list", "@chan"], gateway(vendor));
  const r = await run(cwd, ["fetch", "--confirm"], gateway(vendor));
  const transcriptCalls = vendor.calls.filter((c) => c.path === "/v1/youtube/video/transcript").length;
  await vendor.close();
  assert.equal(r.status, 1);
  assert.equal(r.stdout, "");
  assert.match(r.stderr, /stopped: ScrapeCreators is out of credits/);
  assert.match(r.stderr, /Try: /);
  assert.ok(transcriptCalls < 12, `kept calling: ${transcriptCalls}`);
  assert.ok(readdirSync(join(cwd, "raw/youtube/chan")).length >= 1, "what it fetched is on disk");
});

test("a gateway refusal names the connection to ask for", async () => {
  const vendor = await fakeVendor({ pages: {}, refuse: "unknown_connection" });
  const r = await run(folder(), ["list", "@chan"], gateway(vendor));
  await vendor.close();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /refused the ScrapeCreators call \(unknown_connection\)/);
  assert.match(r.stderr, /Try: python3 ~\/tools\/taskandtool\.py request-connection scrapecreators/);
});

test("--id fetches only that video; an unknown id is refused", async () => {
  const vendor = await fakeVendor({ pages: { chan: [[listed("a"), listed("b")]] }, videos: { b: { title: "B" } }, transcripts: { b: captions("words") } });
  const cwd = folder();
  await run(cwd, ["list", "@chan"], gateway(vendor));
  const bad = await run(cwd, ["fetch", "--id", "zzz", "--confirm"], gateway(vendor));
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /no video zzz/);
  const r = await run(cwd, ["fetch", "--id", "b", "--confirm"], gateway(vendor));
  await vendor.close();
  assert.match(r.stdout, /1 fetched/);
  assert.deepEqual(state(cwd).videos.map((v) => v.state), ["pending", "fetched"]);
});

test("the transcript call lets the vendor pick the language, so a channel in Spanish is not 'no captions'", async () => {
  const vendor = await fakeVendor({ pages: { chan: [[listed("a")]] }, videos: { a: { title: "A" } }, transcripts: { a: captions("hola") } });
  const cwd = folder();
  await run(cwd, ["list", "@chan"], gateway(vendor));
  await run(cwd, ["fetch", "--confirm"], gateway(vendor));
  await vendor.close();
  assert.equal(vendor.calls.find((c) => c.path === "/v1/youtube/video/transcript").query.language, undefined);
});

test("an empty answer flags nothing as gone", async () => {
  const pages = { chan: [[listed("a"), listed("b")]] };
  const vendor = await fakeVendor({ pages });
  const cwd = folder();
  await run(cwd, ["list", "@chan"], gateway(vendor));
  pages.chan = [[]];
  const r = await run(cwd, ["list", "@chan"], gateway(vendor));
  await vendor.close();
  assert.equal(r.status, 0, r.stderr);
  assert.ok(state(cwd).videos.every((v) => !v.gone));
});

test("a listing that fails midway keeps the pages paid for and flags nothing as gone", async () => {
  const pages = { chan: [[listed("a")], [listed("b")]] };
  const vendor = await fakeVendor({ pages, status: (path, nth) => (nth === 2 ? 402 : undefined) });
  const cwd = folder();
  const r = await run(cwd, ["list", "@chan"], gateway(vendor));
  await vendor.close();
  assert.equal(r.status, 1);
  assert.equal(r.stdout, "");
  assert.match(r.stderr, /out of credits/);
  assert.deepEqual(state(cwd).videos.map((v) => v.id), ["a"]);
  assert.equal(state(cwd).complete, false);
});

test("a channel the vendor cannot find says to check it, not to wait", async () => {
  const vendor = await fakeVendor({ pages: {}, status: () => 404 });
  const r = await run(folder(), ["list", "@nobody"], gateway(vendor));
  await vendor.close();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /answered 404/);
  assert.match(r.stderr, /Try: check the channel on YouTube/);
});

test("a video whose details fail says so", async () => {
  const vendor = await fakeVendor({ pages: { chan: [[listed("a")]] }, transcripts: { a: captions("words") } });
  const cwd = folder();
  await run(cwd, ["list", "@chan"], gateway(vendor));
  const r = await run(cwd, ["fetch", "--confirm"], gateway(vendor));
  await vendor.close();
  assert.match(r.stdout, /a: kept the transcript without its details/);
});

test("a gateway refusal over load or an outage is retried, not treated as no connection", async () => {
  for (const [status, refusal] of [[429, "rate_limited"], [502, "upstream_unreachable"]]) {
    const vendor = await fakeVendor({ pages: { chan: [[listed("a")]] } });
    vendor.refuseOnce = { status, refusal };
    const r = await run(folder(), ["list", "@chan"], gateway(vendor));
    await vendor.close();
    assert.equal(r.status, 0, r.stderr);
    assert.equal(vendor.calls.length, 2, refusal);
  }
});

test("out of credits on the details call keeps the transcript it paid for", async () => {
  const vendor = await fakeVendor({
    pages: { chan: [[listed("a")]] },
    transcripts: { a: captions("words") },
    status: (path) => (path === "/v1/youtube/video" ? 402 : undefined),
  });
  const cwd = folder();
  await run(cwd, ["list", "@chan"], gateway(vendor));
  const r = await run(cwd, ["fetch", "--confirm"], gateway(vendor));
  await vendor.close();
  assert.equal(r.status, 1);
  assert.ok(existsSync(join(cwd, "raw/youtube/chan/2026-10-01-a.md")));
  assert.equal(state(cwd).videos[0].state, "fetched");
  assert.match(r.stderr, /1 fetched/);
});

test("--max-pages on a channel listed in full does not hide what it did not read", async () => {
  const pages = { chan: [[listed("a")]] };
  const vendor = await fakeVendor({ pages });
  const cwd = folder();
  await run(cwd, ["list", "@chan"], gateway(vendor));
  assert.equal(state(cwd).complete, true);
  pages.chan = [[listed("n1")], [listed("n2")], [listed("a")]];
  await run(cwd, ["list", "@chan", "--max-pages", "1"], gateway(vendor));
  assert.equal(state(cwd).complete, false);
  await run(cwd, ["list", "@chan"], gateway(vendor));
  await vendor.close();
  assert.deepEqual(state(cwd).videos.map((v) => v.id), ["n1", "n2", "a"]);
});

test("an empty last page does not flag what comes after it as gone", async () => {
  const pages = { chan: [[listed("a"), listed("b")]] };
  const vendor = await fakeVendor({ pages });
  const cwd = folder();
  await run(cwd, ["list", "@chan"], gateway(vendor));
  pages.chan = [[listed("a")], []];
  await run(cwd, ["list", "@chan", "--full"], gateway(vendor));
  await vendor.close();
  assert.ok(state(cwd).videos.every((v) => !v.gone));
});

test("one channel's problem names it and the others still update", async () => {
  const vendor = await fakeVendor({ pages: { one: [[listed("a")]], two: [[listed("b")]] } });
  const cwd = folder();
  await run(cwd, ["list", "@one"], gateway(vendor));
  await run(cwd, ["list", "@two"], gateway(vendor));
  vendor.failFor = "one";
  const r = await run(cwd, ["list"], gateway(vendor));
  await vendor.close();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /one: ScrapeCreators answered 404/);
  assert.match(r.stderr, /two: 1 videos/);
});

test("a video that fails three times is left alone until named", async () => {
  const vendor = await fakeVendor({ pages: { chan: [[listed("a")]] }, status: (path) => (path === "/v1/youtube/video/transcript" ? 404 : undefined) });
  const cwd = folder();
  await run(cwd, ["list", "@chan"], gateway(vendor));
  for (let i = 0; i < 3; i++) assert.equal((await run(cwd, ["fetch", "--confirm"], gateway(vendor))).status, 1);
  vendor.calls.length = 0;
  const after = await run(cwd, ["fetch", "--confirm"], gateway(vendor));
  assert.equal(after.status, 0, after.stderr);
  assert.match(after.stdout, /1 failed 3 times \(name one with --id to try again\)/);
  assert.equal(vendor.calls.length, 0);
  const named = await run(cwd, ["fetch", "--id", "a", "--confirm"], gateway(vendor));
  await vendor.close();
  assert.equal(named.status, 1);
  assert.equal(vendor.calls.length, 1);
});

test("no captions is tried again while young, at no cost, and not once old", async () => {
  const today = new Date().toISOString();
  const vendor = await fakeVendor({ pages: { chan: [[listed("new", { publishedTime: today }), listed("old", { publishedTime: "2020-01-01T00:00:00.000Z" })]] } });
  const cwd = folder();
  await run(cwd, ["list", "@chan"], gateway(vendor));
  await run(cwd, ["fetch", "--confirm"], gateway(vendor));
  vendor.calls.length = 0;
  await run(cwd, ["fetch", "--confirm"], gateway(vendor));
  await vendor.close();
  assert.deepEqual(vendor.calls.map((c) => c.query.url), [listed("new").url]);
});

test("scope: what is left out stays out, stays recorded, and the language reaches the vendor", async () => {
  const vendor = await fakeVendor({
    pages: { chan: [[listed("keep", { publishedTime: "2024-01-01T00:00:00.000Z" }), listed("old", { publishedTime: "2010-01-01T00:00:00.000Z" }), listed("short", { publishedTime: "2024-01-01T00:00:00.000Z", lengthSeconds: 30 })]] },
    videos: { keep: { title: "Keep" } },
    transcripts: { keep: captions("words") },
  });
  const cwd = folder();
  const r = await run(cwd, ["list", "@chan", "--since", "2020-01-01", "--min-minutes", "5", "--language", "pt-BR"], gateway(vendor));
  assert.match(r.stdout, /2 left out by scope/);
  assert.match(r.stdout, /1 pending, about 2 credits/);
  await run(cwd, ["list", "@chan"], gateway(vendor));
  assert.deepEqual(state(cwd).leave_out, { since: "2020-01-01", min_minutes: 5, language: "pt-BR" });
  const fetched = await run(cwd, ["fetch", "--confirm"], gateway(vendor));
  await vendor.close();
  assert.match(fetched.stdout, /1 fetched/);
  assert.equal(vendor.calls.find((c) => c.path === "/v1/youtube/video/transcript").query.language, "pt-BR");
});

test("bad scope flags are misuse", async () => {
  for (const args of [["--since", "soon"], ["--language", "english!"], ["--min-minutes", "x"]]) {
    const r = await run(folder(), ["list", "@chan", ...args]);
    assert.equal(r.status, 2, args.join(" "));
    assert.match(r.stderr, /Try: /);
  }
});

test("the title and scope survive a relist", async () => {
  const vendor = await fakeVendor({ pages: { chan: [[listed("a")]] }, videos: { a: { title: "A", channel: { title: "The Channel" } } }, transcripts: { a: captions("words") } });
  const cwd = folder();
  await run(cwd, ["list", "@chan", "--min-minutes", "5"], gateway(vendor));
  await run(cwd, ["fetch", "--confirm"], gateway(vendor));
  await run(cwd, ["list", "@chan"], gateway(vendor));
  await vendor.close();
  assert.equal(state(cwd).title, "The Channel");
  assert.equal(state(cwd).leave_out.min_minutes, 5);
});

test("a second fetch waits for a running one; a dead one's lock is taken over", async () => {
  const vendor = await fakeVendor({ pages: { chan: [[listed("a")]] }, videos: { a: { title: "A" } }, transcripts: { a: captions("words") } });
  const cwd = folder();
  await run(cwd, ["list", "@chan"], gateway(vendor));
  writeFileSync(join(cwd, "sources/.fetch.lock"), String(process.pid));
  const busy = await run(cwd, ["fetch", "--confirm"], gateway(vendor));
  assert.equal(busy.status, 1);
  assert.match(busy.stderr, /another list or fetch is running/);
  writeFileSync(join(cwd, "sources/.fetch.lock"), "999999");
  const r = await run(cwd, ["fetch", "--confirm"], gateway(vendor));
  await vendor.close();
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!existsSync(join(cwd, "sources/.fetch.lock")));
});

test("the preview's command keeps every flag", async () => {
  const vendor = await fakeVendor({ pages: { chan: [[listed("a")]] } });
  const cwd = folder();
  await run(cwd, ["list", "@chan"], gateway(vendor));
  const r = await run(cwd, ["fetch", "chan", "--limit", "1", "--max-minutes", "5"], gateway(vendor));
  await vendor.close();
  assert.match(r.stdout, /fetch chan --limit 1 --max-minutes 5 --confirm/);
});

test("an outage stops the run with nothing marked failed", async () => {
  const vendor = await fakeVendor({ pages: { chan: [[listed("a")]] }, status: (path) => (path === "/v1/youtube/video/transcript" ? 503 : undefined) });
  const cwd = folder();
  await run(cwd, ["list", "@chan"], gateway(vendor));
  const r = await run(cwd, ["fetch", "--confirm"], gateway(vendor));
  await vendor.close();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /stopped: ScrapeCreators answered 503, after 4 tries/);
  assert.equal(state(cwd).videos[0].state, "pending");
  assert.equal(state(cwd).videos[0].attempts, undefined);
});

test("the same channel by handle and by id is refused, so nothing is paid for twice", async () => {
  const id = "UCaaaaaaaaaaaaaaaaaaaaaa";
  const vendor = await fakeVendor({ pages: { chan: [[listed("a")]], [id]: [[listed("a")]] } });
  const cwd = folder();
  await run(cwd, ["list", "@chan"], gateway(vendor));
  const r = await run(cwd, ["list", id], gateway(vendor));
  await vendor.close();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /is the channel already listed as chan/);
  assert.ok(!existsSync(join(cwd, `sources/${id}.json`)));
});

test("a list waits for a running fetch", async () => {
  const vendor = await fakeVendor({ pages: { chan: [[listed("a")]] } });
  const cwd = folder();
  await run(cwd, ["list", "@chan"], gateway(vendor));
  writeFileSync(join(cwd, "sources/.fetch.lock"), String(process.pid));
  vendor.calls.length = 0;
  const r = await run(cwd, ["list", "@chan"], gateway(vendor));
  await vendor.close();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /another list or fetch is running/);
  assert.equal(vendor.calls.length, 0, "no credit spent");
});

test("a new caption language reopens videos with no captions", async () => {
  const vendor = await fakeVendor({ pages: { chan: [[listed("a", { publishedTime: "2020-01-01T00:00:00.000Z" })]] } });
  const cwd = folder();
  await run(cwd, ["list", "@chan"], gateway(vendor));
  await run(cwd, ["fetch", "--confirm"], gateway(vendor));
  assert.equal(state(cwd).videos[0].state, "no_captions");
  await run(cwd, ["list", "@chan", "--language", "zh-Hans"], gateway(vendor));
  await vendor.close();
  assert.equal(state(cwd).videos[0].state, "pending");
});

test("a listing's bad date cannot reach a path", async () => {
  const vendor = await fakeVendor({ pages: { chan: [[listed("a", { publishedTime: "../../evil" })]] }, transcripts: { a: captions("words") } });
  const cwd = folder();
  await run(cwd, ["list", "@chan"], gateway(vendor));
  await run(cwd, ["fetch", "--confirm"], gateway(vendor));
  await vendor.close();
  assert.ok(existsSync(join(cwd, "raw/youtube/chan/undated-a.md")));
});

test("a later list marks only what is newer than all it knew as fresh", async () => {
  const vendor = await fakeVendor({ pages: { chan: [[listed("known", { publishedTime: "2026-05-01T00:00:00.000Z" }), listed("older", { publishedTime: "2026-01-01T00:00:00.000Z" })]] } });
  const cwd = folder();
  await run(cwd, ["list", "@chan"], gateway(vendor));
  assert.equal(state(cwd).videos.filter((v) => v.fresh).length, 0, "a first list is all back catalogue");
  await vendor.close();
  const later = await fakeVendor({ pages: { chan: [[listed("newer", { publishedTime: "2026-06-01T00:00:00.000Z" }), listed("backfill", { publishedTime: "2025-01-01T00:00:00.000Z" }), listed("known", { publishedTime: "2026-05-01T00:00:00.000Z" })]] } });
  await run(cwd, ["list", "@chan"], gateway(later));
  const of = (id) => state(cwd).videos.find((v) => v.id === id);
  assert.equal(of("newer").fresh, true);
  assert.equal(of("backfill").fresh, undefined);
  assert.equal(of("known").fresh, undefined);
  await later.close();
});

test("an own key works under either spelling, and goes in ScrapeCreators' key header", async () => {
  for (const name of ["SCRAPECREATORS_API_KEY", "SCRAPE_CREATORS_API_KEY"]) {
    const vendor = await fakeVendor({ pages: { chan: [[listed("aaa")]] } });
    const r = await run(folder(), ["list", "@chan"], { [name]: "own-key", SCRAPECREATORS_BASE_URL: `${vendor.url}/api/machine/gateway/scrapecreators` });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(vendor.calls[0].key, "own-key");
    await vendor.close();
  }
});

