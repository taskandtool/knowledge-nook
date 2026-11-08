import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex, gateFrom, linkTo, momentsIn, parseAliases, parseDistilled, passesGate, slugOf, topicFile } from "../scripts/build-index.mjs";

const script = fileURLToPath(new URL("../scripts/build-index.mjs", import.meta.url));
const run = (cwd, args = []) =>
  new Promise((finish) => execFile(process.execPath, [script, ...args], { cwd, encoding: "utf8" }, (err, stdout, stderr) => finish({ status: err ? err.code : 0, stdout, stderr })));

const moments = ({ title = "Talk", url = "https://youtu.be/x?v=a", lines = [["00:01:00", "hiring", "Hire slow."]] }) =>
  `---\ntitle: "${title}"\nurl: ${url}\n---\n\n## Gist\n\nA gist.\n\n## Strongest\n\n- ${lines[0][0]} ${lines[0][2]}\n\n## Moments\n\n${lines.map(([at, t, text]) => `- ${at} | ${t} | ${text}`).join("\n")}\n`;
const notes = (published, sections) => `---\ntitle: "Talk"\nsource: youtube\npublished: ${published}\n---\n\n${sections.map(([at, text]) => `## ${at}\n\n${text}\n`).join("\n")}`;

const folder = (files) => {
  const cwd = mkdtempSync(join(tmpdir(), "nook-index-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(cwd, path, ".."), { recursive: true });
    writeFileSync(join(cwd, path), text);
  }
  return cwd;
};

test("--help and -h print usage; bad input prints a Try line and nothing on stdout", async () => {
  const cwd = folder({});
  for (const h of ["--help", "-h"]) {
    const r = await run(cwd, [h]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /usage: node scripts\/build-index\.mjs/);
  }
  for (const [args, status] of [[["--nope"], 2], [["stray"], 2], [[], 1]]) {
    const r = await run(cwd, args);
    assert.equal(r.status, status, args.join(" "));
    assert.equal(r.stdout, "");
    assert.match(r.stderr, /Try: /);
  }
});

test("slugs keep any script, and only unsafe characters go", () => {
  assert.equal(slugOf("AI capex / spending"), "ai-capex-spending");
  assert.equal(slugOf("../../etc"), "etc");
  assert.equal(slugOf("投资 策略"), "投资-策略");
  assert.notEqual(slugOf("c++"), slugOf("c#"));
});

test("aliases: a chain resolves, comments and blanks do not count, and a merge counts a moment once", () => {
  const aliases = parseAliases("# merged\nai spend: ai capex\n\n'capex': ai spend  # note\n");
  const { ordered } = buildIndex([{ path: "a.md", text: moments({ lines: [["00:01:00", "capex, ai spend", "One."]] }) }], aliases);
  assert.deepEqual(ordered.map(([n]) => n), ["ai capex"]);
  assert.equal(ordered[0][1].moments, 1);
  const hard = parseAliases("the buyer's journey: buying\nfoo: c#\n");
  assert.equal(hard.get("the buyer's journey"), "buying");
  assert.equal(hard.get("foo"), "c#");
});

test("names that make one file are one topic, and a name with no letters is left out", () => {
  const { ordered } = buildIndex([{ path: "a.md", text: moments({ lines: [["00:01:00", "ai capex", "One."], ["00:02:00", "ai-capex", "Two."], ["00:03:00", "🙂", "Three."]] }) }], new Map());
  assert.deepEqual(ordered.map(([n]) => n), ["ai capex"]);
  assert.equal(ordered[0][1].entries.length, 2);
});

test("a source's whole-source topics file nothing: only tagged moments count, which is what stops a monster topic", () => {
  const text = `---\ntitle: T\ntopics: [everything]\n---\n\n## Moments\n\n- 00:01:00 | pricing | One.\n`;
  const { ordered } = buildIndex([{ path: "a.md", text, notes: notes("2020-01-01", [["00:00:00", "A."], ["00:05:00", "B."], ["00:10:00", "C."]]) }], new Map());
  assert.deepEqual(ordered.map(([n]) => n), ["pricing"]);
  assert.equal(ordered[0][1].moments, 1);
});

test("a topic file holds each moment with its exact link, and the notes around it once", () => {
  const files = [
    { path: "moments/late.md", text: moments({ title: "Late", url: "https://youtube.com/watch?v=l", lines: [["00:06:40", "x", "Late one."], ["00:07:00", "x", "Late two."], ["01:00:05", "x", "Late three."]] }), notes: notes("2024-01-01", [["00:00:00", "Opening notes."], ["00:05:00", "Middle notes."], ["00:59:00", "End notes."]]) },
    { path: "moments/none.md", text: moments({ title: "Undated", url: "https://site.com/p", lines: [["00:01:00", "x", "Undated one."]] }) },
    { path: "moments/early.md", text: moments({ title: "Early", url: "https://youtube.com/watch?v=e", lines: [["00:00:30", "x", "Early one."]] }), notes: notes("2019-01-01", [["00:00:00", "Early notes."]]) },
  ];
  const { ordered, relatedOf } = buildIndex(files, new Map());
  const out = topicFile("x", ordered[0][1], relatedOf("x"));
  assert.ok(out.indexOf("Early one") < out.indexOf("Late one") && out.indexOf("Late one") < out.indexOf("Undated one"), "oldest source first, undated last");
  assert.match(out, /Moment 00:06:40: Late one\.\nLink: https:\/\/youtube\.com\/watch\?v=l&t=400s/);
  assert.match(out, /Link: https:\/\/youtube\.com\/watch\?v=l&t=3605s/);
  assert.equal(out.match(/Middle notes/g).length, 1, "two moments in one passage bring its notes once");
  assert.doesNotMatch(out, /Opening notes/, "notes with no moment on this topic stay out");
  assert.match(out, /End notes/);
  assert.match(out, /^# x\n\n3 sources, 5 moments/);
  assert.equal(linkTo("https://a.b/c", "00:00:10"), "https://a.b/c", "only a video has a moment to open at");
});

test("related topics are those sharing moments, most shared first", () => {
  const { relatedOf } = buildIndex([{ path: "x.md", text: moments({ lines: [["00:01:00", "a, b", "1"], ["00:02:00", "a, b, c", "2"]] }) }], new Map());
  assert.deepEqual(relatedOf("a"), ["b", "c"]);
});

test("a file with no moments is reported, not fatal", () => {
  const { problems, ordered } = buildIndex([{ path: "bad.md", text: "no front matter" }, { path: "ok.md", text: moments({}) }], new Map());
  assert.deepEqual(problems, ["bad.md: no moments, left out"]);
  assert.ok(ordered.length);
});

test("the gate wants enough sources each saying enough, and the owner can change it", () => {
  const gate = gateFrom("");
  const of = (...n) => new Map(n.map((v, i) => [`s${i}`, v]));
  assert.equal(passesGate(of(3, 2), gate), true);
  assert.equal(passesGate(of(10, 1), gate), false, "one interview and a passing mention isn't two voices");
  assert.equal(passesGate(of(2, 2), gate), false, "too little in all");
  assert.equal(passesGate(of(20), gate), false);
  const lenient = gateFrom("<!-- Publish gate: 9 sources -->\nPublish gate: 1 source, 1 moment\n");
  assert.deepEqual([lenient.sources, lenient.moments], [1, 1]);
  assert.equal(passesGate(of(1), lenient), true);
});

test("moments are read only from the Moments part, and old headings with topics still parse", () => {
  assert.deepEqual(momentsIn(moments({})).map((m) => m.at), ["00:01:00"]);
  assert.deepEqual(momentsIn("## Strongest\n\n- 00:01:00 | x | Not yet.\n"), []);
  const d = parseDistilled('---\ntitle: "A: B"\n---\n\n## 00:01:00 | old, topics\n\nText.\n\n## 00:02:00\n\nMore.\n');
  assert.equal(d.fields.title, "A: B");
  assert.deepEqual(d.sections.map((s) => s.at), ["00:01:00", "00:02:00"]);
});

test("only the Moments part counts, even with a part after it; escaped titles come out clean", () => {
  assert.deepEqual(momentsIn("## Moments\n\n- 00:01:00 | x | One.\n\n## Extra\n\n- 00:02:00 | x | Not a moment.\n").map((m) => m.at), ["00:01:00"]);
  assert.equal(parseDistilled('---\ntitle: "The \\"Real\\" Show"\n---\n').fields.title, 'The "Real" Show');
});

test("a web page's link has no second, and its whole notes come along", () => {
  assert.equal(linkTo("https://a.example/p", "00:00:00"), "https://a.example/p");
  assert.equal(linkTo("https://www.youtube.com/watch?v=a", "00:00:10"), "https://www.youtube.com/watch?v=a&t=10s");
  const { ordered, relatedOf } = buildIndex([{ path: "moments/web/a/p.md", text: moments({ url: "https://a.example/p", lines: [["00:00:00", "x", "One."], ["00:00:00", "x", "Two."]] }), notes: `---\ntitle: P\n---\n\n## Intro\n\nThe page's notes.\n` }], new Map());
  const out = topicFile("x", ordered[0][1], relatedOf("x"));
  assert.match(out, /Link: https:\/\/a\.example\/p\n/);
  assert.equal(out.match(/The page's notes/g).length, 1);
});

test("it writes the index, applies the gate, flags a giant, keeps aliases, and a rebuild drops what went", async () => {
  const many = (prefix, n, tag = "shared") => Array.from({ length: n }, (_, i) => [`00:${String(i + 1).padStart(2, "0")}:00`, tag, `${prefix} ${i}.`]);
  const cwd = folder({
    "moments/youtube/a/1.md": moments({ lines: [...many("A", 3), ["00:30:00", "only one", "Solo."]] }),
    "moments/youtube/b/2.md": moments({ lines: many("B", 3) }),
    "moments/youtube/c/3.md": moments({ lines: many("C", 31, "giant") }),
    "moments/youtube/d/4.md": moments({ lines: many("D", 2, "giant") }),
    "index/aliases.yaml": "only one: lone topic\n",
    "SITE.md": "Publish gate: 2 sources, 5 moments\n",
  });
  const r = await run(cwd);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^build-index: 3 topics from 4 sources, 2 pass the publish gate/);
  const list = readFileSync(join(cwd, "index/topics.md"), "utf8");
  assert.match(list, /- shared: 2 sources, 6 moments\n/);
  assert.match(list, /- giant: 2 sources, 33 moments, big enough to split/);
  assert.match(list, /- lone topic: 1 source, 1 moment, under the publish gate/);
  assert.ok(existsSync(join(cwd, "index/topics/shared.md")));
  assert.match(readFileSync(join(cwd, "index/aliases.yaml"), "utf8"), /only one: lone topic/);
  writeFileSync(join(cwd, "moments/youtube/a/1.md"), moments({ lines: many("A", 3) }));
  await run(cwd);
  assert.ok(!existsSync(join(cwd, "index/topics/lone-topic.md")));
});
