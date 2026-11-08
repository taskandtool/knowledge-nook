/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */
// The site as one Hono app: `npm run dev` serves it and the build renders each path once.
import { Hono } from "hono";
import { html, raw } from "hono/html";
import { canonical, Layout } from "./layout";
import { initialsOf, loadSite, type Page, type Site } from "./load";
import { clock } from "./markdown";
import { smallOf, notFoundPage, routesOf, videoOf, type Built } from "./pages";
import { niceDate } from "./viz";

const page = (site: Site, built: Built) => html`<!doctype html>${raw(String(<Layout site={site} meta={built.meta}>{built.body}</Layout>))}`;

/** Only pages that pass the publish gate. */
export function indexablePaths(site: Site, routes: Map<string, () => Built>) {
  return [...routes.entries()].filter(([, build]) => !build().meta.noindex).map(([path]) => path).sort();
}

const xml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;");

export function sitemap(site: Site) {
  const routes = routesOf(site);
  const stamp = new Map(site.pages.map((p) => [p.path, p.updated]));
  const urls = indexablePaths(site, routes).map((p) => `  <url><loc>${xml(canonical(site, p) ?? encodeURI(p))}</loc>${stamp.get(p) ? `<lastmod>${stamp.get(p)}</lastmod>` : ""}</url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

/** What the command center shows at once and matches as you type: titles and the strongest moments, no more. */
export function paletteData(site: Site) {
  const strongest = [...site.topics].filter((t) => t.page).sort((a, b) => b.sources - a.sources || b.moments - a.moments);
  const sources = [...site.sources.values()].filter((s) => s.citedBy.length || s.moments.length).sort((a, b) => (b.published || "").localeCompare(a.published || ""));
  const written = strongest.map((t) => t.page!);
  const pictureOf = (keys: string[]) => {
    for (const key of keys) {
      const s = site.sources.get(key);
      const video = s && videoOf(s);
      if (video) return smallOf(video);
    }
    return undefined;
  };
  const page = (type: string, p: Page) => ({ type, title: p.title, path: encodeURI(p.path), note: p.description, thumb: pictureOf(p.sourceKeys) });
  const items = [
    ...written.map((p) => page("Topic", p)),
    ...site.pages.filter((p) => p.type === "topic" && !written.includes(p)).map((p) => page("Topic", p)),
    ...site.pages.filter((p) => p.type === "guide").map((p) => page("Guide", p)),
    ...site.pages.filter((p) => p.type === "speaker").map((p) => ({ ...page("Speaker", p), note: "" })),
    ...site.pages.filter((p) => p.type === "channel").map((p) => ({ ...page("Channel", p), note: "" })),
    ...sources.map((s) => ({ type: "Source", title: s.title, path: encodeURI(s.path), note: [s.channel, s.published ? niceDate(s.published, site.settings.language) : ""].filter(Boolean).join(" · "), thumb: videoOf(s) ? smallOf(videoOf(s)!) : undefined })),
  ];
  const moments = sources.flatMap((s) => s.moments.filter((m) => m.strong).map((m) => ({ text: m.punch ?? m.text, path: `${encodeURI(s.path)}#t=${m.at}`, source: s.channel || s.title, at: clock(m.at) })));
  return { items, moments };
}

/** The tab's little picture: the site's initials in the dark square the header uses. */
export function favicon(site: Site) {
  const text = initialsOf(site.settings.name).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#203a35"/><text x="16" y="21.5" text-anchor="middle" font-family="system-ui,sans-serif" font-size="15" font-weight="700" fill="#f3f6f1">${text}</text></svg>\n`;
}

export const robots = (site: Site) => `User-agent: *\nAllow: /\nDisallow: /pagefind/\n${site.settings.url ? `Sitemap: ${site.settings.url}/sitemap.xml\n` : ""}`;

/** The app, reading the working folders fresh for each request unless given a site. */
export function makeApp(load: () => Site = () => loadSite()) {
  const app = new Hono();
  app.get("/sitemap.xml", (c) => c.body(sitemap(load()), 200, { "Content-Type": "application/xml; charset=utf-8" }));
  app.get("/palette.json", (c) => c.json(paletteData(load())));
  app.get("/favicon.svg", (c) => c.body(favicon(load()), 200, { "Content-Type": "image/svg+xml" }));
  app.get("/robots.txt", (c) => c.text(robots(load())));
  app.get("*", (c) => {
    const site = load();
    const path = decodeURI(c.req.path).replace(/(.)\/$/, "$1");
    const build = routesOf(site).get(path);
    return build ? c.html(page(site, build())) : c.html(page(site, notFoundPage()), 404);
  });
  return app;
}
