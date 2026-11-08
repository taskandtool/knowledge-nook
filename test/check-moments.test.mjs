import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkMoments } from "../scripts/check-moments.mjs";

const stamp = (m) => `00:${String(m).padStart(2, "0")}:00`;
const raw = `---\ntitle: "T"\nid: abc\n---\n\n## Transcript\n\n${Array.from({ length: 40 }, (_, m) => `L${String(m + 1).padStart(4, "0")} ${stamp(m)} ${m === 5 ? "Ann Lee says the budget is a dumb rule and it cost 45 dollars" : m === 30 ? "a late stretch about pricing" : "word word word"}`).join("\n")}\n`;
const file = (strong, lines) => `---\ntitle: T\n---\n\n## Gist\n\nBudgets are dumb.\n\n## Strongest\n\n${strong.join("\n")}\n\n## Moments\n\n${lines.join("\n")}\n`;
const good = `- 00:05:00 | budgets | Budgets are "a dumb rule" that cost 45 dollars.`;
const problems = (strong, lines) => checkMoments("m.md", file(strong, lines), raw).problems;

test("a good file passes, and says how dense it is and where it's empty", () => {
  const r = checkMoments("m.md", file(["- 00:05:00 Budgets are dumb."], [good]), raw);
  assert.deepEqual(r.problems, []);
  assert.equal(r.moments, 1);
  assert.equal(r.hasGist, true);
  assert.ok(r.hints.some((h) => /1 moments in 39 minutes/.test(h)));
  assert.ok(r.hints.some((h) => /nothing from 00:05:00 to 00:39:00/.test(h)));
});

test("each thing that makes a moment wrong or unscannable fails, naming the line", () => {
  const cases = [
    [[], [good, "- 00:03:00 | x | Out of order."], /comes before/],
    [[], ["- 00:50:00 | x | Past the end."], /past the video's end/],
    [[], ["- 00:05:00 |  | No topic."], /no topic/],
    [[], ["- 00:05 budgets: a bad line"], /can't read this moment/],
    [[], ["- 00:05:00 | $20 to $2 million, budgets | A line."], /is not a name a reader would look up/],
    [[], [`- 00:05:00 | x | ${"long ".repeat(26)}`], /26 words/],
    [[], ["- 00:05:00 | x | Lee says budgets fail."], /opens with who said it/],
    [[], ["- 00:05:00 | x | He argues budgets fail."], /opens with who said it/],
    [[], ['- 00:05:00 | x | "words nobody said".'], /quote isn't in the captions/],
    [[], ['- 00:30:00 | x | "a dumb rule" said late.'], /quote isn't in the captions near 00:30:00/],
    [[], ["- 00:05:00 | x | It cost 987654 dollars."], /987654/],
    [[], ["- 00:05:00 | x | Budgets fail, says Zanzibar Holdings."], /Zanzibar/],
    [["- 00:06:00 Not a moment."], [good], /00:06:00 is not one of the moments/],
    [["- 00:05:00 | budgets | Budgets are dumb."], [good], /without its topics/],
    [[], [], /no moments/],
  ];
  for (const [strong, lines, expected] of cases) assert.ok(problems(strong, lines).some((p) => expected.test(p)), String(expected));
});

test("a gist is held to the source too, and the align step needs one", () => {
  const withGist = (g) => file(["- 00:05:00 Budgets are dumb."], [good]).replace("Budgets are dumb.\n\n## Strongest", `${g}\n\n## Strongest`);
  assert.deepEqual(checkMoments("m.md", withGist('He calls it "a dumb rule".'), raw).problems, []);
  assert.ok(checkMoments("m.md", withGist('He calls it "a total scam".'), raw).problems.some((p) => /gist quote isn't in the source/.test(p)));
  assert.ok(checkMoments("m.md", withGist("It cost 987654 dollars."), raw).problems.some((p) => /gist: .*987654/.test(p)));
  const bare = `---\ntitle: T\n---\n\n## Moments\n\n${good}\n`;
  assert.deepEqual(checkMoments("m.md", bare, raw).problems, [], "fine until align");
  const final = checkMoments("m.md", bare, raw, { final: true }).problems;
  assert.ok(final.some((p) => /no gist/.test(p)) && final.some((p) => /no picks/.test(p)));
  const empty = `---\ntitle: T\n---\n\n## Gist\n\n## Strongest\n\n- 00:05:00 B.\n\n## Moments\n\n${good}\n`;
  assert.ok(checkMoments("m.md", empty, raw, { final: true }).problems.some((p) => /no gist/.test(p)), "a heading alone is no gist");
});

test("nothing under Moments is silently dropped", () => {
  for (const line of ["* 00:02:00 | t | Star bullet.", "  - 00:02:00 | t | Indented.", "A bare line."]) {
    assert.ok(problems([], [good, line]).some((p) => /can't read this under Moments/.test(p)), line);
  }
});

test("a web page has no seconds: quotes are found anywhere, and a pick is matched by its words", () => {
  const page = `---\nurl: "https://a.example/p"\ntitle: "P"\n---\n\nThe budget is a dumb rule, says the whole page, and it cost 45 dollars.\n`;
  const lines = [`- 00:00:00 | budgets | Budgets are "a dumb rule".`, `- 00:00:00 | cost | It cost 45 dollars.`];
  assert.deepEqual(checkMoments("m.md", file([`- 00:00:00 It cost 45 dollars.`], lines), page).problems, []);
  assert.ok(checkMoments("m.md", file([`- 00:00:00 Not a line here.`], lines), page).problems.some((p) => /not one of the moments/.test(p)));
});

test("a problem names the line it's on", () => {
  const list = problems([], [good, "- 00:06:00 | x | It cost 987654 dollars."]);
  assert.match(list[0], /^m\.md:\d+: /);
  assert.match(list[0], /m\.md:16/);
});

test("the script keeps the contract", () => {
  const script = fileURLToPath(new URL("../scripts/check-moments.mjs", import.meta.url));
  const cwd = mkdtempSync(join(tmpdir(), "nook-moments-"));
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8" });
  assert.match(run("--help").stdout, /usage: node scripts\/check-moments\.mjs/);
  for (const [args, status] of [[[], 2], [["--nope"], 2], [["a", "b"], 2], [["moments/none.md"], 1]]) {
    const r = run(...args);
    assert.equal(r.status, status, args.join(" "));
    assert.equal(r.stdout, "");
    assert.match(r.stderr, /Try: /);
  }
  mkdirSync(join(cwd, "moments/y"), { recursive: true });
  writeFileSync(join(cwd, "moments/y/x.md"), file([], [good]));
  assert.match(run("moments/y/x.md").stderr, /no source at raw/);
  mkdirSync(join(cwd, "raw/y"), { recursive: true });
  writeFileSync(join(cwd, "raw/y/x.md"), raw);
  assert.equal(run("moments/y/x.md").status, 0);
});
