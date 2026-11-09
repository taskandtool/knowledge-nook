import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/check.mjs", import.meta.url));
const run = (cwd, args) =>
  new Promise((finish) => execFile(process.execPath, [script, ...args], { cwd, encoding: "utf8" }, (err, stdout, stderr) => finish({ status: err ? err.code : 0, stdout, stderr })));

const raw = `---\ntitle: "T"\nsource: youtube\nid: abc\nurl: https://www.youtube.com/watch?v=abc\n---\n\n## Transcript\n\nL0001 00:00:00 the best year this bakery ever had\nL0002 00:10:00 and then it ended there\n`;
const url = "https://www.youtube.com/watch?v=abc";
const page = (body) => `---\ntype: topic\ntitle: A Title\ndescription: A description.\n---\n\n${body}\n`;
const setup = (body) => {
  const cwd = mkdtempSync(join(tmpdir(), "nook-check-"));
  mkdirSync(join(cwd, "raw/youtube/x"), { recursive: true });
  mkdirSync(join(cwd, "content/topics"), { recursive: true });
  writeFileSync(join(cwd, "raw/youtube/x/a.md"), raw);
  writeFileSync(join(cwd, "content/topics/p.md"), page(body));
  return cwd;
};
const bad = async (body, pattern) => {
  const r = await run(setup(body), ["pages"]);
  assert.equal(r.status, 1, r.stdout);
  assert.equal(r.stdout, "");
  assert.match(r.stderr, pattern);
  assert.match(r.stderr, /Try: /);
};

test("--help and -h print usage; misuse exits 2 with a Try line", async () => {
  const cwd = setup("x");
  for (const h of ["--help", "-h"]) assert.match((await run(cwd, [h])).stdout, /usage: node scripts\/check\.mjs/);
  for (const args of [[], ["nope"], ["pages", "--nope"], ["pages", "a", "b"]]) {
    const r = await run(cwd, args);
    assert.equal(r.status, 2, args.join(" "));
    assert.equal(r.stdout, "");
    assert.match(r.stderr, /Try: /);
  }
  assert.equal((await run(cwd, ["pages", "missing.md"])).status, 1);
});

test("a good page passes", async () => {
  const r = await run(setup(`I call it "the best year this bakery ever had" ([T](${url}&t=10s)).`), ["pages"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^check pages: 1 page passed/);
});

test("a quote not in raw/ fails", () => bad(`I call it "the smallest moment" ([T](${url})).`, /p\.md:7: quote not in raw\//));
test("a paragraph with no link fails", () => bad(`He said this with no source at all.`, /no link here/));
test("a list item with no link fails", () => bad(`- One ([T](${url})).\n- Two has none.`, /no link here.*Two has none/));
test("a link to an unknown video fails", () => bad(`He said so ([T](https://www.youtube.com/watch?v=zzz)).`, /not a video in raw/));
test("a moment past the video's end fails", () => bad(`He said so ([T](${url}&t=99999s)).`, /past the video's end/));
test("a link to another site fails", () => bad(`He said so ([T](https://example.com/x)).`, /not a source in raw/));
test("a link dressed as a video or a source fails", async () => {
  await bad(`He said so ([T](https://evil.com/?v=abc)).`, /not a source in raw/);
  await bad(`He said so ([T](https://www.youtube.com.evil.org/watch?v=abc)).`, /not a source in raw/);
});
test("a stitched quote fails", () => bad(`He said "ended there ... the biggest moment" ([T](${url})).`, /quote not in raw/));
test("too few links for the sentences fails", () => bad(`One. Two. Three. Four. Five ([T](${url})).`, /5 sentences and 1 link; footnote each point/));
test("a page standing outside the speaker fails", async () => {
  await bad(`He argues the market is wrong ([T](${url})).`, /attributes instead of teaching/);
  await bad(`In his reading it's wrong ([T](${url})).`, /attributes instead of teaching/);
  await bad(`That is his sharpest example ([T](${url})).`, /attributes instead of teaching/);
});
test("a sentence pointing at another page instead of making its point fails", async () => {
  await bad(`The banquet scene is told under [Jesus](/topics/jesus/) ([T](${url})).`, /"is told under \[" points at another page/);
  await bad(`That pattern belongs with [reading in context](/topics/bible/) ([T](${url})).`, /points at another page/);
  await bad(`The dedicated guide explains it ([T](${url})).`, /points at another page/);
  const r = await run(setup(`One empty night says little about [a calling](/topics/calling/) ([T](${url})).`), ["pages"]);
  assert.doesNotMatch(r.stderr, /points at another page/, "a sentence with the link on its words passes");
});
test("--json is misuse in plain text", async () => {
  const r = await run(setup("x"), ["pages", "--json"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Try: /);
});
test("tropes runs on the page", () => bad(`I say "the biggest moment" and here's the thing about it ([T](${url})).`, /model-tell.*here'?s the thing/i));
test("a speaker's own words are not an AI tell", async () => {
  const cwd = setup("x");
  writeFileSync(join(cwd, "raw/youtube/x/b.md"), `---\ntitle: "T"\n---\n\n## Transcript\n\nL0001 00:00:00 and here's the thing about it\n`);
  writeFileSync(join(cwd, "content/topics/p.md"), page(`I say "here's the thing about it" ([T](${url})).`));
  const r = await run(cwd, ["pages"]);
  assert.equal(r.status, 0, r.stderr);
});
test("a quote or figure far from its link's moment fails; near it passes", async () => {
  const far = `---\ntitle: "T"\nsource: youtube\nid: abc\nurl: ${url}\n---\n\n## Transcript\n\nL0001 00:00:00 the biggest moment of all\nL0002 00:05:00 he made 45 dollars\nL0003 00:40:00 the smallest moment of all\nL0004 00:43:00 he lost 90 dollars\n`;
  const cwd = (body) => {
    const dir = setup(body);
    writeFileSync(join(dir, "raw/youtube/x/a.md"), far);
    return dir;
  };
  const ok = await run(cwd(`I say "the smallest moment" and lost 90 ([T](${url}&t=2400s)).`), ["pages"]);
  assert.equal(ok.status, 0, ok.stderr);
  const quote = await run(cwd(`I say "the smallest moment" ([T](${url}&t=0s)).`), ["pages"]);
  assert.match(quote.stderr, /"the smallest moment" is not near 0s in that video/);
  const figure = await run(cwd(`He lost 90 ([T](${url}&t=0s)).`), ["pages"]);
  assert.match(figure.stderr, /90 is not near 0s in that video/);
  const two = await run(cwd(`He made 45 ([T](${url}&t=300s)), then lost 90 ([T](${url}&t=2580s)).`), ["pages"]);
  assert.equal(two.status, 0, two.stderr);
});
test("a long quote fails", async () => {
  const cwd = setup(`x ([T](${url})).`);
  const long = "word ".repeat(31).trim();
  writeFileSync(join(cwd, "raw/youtube/x/b.md"), `---\ntitle: "T"\n---\n\n## Transcript\n\nL0001 00:00:00 ${long}\n`);
  writeFileSync(join(cwd, "content/topics/p.md"), page(`"${long}" ([T](${url})).`));
  const r = await run(cwd, ["pages"]);
  assert.match(r.stderr, /quote runs 31 words/);
});
test("missing front matter fails", async () => {
  const cwd = setup("x");
  writeFileSync(join(cwd, "content/topics/p.md"), `---\ntype: topic\n---\n\nHe said ([T](${url})).\n`);
  assert.match((await run(cwd, ["pages"])).stderr, /front matter has no title/);
});
test("no pages yet is refused with the way forward", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "nook-check-"));
  const r = await run(cwd, ["pages"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /holds no pages/);
});
