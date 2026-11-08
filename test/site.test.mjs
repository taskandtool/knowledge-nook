import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "node-html-parser";
import { headingsOf, renderWithNotes, safeHref, toHtml } from "../src/markdown.ts";
import { citationsIn, initialsOf, loadSite, parseMoments, parseTopicFile, readSettings, turnsOf } from "../src/load.ts";
import { mapLayout, relationLayout, timelineMarks } from "../src/viz.tsx";
import { decodeEntities, privateRuns, unsafeIn } from "../scripts/check-site.mjs";

const app = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const tsx = app("node_modules/.bin/tsx");

const caption = (n, at, text) => `L${String(n).padStart(4, "0")} ${at} ${text}`;
const raw = (id, title, channel, lines) => `---\ntitle: "${title}"\nsource: youtube\nid: ${id}\nurl: https://www.youtube.com/watch?v=${id}\nchannel: "${channel}"\npublished: 2026-0${id === "aaaaaaaaaaa" ? 1 : 3}-01\nduration: 00:30:00\n---\n\n## Transcript\n\n${lines.join("\n")}\n`;
const LONG_WORDS = Array.from({ length: 60 }, (_, i) => `distinct${i}`).join(" ");
const distilled = (id, title, speakers) => `---\ntitle: "${title}"\nsource: youtube\nurl: https://www.youtube.com/watch?v=${id}\npublished: 2026-0${id === "aaaaaaaaaaa" ? 1 : 3}-01\nspeakers: [${speakers}]\ntopics: []\n---\n\n## 00:01:00 | smoke\n\nNotes that stay private: ${LONG_WORDS}.\n`;
const filler = Array.from({ length: 330 }, (_, i) => `word${i}`).join(" ");
const page = (extra = "") => `---\ntype: topic\ntitle: Smoke control\ndescription: How two pitmasters describe holding a steady fire across a very long cook.\ntopic: smoke\nsources: 2\n---\n\nI say "keep the fire small" ([Pit, Jan 2026](https://www.youtube.com/watch?v=aaaaaaaaaaa&t=60s)). A big fire works too ([Yard, Mar 2026](https://www.youtube.com/watch?v=bbbbbbbbbbb&t=60s)). ${filler}\n\n## Fire\n\nI say "keep the fire small" ([Pit, Jan 2026](https://www.youtube.com/watch?v=aaaaaaaaaaa&t=60s)).\n\n${extra}`;

function fixture(files = {}) {
  const cwd = mkdtempSync(join(tmpdir(), "nook-site-"));
  const all = {
    "SITE.md": "# This site\n\nSite name: Pit Notes\nAddress: https://pit.example\nLanguage: en\nCorrections: fix@pit.example\n\n## What it's about\n\nBarbecue.\n",
    "raw/youtube/pit/2026-01-01-aaaaaaaaaaa.md": raw("aaaaaaaaaaa", "Pit Talk", "Pit", [caption(1, "00:01:00", "you want to keep the fire small always"), caption(2, "00:20:00", LONG_WORDS)]),
    "raw/youtube/yard/2026-03-01-bbbbbbbbbbb.md": raw("bbbbbbbbbbb", "Yard Talk", "Yard", [caption(1, "00:01:00", "a big fire works fine"), caption(2, "00:20:00", "the end")]),
    "distilled/youtube/pit/2026-01-01-aaaaaaaaaaa.md": distilled("aaaaaaaaaaa", "Pit Talk", "Ann"),
    "distilled/youtube/yard/2026-03-01-bbbbbbbbbbb.md": distilled("bbbbbbbbbbb", "Yard Talk", "Bo"),
    "index/topics.md": "# Topics\n\n- smoke: 2 sources, 2 moments\n- rubs: 1 source, 1 moment, under the publish gate\n",
    "index/topics/smoke.md": "# smoke\n\n2 sources, 2 moments.\n\nRelated: rubs, fire\n\n## Pit Talk, 2026-01-01\n\nSource file: distilled/youtube/pit/2026-01-01-aaaaaaaaaaa.md\n\nMoment 00:01:00: A line.\nLink: https://www.youtube.com/watch?v=aaaaaaaaaaa&t=60s\n\nNotes from 00:01:00:\n\nPrivate section text.\n\n## Yard Talk, 2026-03-01\n\nSource file: distilled/youtube/yard/2026-03-01-bbbbbbbbbbb.md\n\nMoment 00:01:00: A line.\nLink: https://www.youtube.com/watch?v=bbbbbbbbbbb&t=60s\n",
    "content/topics/smoke.md": page(),
    ...files,
  };
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(join(cwd, path, ".."), { recursive: true });
    writeFileSync(join(cwd, path), text);
  }
  return cwd;
}
const build = (cwd, env = {}) => spawnSync(tsx, [app("scripts/build.ts")], { cwd, encoding: "utf8", env: { ...process.env, OG_IMAGES: "off", ...env } });
const check = (cwd, cmd = "all") => spawnSync(process.execPath, [app("scripts/check.mjs"), cmd], { cwd, encoding: "utf8" });
const html = (cwd, file) => readFileSync(join(cwd, "dist", file), "utf8");

test("html in markdown renders as text, and only safe links are links", () => {
  const out = toHtml(`<script>alert(1)</script>\n\nHi <img src=x onerror=alert(2)> there\n\n[a](javascript:alert(3)) [b](JaVaScRiPt:alert(4)) [c](data:text/html,x) [d](java\tscript:alert(5)) [e](&#106;avascript:alert(6)) [f](https://ok.example/?a=1&b=2) [g](vbscript:x)\n\n![p](javascript:alert(7))`);
  const root = parse(out);
  assert.equal(root.querySelector("script"), null);
  assert.equal(root.querySelectorAll("img").length, 0);
  const hrefs = root.querySelectorAll("a").map((a) => a.getAttribute("href"));
  assert.deepEqual(hrefs.filter((h) => !h.startsWith("https://ok.example")), []);
  assert.deepEqual(unsafeIn(root, "/x"), []);
  for (const bad of ["javascript:x", " JAVASCRIPT:x", "java\nscript:x", "data:x", "file:///etc"]) assert.equal(safeHref(bad), null, bad);
  for (const good of ["https://a.b/c", "/topics/x", "#fire", "mailto:a@b.c", "tel:+1"]) assert.equal(safeHref(good), good);
});

const finder = (href) => (href.includes("gone") ? null : { path: "/sources/abc", title: "A <Talk>", at: /t=(\d+)/.exec(href) ? Number(/t=(\d+)/.exec(href)[1]) : null, line: "A line." });

test("a citation becomes a small numbered note that goes to our source page at its moment, never YouTube", () => {
  const { html: out, references } = renderWithNotes("Fires stay small ([Pit, Jan](https://www.youtube.com/watch?v=abc&t=60s)) and hot ([A](https://youtu.be/abc?t=90), [B](https://youtu.be/abc?t=120)). Again ([Pit](https://www.youtube.com/watch?v=abc&t=60s)).", finder);
  assert.deepEqual(references.map((r) => [r.n, r.at]), [[1, 60], [2, 90], [3, 120]], "the same moment keeps its number");
  assert.match(out, /Fires stay small<sup class="fn" data-pagefind-ignore><a href="#fn-1" data-fn="1" data-to="\/sources\/abc#t=60"/);
  assert.doesNotMatch(out, /youtube\.com|youtu\.be/);
  assert.doesNotMatch(out, /Pit, Jan/, "the label no longer breaks the read");
  assert.doesNotMatch(out, /\(\s*<sup/, "nor do its brackets");
  assert.match(out, /<\/sup><sup class="fn"/);
});

test("a link that isn't a known source stays an ordinary link, and only safe ones are links", () => {
  const { html: out, references } = renderWithNotes("See [this](https://gone.example/x) and [bad](javascript:alert(1)) and [here](/topics/x).", finder);
  assert.deepEqual(references, []);
  assert.match(out, /<a rel="noopener" href="https:\/\/gone\.example\/x">this<\/a>/);
  assert.doesNotMatch(out, /javascript:/);
  assert.match(out, /<a href="\/topics\/x">here<\/a>/);
});

test("the page's only h1 is its title", () => {
  const out = toHtml("# Title\n\nText");
  assert.equal(parse(out).querySelector("h1"), null);
});

test("SITE.md's lines are read, its comments are not, and defaults hold when it is unfilled", () => {
  const s = readSettings("Site name: A <b>\nAddress: https://a.b/\nPublish gate: 3 sources, 500 words\n\n## What it's about\n\n<!-- the subject -->\nRibs.\n\n## Who it's for\n\n<!-- who -->\n");
  assert.equal(s.name, "A b");
  assert.equal(s.url, "https://a.b");
  assert.equal(s.gateSources, 3);
  assert.equal(s.gateWords, 500);
  assert.equal(s.about, "Ribs.");
  assert.equal(s.audience, "");
  const empty = readSettings("<!-- Site name: Hidden -->\nLanguage: <script>\n");
  assert.equal(empty.name, "Knowledge Nook");
  assert.equal(empty.language, "en");
});

test("a citation carries the quote and sentence it vouches for", () => {
  const [one, two] = citationsIn('He said "go now" first ([A](https://youtu.be/abc?t=5)). Then more. A later point ([B](https://youtu.be/abc?t=9)).', new Map());
  assert.equal(one.sourceKey, "abc");
  assert.deepEqual(one.quotes, ["go now"]);
  assert.deepEqual(two.quotes, []);
  assert.equal(two.claim, "A later point");
  const known = new Map();
  const [a, b] = citationsIn('He won big ([A](https://youtu.be/abc?t=5)) ([B](https://youtu.be/def?t=9)).', known);
  assert.equal(a.claim, "He won big");
  assert.equal(b.claim, "He won big", "a link straight after another vouches for the same words");
  assert.equal(citationsIn('She said “Stop. There is hope.” in June ([A](https://youtu.be/abc?t=5)).', known)[0].claim, "She said “Stop. There is hope.” in June", "a break inside a quote is not a sentence's start");
  assert.equal(citationsIn('First ([A](https://youtu.be/abc?t=5)) and then more ([B](https://youtu.be/abc?t=9)).', known)[1].claim, "…and then more");
});

test("the map holds every topic inside its frame, the strongest first and largest", () => {
  const topic = (name, moments, sources) => ({ name, slug: name, moments, sources, passes: true, latest: "" });
  const groups = [{ name: "One", topics: [topic("a", 50, 3), topic("b", 2, 2)] }, { name: "Two", topics: [topic("c", 2, 2)] }];
  const { tiles, hidden, height } = mapLayout(groups);
  assert.equal(tiles.length, 3);
  assert.equal(hidden, 0);
  assert.ok(height < 300, "a few topics make a short map");
  for (const t of tiles) assert.ok(t.x >= 0 && t.y >= 0 && t.x + t.w <= 1200 && t.y + t.h <= height, JSON.stringify(t));
  const area = (n) => { const t = tiles.find((x) => x.topic.name === n); return t.w * t.h; };
  assert.ok(area("a") > area("b"));
  const many = [{ name: "All", topics: Array.from({ length: 80 }, (_, i) => topic(`t${i}`, 80 - i, 2)) }];
  const cut = mapLayout(many);
  assert.equal(cut.tiles.length, 60);
  assert.equal(cut.hidden, 20);
  assert.equal(cut.height, 470, "and many stop growing");
  assert.ok(cut.tiles.some((t) => t.topic.name === "t0") && !cut.tiles.some((t) => t.topic.name === "t79"));
});

test("a long private run on a page is found; a quote's length is not", () => {
  const secret = Array.from({ length: 50 }, (_, i) => `w${i}`).join(" ");
  assert.equal(privateRuns([{ path: "/a", text: `before ${secret} after` }], [`x ${secret} y`])[0].path, "/a");
  const quote = Array.from({ length: 30 }, (_, i) => `w${i}`).join(" ");
  assert.deepEqual(privateRuns([{ path: "/a", text: `before ${quote} after` }], [secret]), []);
});

test("the site builds from the working folders and passes its checks", () => {
  const cwd = fixture();
  const r = check(cwd);
  assert.equal(r.status, 0, r.stderr);
  for (const f of ["index.html", "topics.html", "topics/smoke.html", "sources/aaaaaaaaaaa.html", "search.html", "new.html", "404.html", "sitemap.xml", "robots.txt", "site.css", "pagefind/pagefind-ui.js"]) assert.ok(existsSync(join(cwd, "dist", f)), f);
  const topic = html(cwd, "topics/smoke.html");
  assert.match(topic, /<title>Smoke control · Pit Notes<\/title>/);
  assert.match(topic, /rel="canonical" href="https:\/\/pit\.example\/topics\/smoke"/);
  assert.match(topic, /"@type":"Article"/);
  assert.doesNotMatch(topic, /noindex/);
  assert.match(topic, /data-pagefind-body/);
  assert.match(topic, /data-pagefind-filter="channel\[content\]" content="Pit"/);
  assert.doesNotMatch(topic, /Who says what/);
  assert.match(topic, /id="fn-1"/);
  assert.match(topic, /data-to="\/sources\/aaaaaaaaaaa#t=60"/);
  assert.doesNotMatch(topic.split("<main")[1].split('id="timeline"')[0], /youtube\.com\/watch/, "the writing never leaves for YouTube");
  assert.match(topic, /Where this comes from/);
  assert.doesNotMatch(topic, /Private section text/);
  assert.doesNotMatch(topic, /Notes that stay private/);
  assert.match(html(cwd, "sitemap.xml"), /<loc>https:\/\/pit\.example\/topics\/smoke<\/loc><lastmod>\d{4}-\d\d-\d\d<\/lastmod>/);
  // A source page with no summary of ours stays out of search, and its private notes stay out.
  const source = html(cwd, "sources/aaaaaaaaaaa.html");
  assert.match(source, /noindex/);
  assert.match(source, /youtube-nocookie\.com\/embed\/aaaaaaaaaaa/);
  assert.doesNotMatch(html(cwd, "sitemap.xml"), /sources\//);
  assert.doesNotMatch(source, /VideoObject/);
});

const momentsFile = `---\ntitle: "Pit Talk"\nurl: https://www.youtube.com/watch?v=aaaaaaaaaaa\nspeakers: [Ann]\n---\n\n## Gist\n\nSmall fires win.\n\n## Strongest\n\n- 00:01:00 Keep the fire small, always.\n\n## Moments\n\n- 00:01:00 | smoke | Keep the fire small, always.\n- 00:20:00 | smoke | A second point.\n`;

test("a source page shows the gist and moments, marks the strongest once, and every timestamp can play here", () => {
  const cwd = fixture({ "moments/youtube/pit/2026-01-01-aaaaaaaaaaa.md": momentsFile });
  const r = check(cwd);
  assert.equal(r.status, 0, r.stderr);
  const source = html(cwd, "sources/aaaaaaaaaaa.html");
  assert.match(source, /Small fires win/);
  assert.equal(source.match(/Keep the fire small/g).length, 5, "large by the video, the list and its short line, a phone's breather, the structured data's clip");
  assert.match(source, /data-moment-now/, "the strongest shows large under the video");
  assert.match(source, /All 2 highlights/);
  assert.match(source, /data-strong=""/);
  assert.match(source, /moment-big[^>]*>Keep the fire small/);
  assert.match(source, /data-seek="60" href="https:\/\/www\.youtube\.com\/watch\?v=aaaaaaaaaaa&amp;t=60s"/);
  assert.match(source, /id="player" data-video="aaaaaaaaaaa"/);
  // Open to search once it has a gist and an open page cites it, with its video data.
  assert.doesNotMatch(source, /noindex/);
  assert.match(source, /"@type":"VideoObject"/);
  assert.match(source, /"@type":"Clip"/);
  assert.match(html(cwd, "sitemap.xml"), /sources\/aaaaaaaaaaa/);
  const list = html(cwd, "sources.html");
  assert.match(list, /Small fires win/, "the others keep a short description");
  assert.doesNotMatch(list, /\d highlights/, "no one needs the count");
  // The newest source, once it has a pick, leads with that one big line and the topics it feeds.
  const led = fixture({ "moments/youtube/yard/2026-03-01-bbbbbbbbbbb.md": momentsFile.replace("Pit Talk", "Yard Talk").replace("aaaaaaaaaaa", "bbbbbbbbbbb") });
  assert.equal(build(led).status, 0);
  const featured = html(led, "sources.html");
  assert.match(featured, /moment-big[^>]*>Keep the fire small/);
  assert.match(featured, /class="filter[^"]*"[^>]*href="\/topics\/smoke"|href="\/topics\/smoke"[^>]*class="filter/);
});

test("a source with moments gets a page even when nothing cites it and it has no notes, and stays out of search", () => {
  const cwd = fixture({
    "raw/youtube/new/2026-05-01-ccccccccccc.md": raw("ccccccccccc", "New Talk", "New", [caption(1, "00:01:00", "a word"), caption(2, "00:30:00", "the end")]),
    "moments/youtube/new/2026-05-01-ccccccccccc.md": "---\ntitle: New Talk\nurl: https://www.youtube.com/watch?v=ccccccccccc\n---\n\n## Moments\n\n- 00:01:00 | x | A word.\n",
  });
  assert.equal(build(cwd).status, 0);
  const source = html(cwd, "sources/ccccccccccc.html");
  assert.match(source, /New Talk/);
  assert.match(source, /noindex/);
  assert.match(html(cwd, "index.html"), /href="\/sources"/);
});

test("a source's moments are held to the check before a deploy, and source text can't run from them", () => {
  const cwd = fixture({ "moments/youtube/pit/2026-01-01-aaaaaaaaaaa.md": momentsFile.replace("A second point.", '"words never said" <script>alert(1)</script>') });
  const r = check(cwd);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /quote isn't in the captions/);
  const safe = fixture({ "moments/youtube/pit/2026-01-01-aaaaaaaaaaa.md": momentsFile.replace("Small fires win", '<img src=x onerror=alert(1)> Small fires win').replace("A second point.", "<b>bold</b> point") });
  assert.equal(build(safe).status, 0);
  const source = html(safe, "sources/aaaaaaaaaaa.html");
  assert.doesNotMatch(source, /<img[^>]*onerror|<b>bold/, "tags come out as plain text");
  const video = parseMoments(momentsFile);
  assert.deepEqual(video.moments.map((m) => [m.at, m.strong]), [[60, true], [1200, false]]);
  assert.equal(video.speakers[0], "Ann");
});

test("the publish gate: one source, too few words or a held page stays out of search, and still builds", () => {
  const oneSource = `---\ntype: topic\ntitle: Rubs\ndescription: How one pitmaster mixes a rub for a long cook and what he leaves out.\ntopic: rubs\n---\n\nAnn likes salt ([Pit, Jan 2026](https://www.youtube.com/watch?v=aaaaaaaaaaa&t=60s)). ${filler}\n`;
  const thin = `---\ntype: guide\ntitle: Thin\ndescription: A short guide that cites two sources but says almost nothing of use at all.\n---\n\nA ([Pit](https://www.youtube.com/watch?v=aaaaaaaaaaa&t=60s)). B ([Yard](https://www.youtube.com/watch?v=bbbbbbbbbbb&t=60s)).\n`;
  const held = page().replace("type: topic", "type: topic\nnoindex: true").replace("Smoke control", "Held page").replace("topic: smoke", "topic: held");
  const cwd = fixture({ "content/topics/rubs.md": oneSource, "content/guides/thin.md": thin, "content/topics/held.md": held });
  assert.equal(build(cwd).status, 0);
  for (const f of ["topics/rubs.html", "guides/thin.html", "topics/held.html"]) {
    assert.match(html(cwd, f), /name="robots" content="noindex"/, f);
    assert.doesNotMatch(html(cwd, f), /rel="canonical"/, f);
  }
  const map = html(cwd, "sitemap.xml");
  assert.match(map, /topics\/smoke/);
  for (const name of ["rubs", "thin", "held"]) assert.doesNotMatch(map, new RegExp(name));
  const gated = fixture({ "SITE.md": "Site name: X\nPublish gate: 3 sources\n" });
  assert.equal(build(gated).status, 0);
  assert.match(html(gated, "topics/smoke.html"), /noindex/, "the owner's gate wins");
});

test("a page's dates hold until its words change", () => {
  const cwd = fixture();
  assert.equal(build(cwd).status, 0);
  const dates = () => JSON.parse(readFileSync(join(cwd, "content/.dates.json"), "utf8"))["content/topics/smoke.md"];
  const first = dates();
  const old = "2020-01-02";
  writeFileSync(join(cwd, "content/.dates.json"), JSON.stringify({ "content/topics/smoke.md": { ...first, first: old, updated: old } }));
  assert.equal(build(cwd).status, 0);
  assert.equal(dates().updated, old, "no change, no new date");
  assert.match(html(cwd, "new.html"), /Jan 2, 2020/);
  writeFileSync(join(cwd, "content/topics/smoke.md"), page("More words ([Pit](https://www.youtube.com/watch?v=aaaaaaaaaaa&t=60s)).\n"));
  assert.equal(build(cwd).status, 0);
  assert.equal(dates().first, old);
  assert.notEqual(dates().updated, old);
  assert.match(html(cwd, "new.html"), /Updated topic/);
});

test("before any pages the site still builds and says so", () => {
  const cwd = mkdtempSync(join(tmpdir(), "nook-site-"));
  assert.equal(build(cwd).status, 0);
  assert.match(html(cwd, "index.html"), /Nothing here yet/);
  assert.match(html(cwd, "search.html"), /Search/);
});

test("a build that fails leaves the last dist/ alone", () => {
  const cwd = fixture();
  assert.equal(build(cwd).status, 0);
  const before = html(cwd, "index.html");
  writeFileSync(join(cwd, "content/.dates.json"), "not json");
  const r = build(cwd);
  assert.notEqual(r.status, 0);
  assert.equal(html(cwd, "index.html"), before);
});

// Each breaks dist/ the way a bug would, and `check site` must say so.
const breaks = {
  "a broken link": [(t) => t.replace("</article>", '<a href="/topics/gone">x</a></article>'), /broken link to \/topics\/gone/],
  "a broken anchor": [(t) => t.replace("</article>", '<a href="/topics/smoke#gone">x</a></article>'), /broken anchor/],
  "a script": [(t) => t.replace("</article>", "<script>alert(1)</script></article>"), /a script/],
  "an onerror": [(t) => t.replace("</article>", '<img src="/x.png" onerror="alert(1)"></article>'), /onerror attribute/],
  "a javascript link": [(t) => t.replace("</article>", '<a href="javascript:alert(1)">x</a></article>'), /scheme javascript/],
  "a foreign iframe": [(t) => t.replace("</article>", '<iframe src="https://evil.example/"></iframe></article>'), /iframe from/],
  "no description": [(t) => t.replace(/<meta name="description"[^>]*>/, ""), /no description/],
  "no title": [(t) => t.replace(/<title>.*?<\/title>/, ""), /no <title>/],
  "two h1s": [(t) => t.replace("</article>", "<h1>Again</h1></article>"), /2 h1 headings/],
  "no canonical": [(t) => t.replace(/<link rel="canonical"[^>]*>/, ""), /no canonical/],
  "bad structured data": [(t) => t.replace('type="application/ld+json">', 'type="application/ld+json">{'), /not valid JSON/],
  "rating markup": [(t) => t.replace("</head>", '<script type="application/ld+json">{"@type":"AggregateRating"}</script></head>'), /review or rating/],
  "transcript text": [(t) => t.replace("</article>", `<p>${LONG_WORDS}</p></article>`), /words in a row from a private file/],
  "a held page in the sitemap": [(t) => t.replace("<head>", '<head><meta name="robots" content="noindex">'), /held out of search/],
};
for (const [name, [mutate, expected]] of Object.entries(breaks)) {
  test(`check site refuses ${name}`, () => {
    const cwd = fixture();
    assert.equal(build(cwd).status, 0);
    assert.equal(check(cwd, "site").status, 0);
    const file = join(cwd, "dist/topics/smoke.html");
    const before = readFileSync(file, "utf8");
    const after = mutate(before);
    assert.notEqual(after, before, "the mutation applied");
    writeFileSync(file, after);
    const r = check(cwd, "site");
    assert.equal(r.status, 1);
    assert.equal(r.stdout, "");
    assert.match(r.stderr, expected);
    assert.match(r.stderr, /Try: /);
  });
}

test("check site refuses a sitemap that drifts, an orphan and a markdown file", () => {
  const cwd = fixture();
  assert.equal(build(cwd).status, 0);
  writeFileSync(join(cwd, "dist/sitemap.xml"), readFileSync(join(cwd, "dist/sitemap.xml"), "utf8").replace("</urlset>", "<url><loc>https://pit.example/topics/gone</loc></url></urlset>"));
  writeFileSync(join(cwd, "dist/leak.md"), "x");
  const orphan = html(cwd, "new.html").replace(/What's new/g, "Orphan");
  mkdirSync(join(cwd, "dist/guides"), { recursive: true });
  writeFileSync(join(cwd, "dist/guides/orphan.html"), orphan);
  const r = check(cwd, "site");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /lists \/topics\/gone, which was not built/);
  assert.match(r.stderr, /leak\.md: a markdown file/);
  assert.match(r.stderr, /\/guides\/orphan: nothing links to it/);
  assert.match(r.stderr, /\/guides\/orphan: open to search but not in sitemap/);
});

test("check all reports a page's quote and a site problem together, and a clean page passes", () => {
  const cwd = fixture({ "content/topics/smoke.md": page('He also said "words nobody ever said aloud" ([Pit](https://www.youtube.com/watch?v=aaaaaaaaaaa&t=60s)). [x](/topics/gone).\n') });
  const r = check(cwd);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /quote not in raw/);
  assert.match(r.stderr, /broken link to \/topics\/gone/);
});

test("an apostrophe cannot hide copied private text, and a quote-free run of ours can't be mistaken for it", () => {
  const secret = Array.from({ length: 60 }, (_, i) => (i % 8 ? `w${i}` : `it's${i}`)).join(" ");
  const shown = secret.replace(/'/g, "&#39;");
  assert.equal(privateRuns([{ path: "/a", text: decodeEntities(shown) }], [secret])[0]?.path, "/a");
  const cwd = fixture();
  assert.equal(build(cwd).status, 0);
  writeFileSync(join(cwd, "raw/youtube/pit/2026-01-01-aaaaaaaaaaa.md"), `---\ntitle: x\n---\n\n${secret}\n`);
  const file = join(cwd, "dist/topics/smoke.html");
  writeFileSync(file, readFileSync(file, "utf8").replace("</article>", `<p>${shown}</p></article>`));
  assert.match(check(cwd, "site").stderr, /words in a row from a private file/);
});

test("a line in a private section is never read as related topics", () => {
  const { related } = parseTopicFile("# x\n\n2 sources.\n\n## T, 2020\n\nSource file: a.md\n\nRelated: secret note\n", () => "k");
  assert.deepEqual(related, []);
});

test("a page whose front matter doesn't parse is refused, not silently left out", () => {
  const cwd = fixture({ "content/topics/ribs.md": page().replace("title: Smoke control", "title: Ribs: low and slow") });
  const r = check(cwd, "pages");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /does not parse, so the page would not be built/);
});

test("a heading's anchor and its contents line agree, with any punctuation", () => {
  const body = "## What's the rule\n\nx\n\n## Salt & pepper\n\ny\n\n## See [this](https://a.b/c?t=5) now\n\nz";
  const ids = [...toHtml(body).matchAll(/<h2 id="([^"]+)"/g)].map((m) => m[1].replace(/&#39;/g, "'"));
  assert.deepEqual(headingsOf(body).map((h) => h.id), ids);
  const cwd = fixture({ "content/topics/smoke.md": page('## What\'s the rule\n\nI say "keep the fire small" ([Pit](https://www.youtube.com/watch?v=aaaaaaaaaaa&t=60s)).\n') });
  const r = check(cwd);
  assert.equal(r.status, 0, r.stderr);
});

test("the checks read a title's words as words: 'Code Review' is not rating markup, and listings have long enough descriptions", () => {
  const cwd = fixture({
    "content/topics/smoke.md": page().replace("Smoke control", "Code Review basics").replace("sources: 2", "sources: 2\nrelated: [ann]"),
    "content/speakers/ann.md": page().replace("type: topic", "type: speaker").replace("Smoke control", "Ann").replace("topic: smoke", "topic: ann-only"),
  });
  const r = check(cwd);
  assert.equal(r.status, 0, r.stderr);
});

test("a source page is not a link that keeps a page from being an orphan", () => {
  const cwd = fixture();
  assert.equal(build(cwd).status, 0);
  const other = html(cwd, "topics/smoke.html").replace(/Smoke control/g, "Lonely");
  writeFileSync(join(cwd, "dist/topics/lonely.html"), other);
  const file = join(cwd, "dist/sources/aaaaaaaaaaa.html");
  writeFileSync(file, readFileSync(file, "utf8").replace("</article>", '<a href="/topics/lonely">x</a></article>'));
  assert.match(check(cwd, "site").stderr, /\/topics\/lonely: nothing links to it/);
});

test("a topic's timeline is its own, whatever its name; only YouTube embeds, only safe source links, valid sitemap, no crash on a bad link", () => {
  const cppFile = "# c++\n\n2 sources.\n\n## Pit Talk, 2026-01-01, 00:01:00\n\nSource file: distilled/youtube/pit/2026-01-01-aaaaaaaaaaa.md\nLink: https://www.youtube.com/watch?v=aaaaaaaaaaa&t=60s\n\nx\n\n## Yard Talk, 2026-03-01, 00:01:00\n\nSource file: distilled/youtube/yard/2026-03-01-bbbbbbbbbbb.md\nLink: https://www.youtube.com/watch?v=bbbbbbbbbbb&t=60s\n\ny\n";
  const webRaw = '---\nurl: "https://blog.example/post?v=abcdefgh"\ntitle: "Blog"\n---\n\nsaid here\n';
  const webDistilled = '---\ntitle: "Blog"\nsource: web\nurl: https://blog.example/post?v=abcdefgh\ntopics: []\n---\n\n## Top | smoke\n\nnotes\n';
  const badRaw = '---\nurl: "javascript:alert(1)"\ntitle: "Bad"\n---\n\nsaid\n';
  const cwd = fixture({
    "index/topics/c-plus-plus.md": cppFile,
    "index/topics/c.md": "# c\n\n1 source.\n",
    "content/topics/cpp.md": page().replace("Smoke control", "C plus").replace("topic: smoke", "topic: c++"),
    "content/topics/r&d.md": page().replace("Smoke control", "Research").replace("topic: smoke", "topic: research"),
    "raw/web/blog.example/pages/post.md": webRaw,
    "distilled/web/blog.example/pages/post.md": webDistilled,
    "raw/web/bad.example/pages/x.md": badRaw,
    "distilled/web/bad.example/pages/x.md": '---\ntitle: "Bad"\nsource: web\nurl: javascript:alert(1)\ntopics: []\n---\n\n## Top | smoke\n\nnotes\n',
    "content/sources/web-blog-example-pages-post.md": "A post.\n",
    "content/guides/cites-blog.md": page().replace("type: topic", "type: guide").replace("Smoke control", "Cites blog").replace("topic: smoke", "topic: blog-only").replace("## Fire", "Blog says so ([Blog](https://blog.example/post?v=abcdefgh)). Bad ([Bad](javascript:alert(1))).\n\n## Fire"),
  });
  assert.equal(build(cwd).status, 0);
  assert.equal(loadSite(cwd).entriesOf("c-plus-plus").length, 2, "c++ reads its own file, not c's");
  const blog = html(cwd, "sources/web-blog-example-pages-post.html");
  assert.doesNotMatch(blog, /youtube-nocookie/);
  assert.match(blog, /Read the original/);
  assert.match(html(cwd, "sitemap.xml"), /r&amp;d/);
  assert.doesNotMatch(html(cwd, "sitemap.xml"), /r&d/);
  const site = check(cwd, "site");
  assert.doesNotMatch(site.stderr, /not built/);
  const broken = fixture();
  assert.equal(build(broken).status, 0);
  const file = join(broken, "dist/topics/smoke.html");
  writeFileSync(file, readFileSync(file, "utf8").replace("</article>", '<a href="/a%zz">x</a></article>'));
  const r = check(broken, "site");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /broken link to \/a%zz/);
  assert.doesNotMatch(r.stderr, /URIError/);
});

test("the check says where a quote was really said, and holds links within 4 minutes", () => {
  const cwd = fixture({ "content/topics/smoke.md": page('Later "distinct30 distinct31 distinct32" ([Pit](https://www.youtube.com/watch?v=aaaaaaaaaaa&t=60s)).\n') });
  const r = check(cwd, "pages");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /it was said at t=1200s; link there/);
  const nearest = fixture({
    "raw/youtube/pit/2026-01-01-aaaaaaaaaaa.md": raw("aaaaaaaaaaa", "Pit Talk", "Pit", [caption(1, "00:00:30", "it cost 77 dollars"), caption(2, "00:01:00", "you want to keep the fire small always"), caption(3, "00:10:00", "a long stretch"), caption(4, "00:20:00", "and it cost 77 dollars again"), caption(5, "00:30:00", "the end")]),
    "content/topics/smoke.md": page('It cost 77 ([Pit](https://www.youtube.com/watch?v=aaaaaaaaaaa&t=1600s)).\n'),
  });
  assert.match(check(nearest, "pages").stderr, /77 is not near 1600s in that video; it was said at t=1200s; link there/, "the mention nearest the link, not the first");
});

const written = (title, topic = title.toLowerCase()) => page().replace("Smoke control", title).replace("topic: smoke", `topic: ${topic}`);

test("if a reader can see a topic they can open it: nothing unwritten shows anywhere", () => {
  const cwd = fixture({ "content/topics/rubs.md": written("Rubs"), "content/topics/fire.md": written("Fire") });
  assert.equal(build(cwd).status, 0);
  const topic = html(cwd, "topics/smoke.html");
  const graph = topic.split('id="nearby"')[1].split("</section>")[0];
  assert.match(graph, /<a [^>]*href="\/topics\/rubs"/);
  assert.match(graph, /<a [^>]*href="\/topics\/fire"/);
  const near = fixture({ "content/topics/rubs.md": written("Rubs") });
  assert.equal(build(near).status, 0);
  const lone = html(near, "topics/smoke.html");
  assert.doesNotMatch(lone, /id="nearby"/, "one neighbour is no grid");
  assert.doesNotMatch(lone, /href="#nearby"/, "and the contents don't offer it");
  assert.doesNotMatch(lone, />fire</, "an unwritten name never shows");
  assert.doesNotMatch(html(near, "topics.html"), /Not written yet|rubs,/i);
});

test("the map waits for three written topics, shows only those by their titles, and says sources", () => {
  const two = fixture({ "content/topics/rubs.md": written("Rubs") });
  assert.equal(build(two).status, 0);
  assert.doesNotMatch(html(two, "topics.html"), /Topic map/, "two tiles are not a map");
  const cwd = fixture({
    "index/topics.md": "# Topics\n\n- smoke: 2 sources, 2 moments\n- rubs: 2 sources, 2 moments\n- fire: 2 sources, 2 moments\n- waiting topic: 2 sources, 9 moments\n",
    "content/topics/rubs.md": written("Rubs"), "content/topics/fire.md": written("Fire"),
  });
  assert.equal(build(cwd).status, 0);
  const list = html(cwd, "topics.html");
  assert.match(list, /aria-label="Topic map"/);
  assert.match(list, /<a class="tile" href="\/topics\/rubs"/);
  assert.doesNotMatch(list, /waiting topic|passages|sections|tile quiet/);
  const home = html(cwd, "index.html");
  assert.doesNotMatch(home, /waiting topic|Topic map/);
  assert.match(home, /Newest sources[^]*href="\/sources\/bbbbbbbbbbb"[^]*Yard Talk/, "real sources, newest first");
});

test("the home page says what the site is, once, with search in reach, real pictures and what connects to what", () => {
  const rubs = "# rubs\n\n1 source.\n\n## Pit Talk, 2026-01-01, 00:01:00\n\nSource file: distilled/youtube/pit/2026-01-01-aaaaaaaaaaa.md\nLink: https://www.youtube.com/watch?v=aaaaaaaaaaa&t=60s\n\nx\n";
  const cwd = fixture({ "content/topics/rubs.md": written("Rubs"), "index/topics/rubs.md": rubs, "moments/youtube/pit/2026-01-01-aaaaaaaaaaa.md": momentsFile });
  assert.equal(build(cwd).status, 0);
  const home = html(cwd, "index.html");
  assert.match(home, /<h1[^>]*>Barbecue\.<\/h1>/, "what it's about is the headline");
  assert.equal((home.split("<main")[1].split("</main>")[0].match(/data-palette-open/g) ?? []).length, 0, "search lives in the header");
  assert.equal((home.split("<main")[0].match(/data-palette-open/g) ?? []).length, 1, "as on every page");
  assert.match(home, /data-relations/);
  assert.match(home, /data-node="t0"[^]*data-node="v0"/);
  assert.match(home, /<path data-t="\d+" data-v="\d+"/);
  assert.match(home, /i\.ytimg\.com\/vi\/aaaaaaaaaaa\/hqdefault\.jpg/);
  assert.match(home, /data-hero[= ]/);
  assert.match(home, /logo-mark[^>]*>PN</, "the site's initials");
  const topic = html(cwd, "topics/smoke.html");
  assert.match(topic.split("<main")[0], /data-palette-open/, "every other page keeps it");
  assert.match(topic, /href="\/topics"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/topics"/, "the nav knows where you are");
  assert.match(html(cwd, "favicon.svg"), />PN<\/text>/);
  assert.match(topic, /property="og:image" content="https:\/\/i\.ytimg\.com\/vi\/[\w-]+\/hqdefault\.jpg"/, "a share shows a real picture");
  assert.match(html(cwd, "sources/aaaaaaaaaaa.html"), /property="og:image" content="https:\/\/i\.ytimg\.com\/vi\/aaaaaaaaaaa\/hqdefault\.jpg"/);
  assert.doesNotMatch(home.split("data-hero")[1].split("</a>")[0], /data-hero-stamp|data-hero-title/, "nothing competes with the line");
});

test("the three lists: a topic map in colour, sources with a lead and a channel filter, and what's new with videos in it", () => {
  const cwd = fixture({
    "index/topics.md": "# Topics\n\n- smoke: 2 sources, 2 moments\n- rubs: 2 sources, 2 moments\n- fire: 2 sources, 2 moments\n",
    "content/topics/rubs.md": written("Rubs"), "content/topics/fire.md": written("Fire"), "moments/youtube/pit/2026-01-01-aaaaaaaaaaa.md": momentsFile,
  });
  assert.equal(build(cwd).status, 0);
  const topics = html(cwd, "topics.html");
  assert.match(topics, /tile-picture[^>]*src="https:\/\/i\.ytimg\.com\/vi\/[\w-]+\/hqdefault\.jpg"/);
  assert.match(topics, /Every topic/);
  assert.match(topics, /data-palette-scope="Topic"/, "its search looks only at topics");
  const sources = html(cwd, "sources.html");
  assert.match(sources, /data-filter="Pit"/);
  assert.match(sources, /data-channel="Pit"/);
  assert.match(sources, /class="[^"]*\bhidden\b[^"]*"[^>]*data-filters/, "no filter shows without the script that runs it");
  const fresh = html(cwd, "new.html");
  assert.match(fresh, />Video</);
  assert.match(fresh, />Topic</);
  assert.doesNotMatch(fresh, /New (video|topic)/, "what's new is already new");
  assert.ok(fresh.indexOf(">Topic<") < fresh.indexOf(">Video<"), "newest first");
});

test("a topic's search looks only at topics, and starts by offering them all", async () => {
  const { matchLocal, startGroups } = await import("../static/site.js");
  const data = { items: [{ type: "Topic", title: "Smoke", path: "/topics/smoke" }, { type: "Topic", title: "Rubs", path: "/topics/rubs" }, { type: "Source", title: "Smoke talk", path: "/sources/a" }], moments: [{ text: "Smoke low", source: "Pit", path: "/sources/a#t=1", at: "0:01" }] };
  assert.deepEqual(matchLocal(data, "smoke", "Topic").map((i) => i.title), ["Smoke"]);
  assert.equal(matchLocal(data, "smoke").length, 3, "everywhere else, everything");
  assert.deepEqual(startGroups(data, "Topic").map((g) => [g.label, g.items.length]), [["Topics", 2]]);
});

test("a share image is a real picture of the right size, from a video's picture", async () => {
  const { renderShareImage, writeShareImages } = await import("../src/og.ts");
  const dot = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==", "base64");
  const png = await renderShareImage({ title: "Smoke control", siteName: "Pit Notes", picture: dot });
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
  const cwd = fixture({ "content/topics/rubs.md": written("Rubs") });
  const before = process.cwd();
  process.chdir(cwd);
  try {
    const site = loadSite(cwd);
    const asked = [];
    const made = await writeShareImages(site, join(cwd, "out"), async (url) => { asked.push(url); return url.includes("maxres") ? new Response("no", { status: 404 }) : new Response(dot); });
    assert.ok(made.has("/topics/smoke"));
    assert.ok(existsSync(join(cwd, "out/og/topics/smoke.png")));
    assert.ok(asked.some((u) => u.includes("hqdefault")), "falls back when YouTube has no large one");
    const silent = await writeShareImages({ ...site, pages: site.pages.map((p) => ({ ...p, title: "日本語" })) }, join(cwd, "out2"), async () => new Response(dot));
    assert.equal(silent.size, 0, "a title the font can't draw keeps the video's own picture");
  } finally {
    process.chdir(before);
  }
});

test("the lines cross as little as they can, on rows that fit both sides", () => {
  const links = [{ t: 0, v: 1 }, { t: 1, v: 0 }, { t: 2, v: 2 }];
  const { height, topicY, videoY } = relationLayout(3, 3, links);
  assert.ok(height >= 3 * 56);
  for (const a of links) for (const b of links) {
    if (a === b) continue;
    assert.equal(Math.sign(topicY.get(a.t) - topicY.get(b.t)), Math.sign(videoY.get(a.v) - videoY.get(b.v)), "untangled");
  }
  assert.equal(relationLayout(40, 2, []).height, 40 * 56, "the taller side sets the height");
});

test("the contents list everything the page has", () => {
  const cwd = fixture({ "content/topics/rubs.md": written("Rubs"), "content/topics/fire.md": written("Fire") });
  assert.equal(build(cwd).status, 0);
  const topic = html(cwd, "topics/smoke.html");
  assert.match(topic, /data-scrollspy/);
  for (const id of ["fire", "nearby", "references"]) {
    assert.match(topic, new RegExp(`href="#${id}"`), id);
    assert.match(topic, new RegExp(`id="${id}"`), id);
  }
});

test("red means a citation: the footnote marks and the chart's dots; a timestamp is quiet until hovered", () => {
  const cwd = fixture({ "content/topics/rubs.md": written("Rubs"), "content/topics/fire.md": written("Fire") });
  assert.equal(build(cwd).status, 0);
  const topic = html(cwd, "topics/smoke.html");
  assert.match(topic, /sup class="fn"/);
  assert.match(topic, /font-mono text-ink-3 no-underline hover:text-accent[^>]*data-note-time/);
  assert.doesNotMatch(topic, /font-mono text-accent/);
  assert.doesNotMatch(html(cwd, "index.html").split("<main")[1], /class="text-accent/);
});

test("a written page has one section for where it comes from: each video once, with its cited points and a dot that goes to it", () => {
  const cwd = fixture({ "content/topics/rubs.md": written("Rubs"), "content/topics/fire.md": written("Fire") });
  assert.equal(build(cwd).status, 0);
  const topic = html(cwd, "topics/smoke.html");
  assert.doesNotMatch(topic, /When it was said/);
  const section = topic.split('id="references"')[1];
  const titles = section.match(/data-group-title[^>]*>[^<]+/g) ?? [];
  assert.ok(titles.length > 0);
  assert.equal(titles.length, new Set(titles).size, "a video once");
  assert.ok(topic.indexOf('id="timeline"') < 0 || topic.indexOf('id="references"') < topic.indexOf('id="timeline"'), "the chart sits inside the section");
  assert.match(section, /id="fn-1"[^>]*data-video="aaaaaaaaaaa"/);
  assert.match(section, /https:\/\/i\.ytimg\.com\/vi\/aaaaaaaaaaa\/hqdefault\.jpg/);
});

test("beside the writing: a picture of the video being cited, a link that works with no script, and the contents in the line's place", () => {
  const cwd = fixture({ "content/topics/rubs.md": written("Rubs"), "content/topics/fire.md": written("Fire") });
  assert.equal(build(cwd).status, 0);
  const rail = html(cwd, "topics/smoke.html").split("data-rail-frame")[1].split("</aside>")[0];
  assert.match(rail, /data-rail-play/);
  assert.match(rail, /href="\/sources\/aaaaaaaaaaa#t=60"/, "with no script it goes to our page, at that second");
  assert.doesNotMatch(rail, /<iframe/, "no player until it's asked for");
  assert.match(rail, /data-swap/);
  assert.match(rail, /On this page/);
});

test("each dot gets a date; close ones share two rows, and one that fits nowhere stays in the list below", () => {
  const texts = (dates) => timelineMarks(dates).map((m) => m.text);
  assert.deepEqual(texts(["2026-06-24", "2026-08-04", "2026-08-09"]), ["Jun 24", "Aug 4", "Aug 9"]);
  const edges = timelineMarks(["2026-06-24", "2026-08-04", "2026-08-09"]);
  assert.equal(edges[0].align, "start", "the first label stays inside the frame");
  assert.equal(edges[2].align, "end", "and so does the last");
  const close = timelineMarks(["2026-01-01", "2026-06-01", "2026-06-10", "2026-12-31"]);
  assert.notEqual(close[1].row, close[2].row, "close neighbours never share a row");
  assert.deepEqual(texts(["2024-01-01", "2026-01-01"]), ["Jan 2024", "Jan 2026"], "the year shows across years");
  const crowded = timelineMarks(["2026-01-01", "2026-01-02", "2026-01-03", "2026-12-31"]);
  assert.deepEqual(crowded.map((m) => !!m.text), [true, true, false, true]);
  assert.equal(timelineMarks(["2026-01-01", "2026-01-01"]).length, 2, "one date twice does not break it");
});

test("the command center's parts: instant matches, kinds in order, clean addresses, safe text, wrapping keys", async () => {
  const { cleanUrl, markTerms, matchLocal, mergeResults, moveSelection, safeExcerpt, seekUrl, startGroups } = await import("../static/site.js");
  assert.equal(seekUrl("abc", 60), "https://www.youtube-nocookie.com/embed/abc?start=60&autoplay=1");
  assert.equal(cleanUrl("/topics/x.html"), "/topics/x");
  assert.equal(cleanUrl("/topics/x.html#fire"), "/topics/x#fire");
  assert.equal(cleanUrl("/a.html/b"), "/a.html/b");
  const data = {
    try: ["Lighthouse"],
    items: [{ type: "Topic", title: "Robotics and work", path: "/topics/r", note: "2 sources" }, { type: "Topic", title: "Lighthouse", path: "/topics/a", note: "" }, { type: "Guide", title: "How to read Lighthouse", path: "/guides/a", note: "" }, { type: "Source", title: "A talk", path: "/sources/x", note: "Pit" }],
    moments: [{ text: "Lighthouse may pay for itself", path: "/sources/x#t=60", source: "Pit", at: "1:00" }],
  };
  assert.deepEqual(matchLocal(data, "lighthouse").map((i) => i.path), ["/topics/a", "/guides/a", "/sources/x#t=60"], "a title that starts with it ranks first, moments follow");
  assert.deepEqual(matchLocal(data, "read lighthouse").map((i) => i.path), ["/guides/a"], "every word must match");
  assert.deepEqual(matchLocal(data, "pit").map((i) => i.type), ["Source", "Moment"], "the channel counts");
  assert.deepEqual(matchLocal(data, "  "), []);
  const groups = mergeResults(matchLocal(data, "lighthouse"), [{ url: "/topics/a.html", meta: { title: "Lighthouse" }, filters: { type: ["Topic"] }, excerpt: "x" }, { url: "/sources/y.html", meta: { title: "Deep cut" }, filters: { type: ["Source"] }, excerpt: "<mark>lighthouse</mark> line" }]);
  assert.deepEqual(groups.map((g) => g.label), ["Topics", "Guides", "Sources", "Highlights"]);
  assert.equal(groups[0].items.length, 1, "full search doesn't repeat an instant match");
  assert.equal(groups[2].items[0].path, "/sources/y", "and adds what titles can't find");
  const many = mergeResults(Array.from({ length: 9 }, (_, i) => ({ type: "Topic", title: `t${i}`, path: `/t${i}` })), []);
  assert.equal(many[0].items.length, 5, "each kind stays short");
  assert.deepEqual(startGroups(data).map((g) => g.label), ["Topics", "Guides", "Newest sources", "Highlights"]);
  assert.deepEqual(startGroups({ items: [] }), [], "an empty site offers nothing broken");
  assert.equal(markTerms("Lighthouse <b>x</b>", "lighthouse"), "<mark>Lighthouse</mark> &lt;b&gt;x&lt;/b&gt;");
  assert.equal(markTerms("a.b", "a."), "<mark>a</mark>.b", "typed punctuation can't break the match");
  assert.equal(safeExcerpt("a <mark>fire</mark> &lt;img src=x onerror=alert(1)&gt; <script>x</script>"), "a <mark>fire</mark> &lt;img src=x onerror=alert(1)&gt; &lt;script&gt;x&lt;/script&gt;");
  assert.equal(safeExcerpt("surfaced . Start"), "surfaced. Start", "a citation left out leaves no gap");
  assert.equal(moveSelection(2, 1, 3), 0);
  assert.equal(moveSelection(0, -1, 3), 2);
  assert.equal(moveSelection(-1, 1, 0), -1);
});

test("the site builds what the command center loads: titles and strongest moments, never a note's words", () => {
  const cwd = fixture({ "moments/youtube/pit/2026-01-01-aaaaaaaaaaa.md": momentsFile });
  assert.equal(build(cwd).status, 0);
  const data = JSON.parse(html(cwd, "palette.json"));
  assert.ok(data.items.some((i) => i.type === "Topic" && i.title === "Smoke control" && i.path === "/topics/smoke"));
  assert.ok(data.items.some((i) => i.type === "Source" && i.path === "/sources/aaaaaaaaaaa"));
  assert.deepEqual(data.moments.map((m) => m.path), ["/sources/aaaaaaaaaaa#t=60"], "only the strongest, each going to its second");
  assert.equal(data.moments[0].at, "1:00");
  assert.equal(data.try, undefined, "the topics below already say what to look for");
  assert.match(data.items.find((i) => i.type === "Source" && i.path === "/sources/aaaaaaaaaaa").thumb, /i\.ytimg\.com\/vi\/aaaaaaaaaaa\/mqdefault\.jpg/);
  assert.doesNotMatch(data.items.find((i) => i.type === "Source").note, /\d{4}-\d\d-\d\d/, "a date a person reads");
  assert.doesNotMatch(JSON.stringify(data), /Notes that stay private|Private section text|A second point/);
  assert.match(html(cwd, "index.html"), /data-palette-open/);
});

test("check site still refuses a script from anywhere else", () => {
  const cwd = fixture();
  assert.equal(build(cwd).status, 0);
  const file = join(cwd, "dist/topics/smoke.html");
  writeFileSync(file, readFileSync(file, "utf8").replace("</head>", '<script src="https://evil.example/site.js"></script></head>'));
  assert.match(check(cwd, "site").stderr, /a script from https:\/\/evil\.example/);
});

test("the site says nothing about itself: no disclaimers, no About, and a corrections contact only when the owner gave one", () => {
  const cwd = fixture();
  assert.equal(build(cwd).status, 0);
  const topic = html(cwd, "topics/smoke.html");
  for (const tell of [/not checked here/, /How this works/, /No ads/, /How this site is made/, /href="\/about"/, /From 2 sources/]) assert.doesNotMatch(topic, tell, String(tell));
  assert.match(topic, /href="mailto:fix@pit\.example">Corrections</);
  assert.ok(!existsSync(join(cwd, "dist/about.html")));
  const none = fixture({ "SITE.md": "Site name: X\n" });
  assert.equal(build(none).status, 0);
  assert.doesNotMatch(html(none, "index.html"), /Corrections/);
  assert.match(html(cwd, "index.html"), />\s*Search\s*</);
});

test("a source's read shows in full, without caption fixes or notes of what was cut, and stays safe", () => {
  const notes = `---\ntitle: "Pit Talk"\nsource: youtube\nurl: https://www.youtube.com/watch?v=aaaaaaaaaaa\npublished: 2026-01-01\n---\n\n## 00:01:00\n\nI keep the fire small. Palantir [caption: Palunteer] agreed. <script>alert(1)</script>\n\n(00:02:00 to 00:03:00: sponsor read)\n\n## 00:20:00\n\nThat's the whole trick.\n`;
  const cwd = fixture({ "distilled/youtube/pit/2026-01-01-aaaaaaaaaaa.md": notes });
  assert.equal(build(cwd).status, 0);
  const source = html(cwd, "sources/aaaaaaaaaaa.html");
  assert.match(source, /I keep the fire small/);
  assert.match(source, /data-seek="1200"/, "each part jumps the player");
  assert.doesNotMatch(source, /\[caption:|sponsor read|<script>alert/);
});

test("who's talking comes from the read's own labels, and only names the source gives count", () => {
  const speakers = ["Ada Brooks", "Sam Ortiz"];
  const turns = turnsOf("Ada Brooks: Where do you start?\n\nSam Ortiz: With the customers.\n\nAnd in speech.\n\nBrooks: Go on.\n\nLighthouse: not a speaker, a thought.", speakers);
  assert.deepEqual(turns.map((t) => [t.speaker, t.paragraphs.length]), [["Ada Brooks", 1], ["Sam Ortiz", 2], ["Ada Brooks", 2]]);
  assert.equal(turns[1].paragraphs[0], "With the customers.", "the name leaves the words");
  assert.equal(turns[2].paragraphs[1], "Lighthouse: not a speaker, a thought.");
  assert.deepEqual(turnsOf("I keep the fire small.", []).map((t) => t.speaker), [""], "one voice has no labels");
  assert.deepEqual(turnsOf("More from me.", speakers, "Sam Ortiz").map((t) => t.speaker), ["Sam Ortiz"], "a part continues the last speaker");
  assert.equal(initialsOf("Sam Ortiz"), "SO");
  assert.equal(initialsOf("DJ Kofi"), "DK");
  const cwd = fixture({ "distilled/youtube/pit/2026-01-01-aaaaaaaaaaa.md": `---\ntitle: "Pit Talk"\nsource: youtube\nurl: https://www.youtube.com/watch?v=aaaaaaaaaaa\npublished: 2026-01-01\nspeakers: [Ann Lee, Bo Ray]\n---\n\n## 00:01:00\n\nAnn Lee: Small fires.\n\nBo Ray: Why?\n\n## 00:20:00\n\nAnn Lee: They last.\n` });
  assert.equal(build(cwd).status, 0);
  const source = html(cwd, "sources/aaaaaaaaaaa.html");
  assert.equal((source.match(/class="avatar[ "]/g) ?? []).length, 3);
  assert.match(source, />AL</);
  assert.match(source, />BR</);
  assert.doesNotMatch(source.split('id="read"')[1], /Ann Lee: Small/, "no name in the line");
  assert.match(source.split('id="read"')[1], /<span class="sr-only">Ann Lee<\/span>/, "a screen reader still hears who");
});

test("the sidebar's moment follows the read", async () => {
  const { lineAt, momentAt, secondAt } = await import("../static/site.js");
  const parts = [{ at: 60, top: 1000, height: 400 }, { at: 240, top: 1400, height: 200 }, { at: 600, top: 1600, height: 100 }];
  assert.equal(secondAt(parts, 1000), 60);
  assert.equal(secondAt(parts, 1200), 150, "halfway through a part is halfway to the next");
  assert.equal(secondAt(parts, 1500), 420);
  assert.equal(secondAt(parts, 5000), 780, "past the end stays at the end");
  assert.equal(secondAt([], 10), null);
  const moments = [{ at: 100 }, { at: 300 }, { at: 700 }];
  assert.equal(momentAt(moments, 50).at, 100, "before any, the first");
  assert.equal(momentAt(moments, 299).at, 100);
  assert.equal(momentAt(moments, 300).at, 300);
  assert.equal(momentAt(moments, 9999).at, 700);
  assert.equal(momentAt([], 10), null);
  for (const second of [60, 150, 420, 700]) assert.equal(Math.round(secondAt(parts, lineAt(parts, second))), second, "a click lands where the sidebar would say it is");
  assert.equal(lineAt(parts, 10), 1000, "before the read, its start");
  assert.equal(lineAt([], 10), null);
});

test("a pick's own short line is what shows large; the list keeps the full moment", () => {
  const file = momentsFile.replace(/(## Strongest\s*\n\s*- \d\d:\d\d:\d\d ).*/, '$1"Small fires win."');
  const cwd = fixture({ "moments/youtube/pit/2026-01-01-aaaaaaaaaaa.md": file });
  assert.equal(build(cwd).status, 0);
  const source = html(cwd, "sources/aaaaaaaaaaa.html");
  assert.match(source, /data-moment-text[^>]*>Small fires win\./, "without its quote marks");
  assert.match(source, /data-punch="Small fires win\."/);
  assert.match(source, /Keep the fire small/);
});

test("related topics sit under the read, and a part knows its second; phone breathers are the strongest only", () => {
  const notes = `---\ntitle: "Pit Talk"\nsource: youtube\nurl: https://www.youtube.com/watch?v=aaaaaaaaaaa\npublished: 2026-01-01\n---\n\n## 00:00:30\n\nFirst part.\n\n## 00:10:00\n\nSecond part.\n`;
  const cwd = fixture({ "distilled/youtube/pit/2026-01-01-aaaaaaaaaaa.md": notes, "moments/youtube/pit/2026-01-01-aaaaaaaaaaa.md": momentsFile });
  assert.equal(build(cwd).status, 0);
  const source = html(cwd, "sources/aaaaaaaaaaa.html");
  assert.doesNotMatch(source, /Pages that cite it/);
  assert.ok(source.indexOf('id="read"') < source.indexOf('id="related"'));
  assert.match(source, /<h2 id="related"[^>]*>Related<\/h2>/);
  assert.match(source, /data-part="30"/);
  assert.match(source, /data-part="600"/);
  assert.match(source, /href="#at-30" data-go="60"/, "a moment goes to its place in the read");
  assert.match(source, /id="at-30"/);
  assert.equal((source.match(/moment-big my-3 lg:hidden/g) ?? []).length, 1);
});

test("a failed source is neither published nor able to block a deploy", () => {
  const key = "youtube:aaaaaaaaaaa";
  const cwd = fixture({
    "moments/youtube/pit/2026-01-01-aaaaaaaaaaa.md": momentsFile.replace("A second point.", '"words never said"'),
    "pipeline/state.json": JSON.stringify({ items: { [key]: { key, kind: "youtube", file: "raw/youtube/pit/2026-01-01-aaaaaaaaaaa.md", stage: "failed" } } }),
  });
  const r = check(cwd);
  assert.equal(r.status, 0, r.stderr);
  const shown = html(cwd, "sources/aaaaaaaaaaa.html");
  assert.doesNotMatch(shown, /Keep the fire small/);
  assert.doesNotMatch(shown, /Notes that stay private/);
});

test("a gist is plain text: a picture or link in it doesn't reach the page, and titles lose their escapes", () => {
  const cwd = fixture({ "moments/youtube/pit/2026-01-01-aaaaaaaaaaa.md": momentsFile.replace("Small fires win.", "![p](https://evil.example/x.png) Small fires win.\n\nSecond paragraph.").replace('title: "Pit Talk"', 'title: "Pit \\"Talk\\""') });
  assert.equal(build(cwd).status, 0);
  const source = html(cwd, "sources/aaaaaaaaaaa.html");
  assert.doesNotMatch(source, /<img[^>]*evil\.example/);
  assert.match(source, /<p>Second paragraph\.<\/p>/);
});

test("searching can't corrupt a title's escapes", async () => {
  const { markTerms } = await import("../static/site.js");
  assert.equal(markTerms("R&D", "amp"), "R&amp;D");
  assert.equal(markTerms("R&D ramp", "amp"), "R&amp;D r<mark>amp</mark>");
});

test("the site's scripts keep the contract: --help, bad input and no stdout on failure", () => {
  const cwd = fixture();
  for (const [cmd, args] of [[tsx, [app("scripts/build.ts")]], [process.execPath, [app("scripts/dev.mjs")]], [process.execPath, [app("scripts/check.mjs")]]]) {
    for (const h of ["--help", "-h"]) {
      const r = spawnSync(cmd, [...args, h], { cwd, encoding: "utf8" });
      assert.equal(r.status, 0, args[0]);
      assert.match(r.stdout, /usage:/);
    }
    const bad = spawnSync(cmd, [...args, "--nope"], { cwd, encoding: "utf8" });
    assert.equal(bad.status, 2, args[0]);
    assert.equal(bad.stdout, "");
    assert.match(bad.stderr, /Try: /);
  }
  const none = check(mkdtempSync(join(tmpdir(), "nook-site-")), "site");
  assert.equal(none.status, 1);
  assert.match(none.stderr, /Try: npm run build/);
});

test("the site's own words carry no AI tells", () => {
  const r = spawnSync(process.execPath, [app(".claude/skills/tropes/tropes.mjs"), "--scan", "--json", app("src/pages.tsx"), app("src/layout.tsx"), app("src/viz.tsx")], { encoding: "utf8" });
  assert.deepEqual(JSON.parse(r.stdout.split("\n")[0] || "[]"), []);
});

test("a topic's lists never read the topic file's text", () => {
  const site = loadSite(fixture());
  const seen = JSON.stringify({ topics: site.topics, entries: site.entriesOf("smoke"), near: site.nearbyOf("smoke") });
  assert.doesNotMatch(seen, /Private section text|Notes that stay private/);
  assert.deepEqual(site.entriesOf("smoke").map((e) => e.published), ["2026-01-01", "2026-03-01"]);
  assert.deepEqual(site.nearbyOf("smoke").map((n) => n.name), ["rubs", "fire"]);
});
