// The picture a shared link shows, one per written page: a video's picture behind a dark
// gradient, with the page's title on it. Drawn at build time, with no browser and no AI.
import { Resvg } from "@resvg/resvg-js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import satori from "satori";
import { initialsOf, type Page, type Site } from "./load";
import { videosOf } from "./pages";

const WIDTH = 1200;
const HEIGHT = 630;
const CACHE = join(".cache", "thumbnails");
/** Every character the font can draw: a title in another script keeps the video's own picture. */
const DRAWABLE = /^[\p{Script=Latin}\p{N}\p{P}\p{S}\p{Zs}]+$/u;

const require = createRequire(import.meta.url);
const fontFile = (subset: string, weight: number) => readFileSync(require.resolve(`@fontsource/schibsted-grotesk/files/schibsted-grotesk-${subset}-${weight}-normal.woff`));
const fonts = () => [700, 800].flatMap((weight) => ["latin", "latin-ext"].map((subset) => ({ name: "Display", data: fontFile(subset, weight), weight: weight as 700 | 800, style: "normal" as const })));

export const shareImagePath = (p: Page) => `/og${p.path}.png`;

const el = (type: string, style: Record<string, unknown>, children?: unknown, extra: Record<string, unknown> = {}) => ({ type, props: { style, children, ...extra } });

/** The picture as a PNG. `tall` is YouTube's 4:3 size, whose built-in black bars are drawn out of frame. */
export async function renderShareImage({ title, siteName, picture, tall }: { title: string; siteName: string; picture: Uint8Array; tall?: boolean }) {
  const mime = picture[0] === 0x89 ? "image/png" : "image/jpeg";
  const size = tall ? { width: 1608, height: 1206, left: -204, top: -288 } : { width: WIDTH, height: 675, left: 0, top: -22 };
  const tree = el("div", { display: "flex", position: "relative", width: WIDTH, height: HEIGHT, backgroundColor: "#203a35", color: "#ffffff", fontFamily: "Display" }, [
    el("img", { position: "absolute", ...size }, undefined, { src: `data:${mime};base64,${Buffer.from(picture).toString("base64")}`, width: size.width, height: size.height }),
    el("div", { position: "absolute", left: 0, top: 0, width: WIDTH, height: HEIGHT, backgroundImage: "linear-gradient(to top, rgba(12,16,16,0.97), rgba(12,16,16,0.82) 55%, rgba(12,16,16,0.62))" }),
    el("div", { position: "absolute", left: 64, top: 56, display: "flex", alignItems: "center", fontSize: 30, fontWeight: 700 }, [
      el("div", { display: "flex", alignItems: "center", justifyContent: "center", width: 52, height: 52, marginRight: 16, borderRadius: 12, backgroundColor: "#203a35", color: "#f3f6f1", fontSize: 21 }, initialsOf(siteName)),
      el("div", {}, siteName),
    ]),
    el("div", { position: "absolute", left: 64, bottom: 60, width: WIDTH - 128, fontSize: title.length > 60 ? 64 : 84, lineHeight: 1.06, fontWeight: 800, letterSpacing: "-0.02em", lineClamp: 3 }, title),
  ]);
  const svg = await satori(tree as never, { width: WIDTH, height: HEIGHT, fonts: fonts() });
  return new Resvg(svg, { fitTo: { mode: "width", value: WIDTH } }).render().asPng();
}

type Fetcher = (url: string) => Promise<Response>;
const defaultFetch: Fetcher = (url) => fetch(url, { signal: AbortSignal.timeout(8000) });

/** A video's picture: the large size when YouTube has one, kept between builds so each is fetched once. */
async function pictureOf(video: string, get: Fetcher) {
  for (const [size, tall] of [["maxresdefault", false], ["hqdefault", true]] as const) {
    const file = join(CACHE, `${video}-${size}.jpg`);
    if (existsSync(file)) return { picture: readFileSync(file), tall };
    try {
      const res = await get(`https://i.ytimg.com/vi/${video}/${size}.jpg`);
      if (!res.ok) continue;
      const picture = Buffer.from(await res.arrayBuffer());
      mkdirSync(CACHE, { recursive: true });
      writeFileSync(file, picture);
      return { picture, tall };
    } catch { /* The page keeps the video's own picture. */ }
  }
  return null;
}

/** Draws every written page's picture into dir. Returns the pages that got one; a page that didn't keeps the video's own. */
export async function writeShareImages(site: Site, dir: string, get: Fetcher = defaultFetch) {
  const made = new Set<string>();
  const used = new Map<string, number>();
  for (const p of site.pages.filter((x) => x.type === "topic" || x.type === "guide")) {
    if (!DRAWABLE.test(p.title)) continue;
    const video = [...videosOf(site, p)].sort((a, b) => (used.get(a) ?? 0) - (used.get(b) ?? 0))[0];
    if (!video) continue;
    used.set(video, (used.get(video) ?? 0) + 1);
    const found = await pictureOf(video, get);
    if (!found) continue;
    const target = join(dir, shareImagePath(p).slice(1));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, await renderShareImage({ title: p.title, siteName: site.settings.name, ...found }));
    made.add(p.path);
  }
  return made;
}
