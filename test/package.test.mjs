import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");

test("the manifest parses, and its conditions are ones the platform reads", () => {
  const m = JSON.parse(read("starter-app.json"));
  assert.equal(m.slug, "knowledge-nook");
  assert.equal(m.ready.service, "web");
  const ids = m.suggestions.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const s of m.suggestions) {
    assert.ok(s.label && s.prompt, s.id);
    for (const w of s.when ?? []) assert.ok(["missing", "present", "unfilled", "contains", "newer_than"].includes(w.is), s.id);
  }
});

test("setup scripts are valid shell, and setup serves what the manifest waits for", () => {
  for (const f of ["setup.sh", "after-setup.sh"]) assert.equal(spawnSync("bash", ["-n", join(root, ".taskandtool", f)]).status, 0, f);
  assert.match(read(".taskandtool/setup.sh"), /taskandtool\.py" serve "npm run dev" --port 3000/);
});

test("each script and skill AGENTS.md names exists, each skill is routed to, and each description names when", () => {
  const agents = read("AGENTS.md");
  for (const [, script] of agents.matchAll(/scripts\/([a-z-]+\.mjs)/g)) assert.ok(existsSync(join(root, "scripts", script)), script);
  for (const [, name] of agents.matchAll(/the `([a-z-]+)` skill/g)) assert.ok(existsSync(join(root, ".claude/skills", name, "SKILL.md")), name);
  for (const dir of readdirSync(join(root, ".claude/skills"))) {
    if (dir === "tropes") continue;
    assert.match(agents, new RegExp(`\`${dir}\` skill`), dir);
    const text = read(`.claude/skills/${dir}/SKILL.md`);
    assert.match(text, new RegExp(`^name: ${dir}$`, "m"));
    const description = /^description: (.+)$/m.exec(text)?.[1] ?? "";
    assert.match(description, /Use when|Use before/, dir);
    assert.ok(description.length < 400, `${dir}: ${description.length} characters`);
  }
});

test("working knowledge and credentials stay out of the repository", () => {
  const ignored = read(".gitignore").split("\n");
  for (const p of ["/sources/", "/raw/", "/distilled/", "/index/", "/takes/", "/content/", "/pipeline/", "/log.md", "/dist/", ".env"]) assert.ok(ignored.includes(p), p);
});

test("skills, instructions and docs carry no AI tells", () => {
  const r = spawnSync(process.execPath, [join(root, ".claude/skills/tropes/tropes.mjs"), "--scan", "--json", join(root, ".claude/skills/site"), join(root, ".claude/skills/cross-check"), join(root, ".claude/skills/write-page"), join(root, "AGENTS.md"), join(root, "README.md")], { encoding: "utf8" });
  assert.deepEqual(JSON.parse(r.stdout.split("\n")[0] || "[]"), []);
});
