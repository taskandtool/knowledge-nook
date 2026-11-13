/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */
// Every page of the site, from what src/load.ts read. Each returns its metadata and body.
import { raw } from "hono/html";
import type { Child } from "hono/jsx";
import { slugOf } from "../scripts/build-index.mjs";
import { videoId } from "../scripts/check.mjs";
import { canonical, href, SearchIcon, type Meta } from "./layout";
import { initialsOf, PLURAL, turnsOf, type Page, type PageType, type Site, type Source, type TopicRow } from "./load";
import { clock, headingsOf, renderWithNotes, safeHref, secondsIn, toHtml, type Reference } from "./markdown";
import { niceDate, RelationMap, Timeline, TopicMap } from "./viz";

export type Built = { meta: Meta; body: Child };
const TITLES: Record<PageType, string> = { topic: "Topics", guide: "Guides", speaker: "Speakers", channel: "Channels" };
const NEARBY_SHOWN = 6;
/** Fewer written topics than this make a map of nothing. */
const MAP_MIN = 3;
/** The home page: enough to feel the whole, few enough to read. */
const RELATION_TOPICS = 12;
const RELATION_VIDEOS = 10;
const RELATION_MIN = 2;
/** One large and four small; "All topics" has the rest. */
const LEAD_TOPICS = 5;
const NEWEST_LISTED = 4;
const LEAD_SOURCE_TOPICS = 4;
const WALL_LINES = 12;
const WALL_MIN = 4;
const WALL_LONGEST = 90;
const WALL_POSTER_EVERY = 3;
const WALL_COLOUR_EVERY = 3;
const SPOTLIGHTS = 3;
const ALIKE_SHOWN = 3;
const HERO_PICKS = 12;
const NEW_SHOWN = 50;
const LABEL: Record<PageType, string> = { topic: "Topic", guide: "Guide", speaker: "Speaker", channel: "Channel" };

const Frame = ({ children }: { children?: Child }) => <div class="mx-auto max-w-wide px-4 pt-10 sm:px-8 sm:pt-14">{children}</div>;
const Heading = ({ title, lede }: { title: string; lede?: string }) => (
  <header class="max-w-heading">
    <h1 class={`font-extrabold tracking-tight ${title.length > 60 ? "text-page-long" : "text-page"}`}>{title}</h1>
    {lede ? <p class="mt-5 max-w-intro text-lede text-ink-2">{lede}</p> : null}
  </header>
);
export const videoOf = (s: Source) => { const id = videoId(s.url); return id && /^[\w-]+$/.test(id) ? id : undefined; };
/** YouTube's public picture of a video: no key and no vendor, only its id. */
export const thumbOf = (video: string) => `https://i.ytimg.com/vi/${video}/hqdefault.jpg`;
/** The same picture small and without the black bars. */
export const smallOf = (video: string) => `https://i.ytimg.com/vi/${video}/mqdefault.jpg`;
/** The videos behind a written page, newest first. */
export const videosOf = (site: Site, p: Page) => p.sourceKeys.flatMap((k) => { const s = site.sources.get(k); const v = s && videoOf(s); return v ? [{ v, at: s.published || "" }] : []; }).sort((a, b) => b.at.localeCompare(a.at)).map((x) => x.v);

/** Hands out a page's picture so a video repeats only once they've all been used. */
const pictureSpreader = (site: Site) => {
  const shown = new Map<string, number>();
  return (p: Page) => {
    const least = [...videosOf(site, p)].sort((a, b) => (shown.get(a) ?? 0) - (shown.get(b) ?? 0))[0];
    if (!least) return undefined;
    shown.set(least, (shown.get(least) ?? 0) + 1);
    return thumbOf(least);
  };
};

/** One video or page, in the grid: the creator's own picture, large and untouched. */
const SourceCard = ({ site, s, gist }: { site: Site; s: Source; gist?: boolean }) => {
  const v = videoOf(s);
  return (
    <a href={href(s.path)} class="group block no-underline" data-card data-channel={s.channel || undefined}>
      <span class="block aspect-video overflow-hidden rounded-lg bg-tile">
        {v ? <img class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" src={thumbOf(v)} alt="" loading="lazy" referrerpolicy="no-referrer" /> : null}
      </span>
      <span class="mt-3 block truncate font-medium group-hover:text-accent" title={s.title}>{s.title}</span>
      <span class="mt-1 block truncate text-small text-ink-3">{[s.channel, dated(site, s.published)].filter(Boolean).join(" · ")}</span>
      {gist && s.gist ? <span class="mt-2 line-clamp-2 font-body text-small text-ink-2">{s.gist}</span> : null}
    </a>
  );
};

const dated = (site: Site, d?: string) => (d ? niceDate(d, site.settings.language) : "");
const crumbs = (site: Site, trail: [string, string][]) => ({
  "@context": "https://schema.org", "@type": "BreadcrumbList",
  itemListElement: trail.map(([name, path], i) => ({ "@type": "ListItem", position: i + 1, name, ...(canonical(site, path) ? { item: canonical(site, path) } : {}) })),
});

function articleLd(site: Site, p: Page) {
  return {
    "@context": "https://schema.org", "@type": "Article", headline: p.title, description: p.description,
    ...(p.first ? { datePublished: p.first } : {}), ...(p.updated ? { dateModified: p.updated } : {}),
    ...(canonical(site, p.path) ? { mainEntityOfPage: canonical(site, p.path) } : {}),
    author: { "@type": "Organization", name: site.settings.name }, publisher: { "@type": "Organization", name: site.settings.name },
  };
}

/** The relations a page's front matter declares, and those others declare about it. */
function relationsOf(site: Site, p: Page) {
  const pages = (names: string[]) => [...new Map(names.flatMap((n) => { const t = site.resolve(n); return t && t !== p ? [[t.path, t] as const] : []; })).values()];
  const pointing = (of: (o: Page) => string[]) => site.pages.filter((o) => o !== p && of(o).some((n) => site.resolve(n) === p));
  return {
    partOf: pages(p.partOf),
    parts: pointing((o) => o.partOf),
    broader: pages(p.broader),
    narrower: pointing((o) => o.broader),
    related: [...new Map([...pages(p.related), ...pointing((o) => o.related)].map((t) => [t.path, t])).values()],
  };
}

const LinkList = ({ title, pages }: { title: string; pages: Page[] }) =>
  pages.length ? (
    <div class="mt-6 first:mt-0">
      <h2 class="text-small font-semibold text-ink-2">{title}</h2>
      <ul class="mt-1">{pages.map((t) => <li class="py-0.5"><a class="no-underline hover:text-accent" href={href(t.path)}>{t.title}</a></li>)}</ul>
    </div>
  ) : null;

/** The topics nearest this one, as posters: the first large when there are enough to fill around it. */
const RelatedTiles = ({ site, pages, id = "nearby", title = "Related topics", wide, reading }: { site: Site; pages: Page[]; id?: string; title?: string; wide?: boolean; reading?: boolean }) => {
  const pictureOf = pictureSpreader(site);
  if (reading) return (
    <section class="mt-14" aria-labelledby={id}>
      <h2 id={id} class="text-title font-semibold">{title}</h2>
      <div class="mt-5 border-t border-line">
        {pages.map((t) => {
          const picture = pictureOf(t);
          return (
            <a class="group flex items-center gap-4 border-b border-line py-5 no-underline" href={href(t.path)}>
              <span class="min-w-0 flex-1">
                <span class="block font-display text-copy leading-snug font-semibold [overflow-wrap:anywhere] group-hover:underline">{t.title}</span>
                {t.description ? <span class="mt-1.5 line-clamp-2 font-body text-preview text-ink-2">{t.description}</span> : null}
              </span>
              {picture ? <img class="aspect-video w-20 shrink-0 rounded-tile object-cover" src={picture} alt="" loading="lazy" referrerpolicy="no-referrer" /> : null}
            </a>
          );
        })}
      </div>
    </section>
  );
  const lead = pages.length === NEARBY_SHOWN;
  return (
    <section class="mt-14 font-display" aria-labelledby={id}>
      <h2 id={id} class="text-title font-semibold">{title}</h2>
      <div class={`mt-5 grid grid-cols-2 gap-1.5 sm:grid-cols-3 ${wide ? "auto-rows-[10.5rem]" : "auto-rows-[8.5rem]"}`}>
        {pages.map((t, i) => {
          const picture = pictureOf(t);
          return (
            <a class={`tile !relative ${lead && i === 0 ? "sm:col-span-2 sm:row-span-2 sm:!p-5" : ""}`} href={href(t.path)}>
              {picture ? <img class="tile-picture" src={picture} alt="" loading="lazy" referrerpolicy="no-referrer" /> : null}
              <span class={`tile-words w-full min-w-0 truncate ${lead && i === 0 ? "sm:text-title" : ""}`} title={t.title}>{t.title}</span>
            </a>
          );
        })}
      </div>
    </section>
  );
};

/** How a citation finds its source here, and the moment nearest the second it names. */
function referenceFinder(site: Site) {
  const byUrl = new Map([...site.sources.values()].map((s) => [s.url, s]));
  return (url: string) => {
    const id = videoId(url);
    const s = id ? site.sources.get(id) : byUrl.get(url.split("#")[0]);
    if (!s) return null;
    const at = secondsIn(url);
    const near = at === null ? undefined : [...s.moments].filter((m) => Math.abs(m.at - at) <= 180).sort((a, b) => Math.abs(a.at - at) - Math.abs(b.at - at))[0];
    return { path: s.path, title: s.title, at, line: near?.text ?? (videoOf(s) ? "" : s.gist), video: videoOf(s), published: s.published, big: near?.punch ?? near?.text ?? "" };
  };
}

const citedAt = (r: Reference) => `${href(r.path)}${r.at === null ? "" : `#t=${r.at}`}`;

/** What a page cites, one group per source, oldest first as the chart reads. */
function citedSources(list: Reference[]) {
  const byPath = new Map<string, { path: string; title: string; video: string | null; published: string; refs: Reference[] }>();
  for (const r of list) {
    const group = byPath.get(r.path) ?? { path: r.path, title: r.title, video: r.video ?? null, published: r.published ?? "", refs: [] };
    group.refs.push(r);
    byPath.set(r.path, group);
  }
  return [...byPath.values()].sort((a, b) => (a.published || "9999").localeCompare(b.published || "9999")).map((g, key) => ({ ...g, key, count: g.refs.length }));
}

const WhereFrom = ({ list, site }: { list: Reference[]; site: Site }) => {
  const groups = citedSources(list);
  return list.length ? (
    <section class="mt-14 font-display" aria-labelledby="references" data-references>
      <h2 id="references" class="text-title font-semibold">Sources</h2>
      <Timeline groups={groups} site={site} />
      <div class="mt-4 border-t border-line">
        {groups.map((g) => (
          <div id={`from-${g.key}`} data-group data-timeline-key={g.key} class="scroll-mt-6 border-b border-line px-2 py-4 data-[on]:bg-panel">
            <div class="flex items-start gap-3">
              {g.video ? <a class="shrink-0" href={href(g.path)} aria-hidden="true" tabindex={-1}><img class="aspect-video w-24 rounded bg-panel object-cover" src={thumbOf(g.video)} alt="" loading="lazy" referrerpolicy="no-referrer" /></a> : null}
              <div class="min-w-0">
                <a class="font-medium no-underline hover:text-accent" href={href(g.path)} data-group-title>{g.title}</a>
                {g.published ? <p class="mt-0.5 text-small text-ink-3">{niceDate(g.published, site.settings.language)}</p> : null}
              </div>
            </div>
            <ol class="mt-3 text-small">
              {g.refs.map((r) => (
                <li id={`fn-${r.n}`} data-fn-note data-video={r.video ?? undefined} data-thumb={r.video ? thumbOf(r.video) : undefined} data-at={r.at ?? undefined} data-stamp={r.at === null ? undefined : clock(r.at)} data-to={citedAt(r)} data-path={href(r.path)} data-title={r.title} data-big={r.big || undefined} class="grid grid-cols-[1.75rem_1fr_auto] gap-x-2 py-1.5">
                  <span class="font-mono text-ink-3">{r.n}</span>
                  <span class="font-body text-ink-2" data-note-line>{r.line}</span>
                  {r.at === null ? <span /> : <a class="font-mono text-ink-3 no-underline hover:text-accent hover:underline" href={citedAt(r)} data-note-time>{clock(r.at)}</a>}
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </section>
  ) : null;
};

/** Beside the writing: the source cited where you're reading, and the section links. On a phone it opens only when a footnote is tapped. */
function ReadingRail({ list, headings }: { list: Reference[]; headings: { text: string; id: string }[] }) {
  const first = list.find((r) => r.video) ?? list[0];
  if (!first && headings.length < 2) return null;
  return (
    <aside class="topic-rail font-display text-rail" aria-label="Sources and navigation" data-reading-rail data-pagefind-ignore>
      {first ? (
        <section id="topic-evidence" class="topic-evidence flex-none scroll-mt-4 overflow-hidden rounded-tile" role="region" tabindex={-1} aria-label="Cited source" data-evidence-panel data-evidence-current={first.n}>
          <div id="topic-video" class="aspect-video overflow-hidden rounded-tile" hidden={!first.video} data-rail-frame>
            {first.video ? (
              <a class="group relative block h-full" href={citedAt(first)} aria-label={`Play ${first.title}`} data-rail-play>
                <img class="size-full object-cover" src={thumbOf(first.video)} alt="" referrerpolicy="no-referrer" data-rail-thumb />
                <span class="absolute inset-0 grid place-items-center bg-media-shade text-surface" aria-hidden="true"><svg class="size-11 rounded-full bg-tile p-2 transition-transform group-hover:scale-110" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg></span>
              </a>
            ) : null}
          </div>
          <a class="block truncate py-3.5 no-underline hover:underline" href={citedAt(first)} title={first.title} data-rail-title>{first.title}</a>
          <p class="pb-4 font-body text-evidence" hidden={!!first.video} data-rail-now data-rail-text>{first.line || first.big}</p>
          <a class="block w-fit py-1 text-small text-ink-2" href="#main" hidden data-rail-return>Back to reference</a>
        </section>
      ) : null}
      {headings.length > 1 ? (
        <nav class="hidden border-t border-line pt-3 text-small min-[52rem]:block" aria-label="Sections" data-rail-contents data-scrollspy>
          <ul>{headings.map((h) => <li><a class="block py-1.5 text-ink-2 no-underline hover:text-ink hover:underline aria-[current=true]:text-ink aria-[current=true]:underline" href={`#${h.id}`}>{h.text}</a></li>)}</ul>
        </nav>
      ) : null}
    </aside>
  );
}

export function articlePage(site: Site, p: Page): Built {
  const r = relationsOf(site, p);
  const sources = p.sourceKeys.flatMap((k) => { const s = site.sources.get(k); return s ? [s] : []; }).sort((a, b) => (b.published || "").localeCompare(a.published || ""));
  const rendered = renderWithNotes(p.body, referenceFinder(site));
  // Only what a reader can open, the closest few.
  const nearby = p.type === "topic" ? [...new Set([...r.related, ...site.nearbyOf(slugOfTopic(p)).flatMap((n) => (n.page && n.page !== p ? [n.page] : []))])].slice(0, NEARBY_SHOWN) : [];
  // Section links orient the reading; discovery cards stay at the article's end.
  const headings = [
    ...headingsOf(p.body),
    ...(rendered.references.length ? [{ text: "Sources", id: "references" }] : []),
  ];
  const hasRail = rendered.references.length > 0 || headings.length > 1;
  const cited = citedSources(rendered.references);
  const channels = [...new Set(sources.map((s) => s.channel).filter(Boolean))];
  const speakers = [...new Set(sources.flatMap((s) => s.speakers))];
  const body = (
    <Frame>
      <article class="topic-reading" data-has-rail={hasRail ? "" : undefined} data-pagefind-body>
        <meta data-pagefind-filter="type[content]" content={LABEL[p.type]} />
        {p.topic ? <meta data-pagefind-filter="topic[content]" content={p.topic} /> : null}
        {channels.map((c) => <meta data-pagefind-filter="channel[content]" content={c} />)}
        {speakers.map((s) => <meta data-pagefind-filter="speaker[content]" content={s} />)}
        <div class="topic-heading">
          <Heading title={p.title} lede={p.description} />
        </div>
        <div class="reading-column mt-8">
          <div class="prose">{raw(rendered.html)}</div>
          <div data-pagefind-ignore>
            <WhereFrom list={rendered.references} site={site} />
            {nearby.length ? <RelatedTiles site={site} pages={nearby} reading /> : null}
            <div class="mt-14 grid gap-x-10 font-display sm:grid-cols-2">
              <LinkList title="Part of" pages={r.partOf} />
              <LinkList title="In this topic" pages={r.parts} />
              <LinkList title="Broader" pages={r.broader} />
              <LinkList title="Narrower" pages={r.narrower} />
              {p.type === "topic" ? null : <LinkList title="Related" pages={r.related} />}
            </div>
          </div>
        </div>
        <ReadingRail list={rendered.references} headings={headings} />
      </article>
    </Frame>
  );
  return {
    meta: { path: p.path, title: p.title, description: p.description, image: site.shareImages?.has(p.path) && site.settings.url ? `${site.settings.url}${encodeURI(`/og${p.path}.png`)}` : cited.find((g) => g.video)?.video ? thumbOf(cited.find((g) => g.video)!.video as string) : undefined, noindex: !p.indexable, jsonLd: [articleLd(site, p), crumbs(site, [[TITLES[p.type], `/${PLURAL[p.type]}`], [p.title, p.path]])] },
    body,
  };
}
const slugOfTopic = (p: Page) => (p.topic ? slugOf(p.topic) : p.slug);

/** Only YouTube's own hosts, and an id that is only an id. */

function videoLd(site: Site, s: Source, id: string) {
  const picks = [...s.moments.filter((m) => m.strong), ...s.moments.filter((m) => !m.strong)].slice(0, 12).sort((a, b) => a.at - b.at);
  return {
    "@context": "https://schema.org", "@type": "VideoObject", name: s.title, description: s.gist.slice(0, 300), thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    ...(s.published ? { uploadDate: s.published } : {}), embedUrl: `https://www.youtube-nocookie.com/embed/${id}`, contentUrl: s.url,
    hasPart: picks.map((m) => ({ "@type": "Clip", name: m.text.slice(0, 90), startOffset: m.at, url: `${s.url}&t=${m.at}s` })),
  };
}

/** A sentence or two for search results, cut at a word. */
function shortened(text: string, max = 160) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

/** Under the video: a row to open every highlight, and the one you've reached in the read, large, in the same spot. */
function MomentsRail({ source, url }: { source: Source; url: string | null }) {
  const link = (at: number) => (!url ? undefined : `${url}${url.includes("?") ? "&" : "?"}t=${at}s`);
  const first = source.moments.find((m) => m.strong) ?? source.moments[0];
  const partOf = (at: number) => source.read.filter((p) => p.at !== null && (p.at as number) <= at).at(-1) ?? source.read.find((p) => p.at !== null);
  return (
    <div class="lg:pt-[clamp(2.5rem,calc(24vh-6.5rem),9rem)]">
      <div class="relative">
        <a class="absolute top-0 right-0 hidden font-mono text-small text-ink-3 no-underline hover:text-accent hover:underline lg:block" rel="noopener" data-seek={first.at} data-moment-time data-swap-hide href={link(first.at)}>{clock(first.at)}</a>
        <details class="mt-4 text-small lg:mt-0" data-moments data-swap>
        <summary class="w-fit cursor-pointer list-none text-ink-2 hover:text-ink hover:underline [&::-webkit-details-marker]:hidden">All {source.moments.length} highlights</summary>
        <ol class="mt-2 max-h-72 overflow-y-auto border-t border-line lg:max-h-[calc(86vh-27rem)]" data-moment-list>
          {source.moments.map((m) => {
            const part = partOf(m.at);
            const words = <span class={m.strong ? "font-semibold" : "text-ink-2"}>{m.text}</span>;
            return (
              <li data-moment data-at={m.at} data-strong={m.strong ? "" : undefined} data-punch={m.punch} class="grid grid-cols-[3.25rem_1fr] gap-x-2 border-b border-line px-1.5 py-2 hover:bg-panel">
                <a class="font-mono text-ink-3 no-underline hover:text-accent hover:underline" rel="noopener" data-seek={m.at} href={link(m.at)}>{clock(m.at)}</a>
                {part ? <a class="no-underline" href={`#at-${part.at}`} data-go={m.at}>{words}</a> : words}
              </li>
            );
          })}
        </ol>
        </details>
        <figure class="mt-5 hidden lg:block" data-moment-now data-swap-hide data-pagefind-ignore>
          <blockquote class="moment-big" data-moment-text>{first.punch ?? first.text}</blockquote>
        </figure>
      </div>
    </div>
  );
}

/** The read, with who's talking as a small mark beside their words instead of a name in every line. */
function ReadParts({ source, url }: { source: Source; url: string | null }) {
  const voices = new Map<string, number>();
  const seen = new Set<string>();
  let current = "";
  return (
    <>
      {source.read.map((part, i) => {
        const until = source.read[i + 1]?.at ?? Infinity;
        const breathers = part.at === null ? [] : source.moments.filter((m) => m.strong && m.at >= (part.at as number) && m.at < until);
        const turns = turnsOf(part.text, source.speakers, current);
        current = turns[turns.length - 1]?.speaker ?? current;
        return (
          <div data-part={part.at ?? undefined} id={part.at === null ? undefined : `at-${part.at}`} class="relative mt-6">
            {part.at === null ? <span class="mb-1.5 block font-display text-small text-ink-3">{part.label}</span> : <a class={`mb-1.5 block w-fit font-mono text-small text-ink-3 no-underline hover:text-accent hover:underline lg:absolute lg:top-1 lg:right-full lg:mb-0 lg:rotate-180 lg:leading-none lg:[writing-mode:vertical-rl] ${turns.some((t) => t.speaker) ? "lg:mr-10" : "lg:mr-3"}`} rel="noopener" data-seek={part.at} href={url ? `${url}${url.includes("?") ? "&" : "?"}t=${part.at}s` : undefined}>{clock(part.at)}</a>}
            <div class="min-w-0 space-y-4">
              {turns.map((turn) => {
                if (!turn.speaker) return <div class="prose min-w-0">{raw(toHtml(turn.paragraphs.join("\n\n")))}</div>;
                if (!voices.has(turn.speaker)) voices.set(turn.speaker, voices.size);
                const first = !seen.has(turn.speaker);
                seen.add(turn.speaker);
                return (
                  <div class="relative grid grid-cols-[2.25rem_1fr] gap-x-3 lg:block">
                    <span class="avatar lg:absolute lg:top-1 lg:right-full lg:mr-2 lg:size-7 lg:text-[0.75rem]" data-voice={Math.min(voices.get(turn.speaker) ?? 0, 2)} title={turn.speaker} aria-hidden="true">{initialsOf(turn.speaker)}</span>
                    <div class="min-w-0">
                      <span class={first ? "mb-0.5 block font-display text-small font-semibold text-ink-2" : "sr-only"}>{turn.speaker}</span>
                      <div class="prose min-w-0">{raw(toHtml(turn.paragraphs.join("\n\n")))}</div>
                    </div>
                  </div>
                );
              })}
              {breathers.map((m) => <p class="moment-big my-3 lg:hidden" data-pagefind-ignore>{m.punch ?? m.text}</p>)}
            </div>
          </div>
        );
      })}
    </>
  );
}

export function sourcePage(site: Site, s: Source): Built {
  const id = videoOf(s);
  const url = safeHref(s.url);
  const pages = [...new Set(s.citedBy)];
  const who = s.speakers.join(", ");
  // Other videos the same topics draw on, the most shared first.
  const shared = new Map<Source, number>();
  for (const p of pages) for (const o of p.sourceKeys.flatMap((k) => { const x = site.sources.get(k); return x ? [x] : []; })) if (o !== s) shared.set(o, (shared.get(o) ?? 0) + 1);
  const alike = [...shared.keys()].sort((a, b) => (shared.get(b) ?? 0) - (shared.get(a) ?? 0) || (b.published || "").localeCompare(a.published || "")).slice(0, ALIKE_SHOWN);
  const description = shortened(s.gist.length >= 50 ? s.gist.replace(/\s+/g, " ") : `${s.title}${s.channel ? ` by ${s.channel}` : ""}: highlights and the ${site.settings.name} pages written from it.`);
  return {
    meta: { path: s.path, title: s.title, description, image: id ? thumbOf(id) : undefined, noindex: !s.indexable, jsonLd: s.indexable && id ? [videoLd(site, s, id)] : [] },
    body: (
      <>
      <Frame>
        <article class="lg:max-xl:pl-12 xl:max-[1399px]:pl-5" data-pagefind-body>
          <meta data-pagefind-filter="type[content]" content="Source" />
          {s.channel ? <meta data-pagefind-filter="channel[content]" content={s.channel} /> : null}
          {s.speakers.map((n) => <meta data-pagefind-filter="speaker[content]" content={n} />)}
          <div class="max-w-heading">
            <Heading title={s.title} />
            <p class="mt-4 font-display text-small text-ink-2">{[s.channel, s.published ? dated(site, s.published) : "", who ? `with ${who}` : ""].filter(Boolean).join(" · ")}</p>
          </div>
          <div class="reading-layout mt-8">
            <aside class="font-display lg:sticky lg:top-6 lg:col-start-2 lg:row-start-1 lg:flex lg:h-[calc(100vh-9.5rem)] lg:min-h-[28rem] lg:flex-col lg:self-start lg:overflow-y-auto" data-pagefind-ignore>
              {id ? <iframe id="player" data-video={id} class="aspect-video w-full" loading="lazy" src={`https://www.youtube-nocookie.com/embed/${id}`} title={s.title} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" referrerpolicy="strict-origin-when-cross-origin" /> : url ? <p><a rel="noopener" href={url}>Read the original</a></p> : null}
              {s.moments.length ? <MomentsRail source={s} url={url} /> : null}
            </aside>
            <div class="reading-column mt-8 lg:col-start-1 lg:row-start-1 lg:mt-0">
                {s.gist ? <div class="font-body text-lede [&>p+p]:mt-4">{s.gist.split(/\n\s*\n/).map((p) => <p>{p}</p>)}</div> : null}
                {s.read.length ? (
                  <section class="mt-12" aria-labelledby="read">
                    <h2 id="read" class="text-title font-semibold">Read it</h2>
                    <ReadParts source={s} url={url} />
                  </section>
                ) : null}
            </div>
          </div>
        </article>
      </Frame>
      {pages.length || alike.length ? (
        <Frame>
          <div data-pagefind-ignore>
            {pages.length ? <RelatedTiles site={site} pages={pages} id="related" title="Related" wide /> : null}
            {alike.length ? (
              <section class="mt-16 font-display" aria-labelledby="alike">
                <h2 id="alike" class="text-title font-semibold">More like this</h2>
                <div class="mt-5 grid grid-cols-1 gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">{alike.map((o) => <SourceCard site={site} s={o} />)}</div>
              </section>
            ) : null}
          </div>
        </Frame>
      ) : null}
      </>
    ),
  };
}

/** Every source with a page, newest first, each with the start of its gist. */
export function sourcesPage(site: Site): Built {
  const list = [...site.sources.values()].filter((s) => s.citedBy.length || s.moments.length).sort((a, b) => (b.published || "").localeCompare(a.published || ""));
  const description = `The gist and strongest highlights of every video and page on ${site.settings.name}.`;
  const channels = [...new Set(list.map((s) => s.channel).filter(Boolean))];
  const [lead, ...rest] = list;
  const leadVideo = lead && videoOf(lead);
  // The featured source says little: one big line of theirs, and the topics it feeds.
  const strongest = lead?.moments.filter((m) => m.strong).sort((a, b) => (a.punch ?? a.text).length - (b.punch ?? b.text).length)[0];
  const leadLine = strongest ? { text: strongest.punch ?? strongest.text, to: `${href(lead.path)}#t=${strongest.at}` } : null;
  const leadTopics = lead ? [...new Set(lead.citedBy)].filter((p) => p.type === "topic").slice(0, LEAD_SOURCE_TOPICS) : [];
  return {
    meta: { path: "/sources", title: "Sources", description, noindex: !list.some((s) => s.indexable) },
    body: (
      <Frame>
        <Heading title="Sources" />
        {channels.length > 1 ? (
          <div class="mt-6 hidden flex-wrap gap-2 font-display text-small" data-filters>
            <button type="button" class="filter" aria-pressed="true" data-filter="">All</button>
            {channels.map((c) => <button type="button" class="filter" aria-pressed="false" data-filter={c}>{c}</button>)}
          </div>
        ) : null}
        {lead ? (
          <div class="mt-8 grid grid-cols-1 items-center gap-x-10 gap-y-5 font-display lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]" data-card data-channel={lead.channel || undefined}>
            <a href={href(lead.path)} class="group block aspect-video overflow-hidden rounded-xl bg-tile" aria-label={lead.title}>
              {leadVideo ? <img class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]" src={thumbOf(leadVideo)} alt="" referrerpolicy="no-referrer" /> : null}
            </a>
            <div class="min-w-0">
              <a href={href(lead.path)} class="line-clamp-2 text-title font-semibold no-underline hover:text-accent">{lead.title}</a>
              <p class="mt-2 truncate text-small text-ink-3">{[lead.channel, dated(site, lead.published)].filter(Boolean).join(" · ")}</p>
              {leadLine ? <a href={leadLine.to} class="moment-big mt-6 block no-underline hover:text-accent">{leadLine.text}</a> : lead.gist ? <p class="mt-5 line-clamp-2 font-body text-ink-2">{lead.gist}</p> : null}
              {leadTopics.length ? (
                <ul class="mt-6 flex flex-wrap gap-2 text-small">
                  {leadTopics.map((p) => <li><a class="filter inline-block max-w-full truncate no-underline" href={href(p.path)}>{p.title}</a></li>)}
                </ul>
              ) : null}
            </div>
          </div>
        ) : null}
        {rest.length ? <div class={`mt-14 grid grid-cols-1 gap-x-6 gap-y-10 font-display sm:grid-cols-2 ${rest.length === 2 || rest.length === 4 ? "" : "lg:grid-cols-3"}`}>{rest.map((s) => <SourceCard site={site} s={s} gist />)}</div> : null}
      </Frame>
    ),
  };
}

/** Every page as a poster with its title on it, and a line below. */
const PageRows = ({ site, pages }: { site: Site; pages: Page[] }) => {
  const pictureOf = pictureSpreader(site);
  return (
    <ul class="mt-6 grid grid-cols-1 gap-x-5 gap-y-8 font-display sm:grid-cols-2 lg:grid-cols-3">
      {pages.map((p) => {
        const picture = pictureOf(p);
        return (
          <li class="min-w-0">
            <a href={href(p.path)} class="group block no-underline">
              <span class="tile !relative aspect-video rounded-lg">
                {picture ? <img class="tile-picture" src={picture} alt="" loading="lazy" referrerpolicy="no-referrer" /> : null}
                <span class="tile-words w-full truncate" title={p.title}>{p.title}</span>
              </span>
              <span class="mt-2.5 line-clamp-2 font-body text-small text-ink-2">{p.description}</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
};

const Arrow = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);

/** One big line on the dark band, its video fading in behind, going to its second in the video. */
const QuoteBand = ({ line }: { line: Line }) => (
  <section class="band mt-16" aria-label="Highlight">
    {line.video ? <img class="band-picture" src={thumbOf(line.video)} alt="" loading="lazy" referrerpolicy="no-referrer" /> : null}
    <a class="group relative mx-auto block max-w-wide px-4 py-20 font-display text-tile-ink no-underline sm:px-8 lg:py-28" href={line.to}>
      <span class="block font-body text-[7rem] leading-[0.5] text-tile-ink/40" aria-hidden="true">&ldquo;</span>
      <span class="mt-2 block max-w-4xl text-[clamp(2rem,4.6vw,3.75rem)] leading-[1.08] font-bold tracking-tight text-balance">{line.text}</span>
      <span class="mt-10 flex max-w-xl items-center gap-4">
        <span class="flex size-12 shrink-0 items-center justify-center rounded-full border border-tile-ink/40 transition-colors group-hover:border-tile-ink group-hover:bg-tile-ink group-hover:text-tile"><Arrow /></span>
        <span class="min-w-0 truncate text-tile-ink/80 group-hover:text-tile-ink" title={line.from}>{line.from}</span>
      </span>
    </a>
  </section>
);

type Line = { text: string; to: string; video?: string; from: string };

/** Shows a source's picks one round at a time, so no one video fills a list. */
function linesAcross(sources: Source[], used: Set<string>, keep: (m: Source["moments"][number]) => boolean) {
  const lists = sources.map((s) => s.moments.filter(keep).map((m) => ({ text: m.punch ?? m.text, to: `${href(s.path)}#t=${m.at}`, video: videoOf(s), from: s.title })));
  const out: Line[] = [];
  for (let round = 0; lists.some((l) => l[round]); round++) for (const l of lists) if (l[round] && !used.has(l[round].text)) out.push(l[round]);
  return out;
}

/** Every topic under its subject: plain and quick to scan, the pictures being above. */
const TopicList = ({ site, pages }: { site: Site; pages: Page[] }) => {
  const placed = new Set<Page>();
  const groups = site.groups.map((g) => {
    const members = g.topics.flatMap((t) => (t.page && !placed.has(t.page) ? [t.page] : []));
    for (const p of members) placed.add(p);
    return { name: g.name, pages: members };
  }).filter((g) => g.pages.length);
  const rest = pages.filter((p) => !placed.has(p));
  const all = [...groups, ...(rest.length ? [{ name: groups.length ? "More" : "", pages: rest }] : [])];
  return (
    <div class="mt-6 font-display">
      {all.map((g) => (
        <section class="grid grid-cols-1 gap-x-8 border-t border-line py-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
          {g.name ? <h3 class="pb-3 font-semibold text-ink-2 first-letter:uppercase lg:pb-0">{g.name}</h3> : <span />}
          <ul class="grid grid-cols-1 gap-x-10 gap-y-5 md:grid-cols-2">
            {g.pages.map((p) => (
              <li class="min-w-0">
                <a href={href(p.path)} class="group block no-underline">
                  <span class="block truncate font-semibold group-hover:text-accent" title={p.title}>{p.title}</span>
                  <span class="mt-0.5 line-clamp-2 font-body text-small text-ink-2">{p.description}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
};

export function listPage(site: Site, type: PageType): Built {
  const pages = site.pages.filter((p) => p.type === type);
  const meta = { path: `/${PLURAL[type]}`, title: TITLES[type], description: `${TITLES[type]} on ${site.settings.name}. Each is written from the highlights of its sources.`, noindex: !pages.some((p) => p.indexable) };
  if (type !== "topic") {
    return { meta, body: <Frame><Heading title={TITLES[type]} />{pages.length ? <PageRows site={site} pages={pages} /> : <p class="mt-8">Nothing here yet.</p>}</Frame> };
  }
  const mapPicture = pictureSpreader(site);
  const shown = [...site.sources.values()].filter((s) => s.citedBy.length || s.moments.length).sort((a, b) => (b.published || "").localeCompare(a.published || ""));
  const line = linesAcross(shown, new Set(), (m) => m.strong && (m.punch ?? m.text).length <= WALL_LONGEST)[0];
  return {
    meta,
    body: (
      <>
        <Frame>
          <Heading title={TITLES[type]} />
          {site.topics.filter((t) => t.page).length >= MAP_MIN ? <div class="mt-10"><TopicMap groups={site.groups} pictureOf={mapPicture} /></div> : null}
        </Frame>
        {line ? <QuoteBand line={line} /> : null}
        <Frame>
          <div class="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
            <h2 class="font-display text-title font-semibold">Every topic</h2>
            <a href="/search" data-palette-open data-palette-scope="Topic" class="flex w-full items-center gap-3 rounded-xl border border-line-strong bg-surface px-4 py-3 font-display text-ink-2 no-underline shadow-sm transition-colors hover:border-ink hover:text-ink sm:w-96">
              <SearchIcon size={18} />
              <span class="flex-1">Search topics</span>
            </a>
          </div>
          {pages.length ? <TopicList site={site} pages={pages} /> : <p class="mt-8">Nothing here yet.</p>}
        </Frame>
      </>
    ),
  };
}

/** A topic's best line not used yet: a pick where there is one, from the newest video that has it. */
function topicLine(t: TopicRow, sources: Source[], used: Set<string>) {
  const lines = sources.flatMap((s) => s.moments.filter((m) => m.topics.some((x) => slugOf(x) === t.slug)));
  const ordered = [...lines.filter((m) => m.strong), ...lines.filter((m) => !m.strong)].map((m) => m.punch ?? m.text);
  const line = ordered.find((l) => !used.has(l)) ?? t.page?.description ?? "";
  used.add(line);
  return line;
}

export function homePage(site: Site): Built {
  const { name, about } = site.settings;
  const description = about.length >= 50 ? about : `${name}: what the sources say on each subject, who said it and when. For recordings, you can play the moment each point was said.`;
  const written = [...site.topics.filter((t) => t.page)].sort((a, b) => b.sources - a.sources || b.moments - a.moments);
  const shown = [...site.sources.values()].filter((s) => s.citedBy.length || s.moments.length).sort((a, b) => (b.published || "").localeCompare(a.published || ""));
  const guides = site.pages.filter((p) => p.type === "guide").slice(0, 6);
  const sourcesOf = (t: TopicRow) => site.entriesOf(t.slug).flatMap((e) => { const s = site.sources.get(e.sourceKey); return s && shown.includes(s) ? [{ s, n: e.moments }] : []; }).sort((a, b) => (b.s.published || "").localeCompare(a.s.published || ""));
  // The picture: the fullest topics and the newest videos they touch.
  // On a large site: the videos those topics share most, so every line drawn is a busy one.
  const fullest = written.slice(0, RELATION_TOPICS).filter((t) => sourcesOf(t).length);
  const reach = new Map<Source, number>();
  for (const t of fullest) for (const x of sourcesOf(t)) reach.set(x.s, (reach.get(x.s) ?? 0) + 1);
  const mapVideos = [...reach.keys()].sort((a, b) => (reach.get(b) ?? 0) - (reach.get(a) ?? 0) || (b.published || "").localeCompare(a.published || "")).slice(0, RELATION_VIDEOS);
  const mapTopics = fullest.filter((t) => sourcesOf(t).some((x) => mapVideos.includes(x.s)));
  const links = mapTopics.flatMap((t, ti) => sourcesOf(t).flatMap((x) => { const v = mapVideos.indexOf(x.s); return v < 0 ? [] : [{ t: ti, v, n: x.n }]; }));
  const noteOf = (s: Source) => [s.channel, dated(site, s.published)].filter(Boolean).join(" · ");
  // Lead topics: each with a picture and a line no other uses.
  const usedLines = new Set<string>();
  // The newest video has its own large spot further down.
  const usedVideos = new Set<string>(shown[0] && videoOf(shown[0]) ? [videoOf(shown[0]) as string] : []);
  const leads = written.slice(0, written.length >= LEAD_TOPICS ? LEAD_TOPICS : written.length).map((t) => {
    const from = sourcesOf(t).map((x) => x.s);
    const videos = from.flatMap((s) => { const v = videoOf(s); return v ? [v] : []; });
    const video = videos.find((v) => !usedVideos.has(v)) ?? videos[0];
    if (video) usedVideos.add(video);
    return { path: t.page!.path, title: t.page!.title, line: topicLine(t, from, usedLines), video };
  });
  // Big lines, spread across the videos, none shown twice. They change when new sources come in.
  const short = (m: Source["moments"][number]) => m.strong && (m.punch ?? m.text).length <= WALL_LONGEST;
  const band = linesAcross(shown, usedLines, short)[0];
  if (band) usedLines.add(band.text);
  const wallPicks = linesAcross(shown, usedLines, (m) => m.strong);
  const wall = [...wallPicks, ...linesAcross(shown, usedLines, (m) => !m.strong && (m.punch ?? m.text).length <= WALL_LONGEST)].slice(0, WALL_LINES);
  for (const w of wall) usedLines.add(w.text);
  // About one in four shows as a poster, each with a different video.
  const posterVideos = new Set<string>();
  const posters = new Set(wall.filter((w, i) => {
    if (!w.video || posterVideos.has(w.video) || w.text.length > WALL_LONGEST || i % WALL_POSTER_EVERY === 0) return false;
    if (posterVideos.size * WALL_POSTER_EVERY > i) return false;
    posterVideos.add(w.video);
    return true;
  }));
  // Among the plain lines, every third sits on colour.
  const coloured = new Set(wall.filter((w) => !posters.has(w)).filter((_, i) => i % WALL_COLOUR_EVERY === 1));
  // A few more topics, each with one short line.
  const spotVideos = new Set<string>();
  const spotlights = (written.length > LEAD_TOPICS ? written.slice(LEAD_TOPICS) : []).slice(0, SPOTLIGHTS).map((t) => {
    const from = sourcesOf(t).map((x) => x.s);
    const lines = linesAcross(from, usedLines, (m) => m.topics.some((x) => slugOf(x) === t.slug) && (m.punch ?? m.text).length <= WALL_LONGEST).slice(0, 1);
    for (const l of lines) usedLines.add(l.text);
    const videos = from.flatMap((s) => { const v = videoOf(s); return v ? [v] : []; });
    const video = videos.find((v) => !usedVideos.has(v)) ?? videos.find((v) => !spotVideos.has(v)) ?? videos[0];
    if (video) spotVideos.add(video);
    return { path: t.page!.path, title: t.page!.title, video, lines };
  }).filter((t) => t.lines.length);
  // The top line changes each visit, from whatever the page doesn't already show.
  const toHero = (l: Line) => (l.video ? [{ text: l.text, thumb: thumbOf(l.video), to: l.to }] : []);
  const heroLeft = linesAcross(shown, usedLines, short).flatMap(toHero);
  const picks = (heroLeft.length ? heroLeft : linesAcross(shown, new Set(), (m) => m.strong).flatMap(toHero)).slice(0, HERO_PICKS);
  const [latest, ...others] = shown;
  const headline = about && about.length <= 110 ? about : name;
  const SectionHead = ({ id, title, to, link, note }: { id: string; title: string; to?: string; link?: string; note?: string }) => (
    <div class="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 font-display">
      <h2 id={id} class="text-title font-semibold">{title}</h2>
      {note ? <p class="text-small text-ink-3">{note}</p> : null}
      {to ? <a class="text-small text-ink-2 no-underline hover:text-ink hover:underline" href={to}>{link}</a> : null}
    </div>
  );
  return {
    meta: { path: "/", description: description.slice(0, 160), image: picks[0]?.thumb, jsonLd: [{ "@context": "https://schema.org", "@type": "WebSite", name, ...(site.settings.url ? { url: site.settings.url } : {}) }] },
    body: (
      <>
        <section class="hero" data-hero={picks.length ? "" : undefined} data-picks={picks.length ? JSON.stringify(picks) : undefined}>
          {picks.length ? <img class="hero-picture" src={picks[0].thumb} alt="" referrerpolicy="no-referrer" data-hero-thumb /> : null}
          <div class="relative mx-auto flex min-h-[28rem] max-w-wide flex-col justify-end px-4 py-14 font-display sm:px-8 lg:min-h-[34rem] lg:py-20">
            <h1 class={picks.length ? "sr-only" : "max-w-3xl text-[clamp(2.1rem,4.2vw,3.4rem)] leading-[1.06] font-extrabold tracking-tight text-balance"}>{headline}</h1>
            {picks.length ? (
              <a class="group block max-w-3xl text-tile-ink no-underline" href={picks[0].to} data-hero-link>
                <span class="block text-[clamp(2.25rem,4.8vw,4rem)] leading-[1.05] font-extrabold tracking-tight text-balance" data-hero-text>{picks[0].text}</span>
                <span class="mt-8 flex size-14 items-center justify-center rounded-full border border-tile-ink/45 transition-colors group-hover:border-tile-ink group-hover:bg-tile-ink group-hover:text-ink"><Arrow /></span>
              </a>
            ) : null}
          </div>
        </section>
        <Frame>
          {site.pages.length ? null : <p class="mt-8 max-w-read">Nothing here yet.</p>}
          {leads.length ? (
            <section aria-labelledby="topics">
              <SectionHead id="topics" title="Topics" to="/topics" link="All topics" />
              <div class={`mt-5 grid auto-rows-[11rem] grid-cols-2 gap-1.5 font-display ${leads.length >= LEAD_TOPICS ? "lg:grid-cols-4" : ""}`}>
                {leads.map((c, i) => (
                  <a class={`tile !relative ${i === 0 && leads.length >= LEAD_TOPICS ? "col-span-2 row-span-2 !p-6" : ""}`} href={href(c.path)}>
                    {c.video ? <img class="tile-picture" src={thumbOf(c.video)} alt="" loading="lazy" referrerpolicy="no-referrer" /> : null}
                    <span class="tile-words w-full min-w-0">
                      <span class={`block truncate ${i === 0 && leads.length >= LEAD_TOPICS ? "text-title" : ""}`} title={c.title}>{c.title}</span>
                      {i === 0 && leads.length >= LEAD_TOPICS && c.line ? <span class="mt-2 block font-body text-lede font-normal text-tile-ink">{c.line}</span> : null}
                    </span>
                  </a>
                ))}
              </div>
            </section>
          ) : null}
        </Frame>
        {band ? <QuoteBand line={band} /> : null}
        <Frame>
          {mapTopics.length >= RELATION_MIN && mapVideos.length >= RELATION_MIN ? (
            <section class="hidden lg:block" aria-labelledby="connects">
              <div class="mb-10"><SectionHead id="connects" title="Topics and videos" note={`${shown.length} videos · ${written.length} topics`} /></div>
              <RelationMap
                topics={mapTopics.map((t) => ({ title: t.page!.title, path: t.page!.path }))}
                videos={mapVideos.map((s) => { const v = videoOf(s); return { title: s.title, path: s.path, thumb: v ? thumbOf(v) : undefined, note: noteOf(s) }; })}
                links={links}
              />
            </section>
          ) : null}
          {wall.length >= WALL_MIN ? (
            <section class="mt-20 font-display" aria-labelledby="highlights">
              <SectionHead id="highlights" title="Highlights" />
              <div class="mt-5 columns-1 gap-4 sm:columns-2 lg:columns-3">
                {wall.map((w) => (posters.has(w) && w.video ? (
                  <a href={w.to} class="tile !relative mb-4 min-h-64 break-inside-avoid rounded-xl !p-6">
                    <img class="tile-picture" src={thumbOf(w.video)} alt="" loading="lazy" referrerpolicy="no-referrer" />
                    <span class="tile-words !text-[1.5rem]">{w.text}</span>
                  </a>
                ) : (
                  <a href={w.to} class={`mb-4 block break-inside-avoid rounded-xl p-6 text-[1.3rem] leading-snug font-semibold tracking-tight no-underline transition-colors ${coloured.has(w) ? "bg-tile text-tile-ink hover:bg-accent" : "hover:text-accent"}`}>{w.text}</a>
                )))}
              </div>
            </section>
          ) : null}
          {spotlights.length ? (
            <section class="mt-20 font-display" aria-labelledby="more-topics">
              <SectionHead id="more-topics" title="More topics" to="/topics" link="All topics" />
              <div class="mt-6 grid grid-cols-1 gap-y-10">
                {spotlights.map((t, i) => (
                  <div class="grid min-w-0 grid-cols-1 items-center gap-x-12 gap-y-5 md:grid-cols-2">
                    <a href={href(t.path)} class={`tile !relative aspect-video !p-5 ${i % 2 ? "md:order-2" : ""}`}>
                      {t.video ? <img class="tile-picture" src={thumbOf(t.video)} alt="" loading="lazy" referrerpolicy="no-referrer" /> : null}
                      <span class="tile-words w-full min-w-0 truncate !text-[1.375rem]" title={t.title}>{t.title}</span>
                    </a>
                    <a class="group block no-underline" href={t.lines[0].to}>
                      <span class="block font-body text-[4.5rem] leading-[0.5] text-ink-3/50" aria-hidden="true">&ldquo;</span>
                      <span class="mt-1 block max-w-xl text-[clamp(1.5rem,2.4vw,2rem)] leading-[1.15] font-bold tracking-tight text-balance group-hover:text-accent">{t.lines[0].text}</span>
                      <span class="mt-6 flex size-11 items-center justify-center rounded-full border border-line-strong transition-colors group-hover:border-ink group-hover:bg-ink group-hover:text-canvas"><Arrow /></span>
                    </a>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
          {latest ? (
            <section class="mt-20 font-display first:mt-0" aria-labelledby="newest">
              <SectionHead id="newest" title="Newest sources" to="/sources" link="All sources" />
              <div class="mt-5 grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
                <SourceCard site={site} s={latest} gist />
                {others.length ? (
                  <ul class="border-t border-line">
                    {others.slice(0, NEWEST_LISTED).map((s) => {
                      const v = videoOf(s);
                      return (
                        <li class="border-b border-line">
                          <a href={href(s.path)} class="group flex items-center gap-3.5 py-3 no-underline">
                            {v ? <img class="aspect-video w-28 shrink-0 rounded bg-panel object-cover" src={smallOf(v)} alt="" loading="lazy" referrerpolicy="no-referrer" /> : null}
                            <span class="min-w-0">
                              <span class="block truncate text-small font-medium group-hover:text-accent" title={s.title}>{s.title}</span>
                              <span class="mt-0.5 block truncate text-[0.8125rem] text-ink-3">{noteOf(s)}</span>
                            </span>
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
            </section>
          ) : null}
          {guides.length ? (
            <section class="mt-20 font-display" aria-labelledby="guides">
              <SectionHead id="guides" title="Guides" to="/guides" link="All guides" />
              <ul class="mt-3 border-t border-line">{guides.map((p) => <li class="border-b border-line py-3"><a class="block no-underline hover:text-accent" href={href(p.path)}>{p.title}<span class="block text-small text-ink-2">{p.description}</span></a></li>)}</ul>
            </section>
          ) : null}
        </Frame>
      </>
    ),
  };
}

export function searchPage(site: Site): Built {
  const script = `window.addEventListener("DOMContentLoaded",function(){if(!window.PagefindUI){document.getElementById("search").textContent="Search is ready once the site is built.";return}var ui=new PagefindUI({element:"#search",showSubResults:true,showImages:false,resetStyles:false,processResult:function(r){var clean=function(u){return u.replace(/\.html(?=$|[#?])/,"")};r.url=clean(r.url);(r.sub_results||[]).forEach(function(s){s.url=clean(s.url)});return r}});var q=new URLSearchParams(location.search).get("q");if(q)ui.triggerSearch(q)});`;
  return {
    meta: {
      path: "/search", title: "Search", description: `Search everything on ${site.settings.name} by topic, speaker, channel and page type.`, noindex: true,
      head: <><link rel="stylesheet" href="/pagefind/pagefind-ui.css" /><script src="/pagefind/pagefind-ui.js" /><script>{raw(script)}</script></>,
    },
    body: (
      <Frame>
        <Heading title="Search" />
        <div id="search" class="mt-8 max-w-read font-display"><noscript>Search needs JavaScript. Every page is also listed under <a href="/topics">Topics</a>.</noscript></div>
      </Frame>
    ),
  };
}

export function newPage(site: Site): Built {
  const pages = site.pages.filter((p) => p.updated);
  const sources = [...site.sources.values()].filter((s) => s.published && (s.citedBy.length || s.moments.length));
  const entries = [
    ...pages.map((p) => ({ date: p.updated as string, title: p.title, path: p.path, kind: p.updated === p.first ? LABEL[p.type] : `Updated ${LABEL[p.type].toLowerCase()}`, line: p.description, page: p, source: undefined as Source | undefined })),
    ...sources.map((s) => ({ date: s.published, title: s.title, path: s.path, kind: videoOf(s) ? "Video" : "Source", line: (s.moments.find((m) => m.strong)?.punch ?? s.channel) || "", page: undefined as Page | undefined, source: s })),
  ].sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title)).slice(0, NEW_SHOWN);
  const pictureOf = (() => { const pick = pictureSpreader(site); const chosen = new Map<Page, string | undefined>(); return (p: Page) => { if (!chosen.has(p)) chosen.set(p, pick(p)); return chosen.get(p); }; })();
  const days = [...new Set(entries.map((e) => e.date))];
  const description = `New and updated pages and sources on ${site.settings.name}, newest first.`;
  return {
    meta: { path: "/new", title: "What's new", description, noindex: !pages.length },
    body: (
      <Frame>
        <Heading title="What's new" />
        {entries.length ? (
          <div class="mt-10 font-display">
            {days.map((day) => (
              <section class="grid grid-cols-1 gap-x-8 md:grid-cols-[9rem_minmax(0,1fr)]">
                <h2 class="self-start pb-3 font-mono text-small text-ink-2 md:sticky md:top-6 md:pt-1 md:pb-0">{dated(site, day)}</h2>
                <ol class="timeline-day pb-10">
                  {entries.filter((e) => e.date === day).map((e) => {
                    const video = e.source && videoOf(e.source);
                    return (
                      <li class="timeline-entry">
                        <a href={href(e.path)} class="group grid grid-cols-1 items-center gap-x-5 gap-y-3 no-underline sm:grid-cols-[17rem_minmax(0,1fr)]">
                          {video ? <img class="aspect-video w-full rounded-lg bg-panel object-cover" src={thumbOf(video)} alt="" loading="lazy" referrerpolicy="no-referrer" /> : <span class="tile !relative aspect-video w-full rounded-lg !p-3">{e.page && pictureOf(e.page) ? <img class="tile-picture" src={pictureOf(e.page)} alt="" loading="lazy" referrerpolicy="no-referrer" /> : null}<span class="tile-words w-full !text-copy" title={e.title}>{e.title}</span></span>}
                          <span class="min-w-0">
                            <span class="block text-small text-ink-3">{e.kind}</span>
                            {video ? <span class="mt-1 block text-copy font-semibold group-hover:text-accent" title={e.title}>{e.title}</span> : null}
                            {e.line ? <span class="mt-2 line-clamp-2 font-body text-preview text-ink-2">{e.line}</span> : null}
                          </span>
                        </a>
                      </li>
                    );
                  })}
                </ol>
              </section>
            ))}
          </div>
        ) : <p class="mt-8">Nothing yet.</p>}
      </Frame>
    ),
  };
}

export function notFoundPage(): Built {
  return {
    meta: { path: "/404", title: "Page not found", description: "This page does not exist.", noindex: true },
    body: <Frame><Heading title="Page not found" lede="This page may have moved." /><p class="mt-6"><a href="/topics">See every topic</a>, or <a href="/search">search</a>.</p></Frame>,
  };
}

/** Every path the site has, and how to build it. */
export function routesOf(site: Site): Map<string, () => Built> {
  const routes = new Map<string, () => Built>([
    ["/", () => homePage(site)],
    ["/search", () => searchPage(site)],
    ["/new", () => newPage(site)],
    ["/topics", () => listPage(site, "topic")],
  ]);
  for (const type of ["guide", "speaker", "channel"] as PageType[]) if (site.pages.some((p) => p.type === type)) routes.set(`/${PLURAL[type]}`, () => listPage(site, type));
  for (const p of site.pages) routes.set(p.path, () => articlePage(site, p));
  const sources = [...site.sources.values()].filter((s) => s.citedBy.length || s.moments.length);
  if (sources.length) routes.set("/sources", () => sourcesPage(site));
  for (const s of sources) routes.set(s.path, () => sourcePage(site, s));
  return routes;
}
