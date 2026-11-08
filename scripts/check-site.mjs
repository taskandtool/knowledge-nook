// What blocks a deploy in the built site: dist/ as a visitor gets it.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parse } from "node-html-parser";
import { words } from "./check-distilled.mjs";

/** A run this long shared with a private file is copied text: a quote stops at 30 words. */
const PRIVATE_RUN = 40;
const MAX_FILES = 20000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const DESCRIPTION = { min: 50, max: 170 };
const SAFE_SCHEMES = new Set(["http", "https", "mailto", "tel"]);
const EMBED_HOSTS = new Set(["www.youtube-nocookie.com"]);
/** Pages that list everything, so a link from one does not stop a page being an orphan. */
const LISTINGS = new Set(["/topics", "/guides", "/speakers", "/channels", "/sources", "/new", "/search", "/404"]);
const FORBIDDEN = ["object", "embed", "base", "applet", "frame", "frameset"];

const walkAll = (/** @type {string} */ dir) =>
  !existsSync(dir) ? [] : readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walkAll(p) : [p];
  });

const pathOfFile = (/** @type {string} */ file) => `/${file.replace(/(^|\/)index\.html$/, "").replace(/\.html$/, "")}`;

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
/** Text as a reader gets it, so an apostrophe cannot hide a copied run. */
export const decodeEntities = (/** @type {string} */ text) =>
  text.replace(/&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi, (all, dec, hex, name) => (dec ? String.fromCodePoint(Number(dec)) : hex ? String.fromCodePoint(parseInt(hex, 16)) : (ENTITIES[name.toLowerCase()] ?? all)));

/** Every @type in a piece of structured data, nested ones too; a title may say "Review". */
const typesIn = (/** @type {any} */ o) => (o && typeof o === "object" ? Object.entries(o).flatMap(([k, v]) => (k === "@type" ? [String(v)] : typesIn(v))) : []);

/** What is wrong with one href, or null. */
export function unsafeHref(/** @type {string} */ href) {
  const head = /^[^/?#]*/.exec(href)?.[0] ?? "";
  const colon = head.indexOf(":");
  return colon >= 0 && !SAFE_SCHEMES.has(head.slice(0, colon).toLowerCase()) ? `a link with the scheme ${head.slice(0, colon)}` : null;
}

/** HTML from a source that would run. Our own scripts are the search page's and structured data. */
export function unsafeIn(/** @type {any} */ root, /** @type {string} */ path) {
  const out = [];
  for (const s of root.querySelectorAll("script")) {
    const src = s.getAttribute("src");
    const type = s.getAttribute("type");
    if (type === "application/ld+json") continue;
    if (src?.startsWith("/pagefind/") || src === "/site.js") continue;
    if (!src && path === "/search") continue;
    out.push(`a script${src ? ` from ${src}` : ""}`);
  }
  for (const tag of FORBIDDEN) if (root.querySelector(tag)) out.push(`a <${tag}> element`);
  for (const el of root.querySelectorAll("*")) {
    for (const [name, value] of Object.entries(el.attributes)) {
      if (/^on/i.test(name)) out.push(`an ${name} attribute on <${el.tagName?.toLowerCase()}>`);
      if (/^(href|src|xlink:href|action|formaction)$/i.test(name)) {
        const bad = unsafeHref(String(value));
        if (bad) out.push(bad);
      }
    }
  }
  for (const f of root.querySelectorAll("iframe")) {
    let host = "";
    try {
      host = new URL(f.getAttribute("src") ?? "").hostname;
    } catch {
      // No host: refused below.
    }
    if (!EMBED_HOSTS.has(host)) out.push(`an iframe from ${f.getAttribute("src") ?? "nowhere"}`);
  }
  return out;
}

/** Long runs of a public page's words that also sit in a private file. */
export function privateRuns(/** @type {{ path: string, text: string }[]} */ pages, /** @type {string[]} */ privateTexts) {
  const key = (/** @type {string[]} */ list, /** @type {number} */ i) => `${list[i]} ${list[i + 1]} ${list[i + 2]}`;
  /** @type {Map<string, { path: string, list: string[], at: number }[]>} */
  const starts = new Map();
  for (const { path, text } of pages) {
    const list = words(text);
    for (let at = 0; at + PRIVATE_RUN <= list.length; at++) (starts.get(key(list, at)) ?? starts.set(key(list, at), []).get(key(list, at)))?.push({ path, list, at });
  }
  const found = new Map();
  for (const text of privateTexts) {
    const list = words(text);
    for (let i = 0; i + PRIVATE_RUN <= list.length; i++) {
      for (const { path, list: there, at } of starts.get(key(list, i)) ?? []) {
        if (found.has(path)) continue;
        let n = 3;
        while (n < PRIVATE_RUN && there[at + n] === list[i + n]) n++;
        if (n === PRIVATE_RUN) found.set(path, there.slice(at, at + n).join(" "));
      }
    }
  }
  return [...found].map(([path, text]) => ({ path, text }));
}

/** @param {string} [dist] */
export function siteProblems(dist = "dist") {
  const problems = [];
  const notes = [];
  const say = (/** @type {string} */ page, /** @type {string} */ what) => problems.push(`${page}: ${what}`);
  const files = walkAll(dist).map((f) => relative(dist, f));
  if (files.length > MAX_FILES) say("dist", `${files.length} files; a deploy allows ${MAX_FILES}. Hold back pages, or move to a paid plan`);
  for (const f of files) {
    if (statSync(join(dist, f)).size > MAX_FILE_BYTES) say(f, "over 25 MiB, too large to deploy");
    if (f.endsWith(".md")) say(f, "a markdown file in dist/; only built pages ship");
  }
  const htmlFiles = files.filter((f) => f.endsWith(".html"));
  const paths = new Set(htmlFiles.map(pathOfFile));
  const fileExists = new Set(files.map((f) => `/${f}`));
  const pages = htmlFiles.map((file) => {
    const text = readFileSync(join(dist, file), "utf8");
    return { file, path: pathOfFile(file), text, root: parse(text, { comment: false, blockTextElements: { script: true, noscript: false, style: true, pre: true } }) };
  });
  const byPath = new Map(pages.map((p) => [p.path, p]));

  const address = /^Address: *(\S+)/m.exec(existsSync("SITE.md") ? readFileSync("SITE.md", "utf8").replace(/<!--[\s\S]*?-->/g, "") : "")?.[1]?.replace(/\/+$/, "") ?? "";
  if (!address) notes.push("SITE.md has no Address yet, so canonical tags and the sitemap are left out or relative; add it before making the site public");

  /** @type {Map<string, string[]>} */
  const titles = new Map();
  /** @type {Map<string, Set<string>>} */
  const inbound = new Map();
  for (const p of pages) {
    const { root, path } = p;
    const robots = root.querySelector('meta[name="robots"]')?.getAttribute("content") ?? "";
    p.noindex = /noindex/.test(robots);
    if (path === "/404") continue;
    const title = root.querySelector("title")?.text.trim();
    if (!title) say(path, "no <title>");
    else titles.set(title, [...(titles.get(title) ?? []), path]);
    const description = root.querySelector('meta[name="description"]')?.getAttribute("content")?.trim() ?? "";
    if (!description) say(path, "no description; give the page's front matter one sentence on its actual point");
    else if (!p.noindex && (description.length < DESCRIPTION.min || description.length > DESCRIPTION.max)) say(path, `description runs ${description.length} characters; keep it between ${DESCRIPTION.min} and ${DESCRIPTION.max}`);
    if (!root.querySelector("html")?.getAttribute("lang")) say(path, "no lang on <html>");
    const h1s = root.querySelectorAll("h1").length;
    if (h1s !== 1) say(path, `${h1s} h1 headings; a page has one`);
    if (address && !p.noindex && !root.querySelector('link[rel="canonical"]')?.getAttribute("href")?.startsWith(address)) say(path, `no canonical tag at ${address}`);
    const ld = root.querySelectorAll('script[type="application/ld+json"]').flatMap((s) => {
      try {
        return [JSON.parse(s.text)];
      } catch {
        say(path, "structured data that is not valid JSON");
        return [];
      }
    });
    if (/^\/(topics|guides|speakers|channels)\/./.test(path) && !["Article", "BreadcrumbList"].every((t) => ld.some((o) => o["@type"] === t))) say(path, "no Article and BreadcrumbList structured data");
    if (ld.some((o) => typesIn(o).some((t) => /Review|AggregateRating/.test(t)))) say(path, "review or rating markup; Google says not to aggregate ratings from other sites");
    for (const bad of unsafeIn(root, path)) say(path, `${bad}: source text must never run; fix src/markdown.ts or the page`);

    for (const a of root.querySelectorAll("a")) {
      const raw = a.getAttribute("href");
      if (!raw || /^(https?:|mailto:|tel:|\/\/)/i.test(raw)) continue;
      const [target, anchor] = raw.split("#");
      let to;
      try {
        to = decodeURI(target || path).replace(/(.)\/$/, "$1");
      } catch {
        say(path, `broken link to ${raw}; it is not a valid address`);
        continue;
      }
      if (target && !paths.has(to) && !fileExists.has(to)) {
        say(path, `broken link to ${raw}; link only to a page that exists`);
        continue;
      }
      // A moment's second is read by the page's script, not an element.
      if (anchor && !/^t=\d+$/.test(anchor) && byPath.has(to) && !byPath.get(to).root.querySelector(`[id="${decodeURIComponent(anchor)}"]`)) say(path, `broken anchor ${raw}`);
      if (to !== path) (inbound.get(to) ?? inbound.set(to, new Set()).get(to))?.add(path);
    }
  }
  for (const [title, on] of titles) if (on.length > 1) say(on.join(", "), `share the title "${title}"`);

  const sitemapText = existsSync(join(dist, "sitemap.xml")) ? readFileSync(join(dist, "sitemap.xml"), "utf8") : null;
  if (sitemapText === null) say("dist", "no sitemap.xml");
  else {
    const listed = new Set([...sitemapText.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => decodeURI(decodeEntities(m[1]).replace(address, "")) || "/"));
    for (const path of listed) {
      if (!byPath.has(path)) say("sitemap.xml", `lists ${path}, which was not built`);
      else if (byPath.get(path).noindex) say("sitemap.xml", `lists ${path}, which is held out of search`);
    }
    for (const p of pages) if (!p.noindex && p.path !== "/404" && !listed.has(p.path)) say(p.path, "open to search but not in sitemap.xml");
  }
  for (const p of pages) {
    if (p.noindex || LISTINGS.has(p.path) || p.path === "/") continue;
    // A source page lists what cites it, so it says nothing about whether a page belongs anywhere.
    const from = [...(inbound.get(p.path) ?? [])].filter((x) => !LISTINGS.has(x) && !x.startsWith("/sources/"));
    if (!from.length) say(p.path, "nothing links to it but the listings; set related, broader or part_of on a page that belongs with it");
  }

  // A source's read is them, so it may run close to their words; its length check stops it being a transcript.
  const privateFiles = [...walkAll("raw"), ...walkAll("takes")].filter((f) => f.endsWith(".md") && !/(^|\/)(_index|_cache|structured|audit)\//.test(f));
  const privateTexts = privateFiles.map((f) => readFileSync(f, "utf8").replace(/^L\d+ \d\d:\d\d:\d\d /gm, ""));
  for (const { path, text } of privateRuns(pages.filter((p) => p.path !== "/404" && !p.path.startsWith("/sources/")).map((p) => ({ path: p.path, text: decodeEntities(p.text.replace(/<[^>]+>/g, " ")) })), privateTexts)) {
    say(path, `${PRIVATE_RUN} words in a row from a private file ("${text.slice(0, 70)}..."); say it in your own words and quote at most 30`);
  }
  return { problems, notes };
}
