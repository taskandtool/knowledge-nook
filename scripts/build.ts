// The site for production: every page pre-rendered to dist/ beside the static files, the
// sitemap and robots.txt, and Pagefind's search index. Built aside and swapped in, so a
// failed build leaves the last one whole. Reads the working folders where it runs.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { done, fail, parseArgs, plain } from "../src/data/cli.mjs";
import { favicon, makeApp, paletteData, robots, sitemap } from "../src/app";
import { writeShareImages } from "../src/og";
import { DATES_FILE, loadSite, type Site } from "../src/load";
import { routesOf } from "../src/pages";

plain(parseArgs(process.argv.slice(2)), `usage: npm run build

Renders every page in content/ and the site's own pages to dist/, with sitemap.xml,
robots.txt and the search index, and notes in content/.dates.json when each page was
first written and last changed. Safe to run again. Prints what it built; a failure says
which step and leaves the last dist/ alone. Exit 0 built, 1 failed, 2 used wrongly.`, "build");

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const bin = (name: string) => join(APP, "node_modules", ".bin", name);
const FRESH = ".dist.new";

function step(what: string, cmd: string, args: string[], cwd = process.cwd()) {
  const r = spawnSync(cmd, args, { encoding: "utf8", cwd });
  if (r.status !== 0) fail(`build: the ${what} step failed\n${`${r.stdout || ""}${r.stderr || ""}${r.error?.message ?? ""}`.trim().split("\n").slice(-15).join("\n")}`, "npm install, then npm run build");
}

/** When each page was first written and last changed, kept beside the pages. A page's words decide. */
function stampDates(site: Site, today: string) {
  const old = existsSync(DATES_FILE) ? JSON.parse(readFileSync(DATES_FILE, "utf8")) : {};
  const next: Record<string, { hash: string; first: string; updated: string }> = {};
  for (const p of site.pages) {
    const hash = createHash("sha256").update(readFileSync(p.file)).digest("hex").slice(0, 16);
    const was = old[p.file];
    next[p.file] = was?.hash === hash ? was : { hash, first: was?.first ?? today, updated: today };
  }
  if (site.pages.length) writeFileSync(DATES_FILE, `${JSON.stringify(next, null, 1)}\n`);
}

const today = new Date().toISOString().slice(0, 10);
stampDates(loadSite(), today);
const site = loadSite();
const routes = routesOf(site);

step("css", bin("tailwindcss"), ["-i", "styles/input.css", "-o", "static/site.css", "--minify"], APP);
rmSync(FRESH, { recursive: true, force: true });
mkdirSync(FRESH, { recursive: true });
cpSync(join(APP, "static"), FRESH, { recursive: true });

// Pictures for shared links need the site's address, and the network once per video.
site.shareImages = site.settings.url && process.env.OG_IMAGES !== "off" ? await writeShareImages(site, FRESH) : new Set();

const app = makeApp(() => site);
const write = async (path: string, file: string) => {
  const res = await app.request(encodeURI(path));
  if (res.status !== 200 && path !== "/404") fail(`build: ${path} rendered with status ${res.status}`, "npm run dev, and open that page");
  const target = join(FRESH, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, await res.text());
};
for (const path of routes.keys()) await write(path, path === "/" ? "index.html" : `${path.slice(1)}.html`);
await write("/404", "404.html");
writeFileSync(join(FRESH, "favicon.svg"), favicon(site));
writeFileSync(join(FRESH, "sitemap.xml"), sitemap(site));
writeFileSync(join(FRESH, "robots.txt"), robots(site));
writeFileSync(join(FRESH, "palette.json"), JSON.stringify(paletteData(site)));

if (site.pages.length) step("search", bin("pagefind"), ["--site", FRESH, "--silent"]);
rmSync("dist", { recursive: true, force: true });
renameSync(FRESH, "dist");

const open = [...routes.values()].filter((b) => !b().meta.noindex).length;
done("build", `${routes.size} pages + 404 to dist/, ${open} open to search`, {
  lines: [`${site.pages.length} written pages, ${site.pages.filter((p) => !p.indexable).length} under the publish gate`, `${site.shareImages.size} share images`, ...(site.settings.url ? [] : ["SITE.md has no Address yet, so the sitemap's locations are relative"])],
  next: "npm run check",
});
