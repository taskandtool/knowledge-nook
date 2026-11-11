/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */
// The visuals, computed once at build time with D3 and sent as plain HTML and SVG with
// real links and real text, so they cost a reader no script. Each has a phone layout.
import { hierarchy, treemap, treemapSquarify } from "d3-hierarchy";
import { href } from "./layout";
import type { Group, Page, Site, TopicRow } from "./load";

const MAP_WIDTH = 1200;
/** Tall enough to read, and no taller: a few topics make a short map. */
const mapHeight = (tiles: number) => Math.min(470, 120 + tiles * 30);
const MAP_LIMIT = 60;
const pct = (n: number, of: number) => `${((n / of) * 100).toFixed(3)}%`;
/** Area grows slower than coverage, so one huge topic leaves room to read the rest. */
const areaOf = (t: TopicRow) => Math.sqrt(t.moments) + t.sources;

export function mapLayout(groups: Group[], width = MAP_WIDTH) {
  const strongest = groups.flatMap((g) => g.topics).sort((a, b) => areaOf(b) - areaOf(a)).slice(0, MAP_LIMIT);
  const height = mapHeight(strongest.length);
  const keep = new Set(strongest.map((t) => t.slug));
  const data: any = { children: groups.map((g) => ({ name: g.name, children: g.topics.filter((t) => keep.has(t.slug)).map((t) => ({ topic: t })) })).filter((g) => g.children.length) };
  const root = treemap<any>().tile(treemapSquarify.ratio(1.2)).size([width, height]).paddingOuter(0).paddingInner(4).paddingTop((d) => (d.depth === 1 ? 46 : 0)).round(true)(
    hierarchy(data).sum((d) => (d.topic ? areaOf(d.topic) : 0)).sort((a, b) => (b.value ?? 0) - (a.value ?? 0)),
  );
  return {
    groups: (root.children ?? []).map((g) => ({ name: g.data.name, x: g.x0, y: g.y0, w: g.x1 - g.x0 })),
    tiles: root.leaves().map((l) => ({ topic: l.data.topic as TopicRow, x: l.x0, y: l.y0, w: l.x1 - l.x0, h: l.y1 - l.y0 })),
    hidden: groups.flatMap((g) => g.topics).length - strongest.length,
    height,
  };
}

/** The subject at a glance: its written topics, grouped, sized by how much the sources say. */
export function TopicMap({ groups, pictureOf }: { groups: Group[]; pictureOf?: (page: Page, index: number) => string | undefined }) {
  if (!groups.length) return null;
  const { groups: labels, tiles, hidden, height: MAP_HEIGHT } = mapLayout(groups);
  return (
    <section aria-label="Topic map" class="font-display">
      <div class="relative hidden lg:block" style={`aspect-ratio:${MAP_WIDTH}/${MAP_HEIGHT}`}>
        {labels.map((g) => (
          <p class="absolute text-small leading-tight font-semibold text-ink-2 first-letter:uppercase" title={g.name} style={`left:${pct(g.x, MAP_WIDTH)};top:${pct(g.y, MAP_HEIGHT)};width:${pct(g.w, MAP_WIDTH)}`}>{g.name}</p>
        ))}
        {tiles.map(({ topic, x, y, w, h }, i) => {
          const picture = topic.page && pictureOf?.(topic.page, i);
          return (
            <a class="tile" href={href(topic.page?.path ?? "/topics")} style={`left:${pct(x, MAP_WIDTH)};top:${pct(y, MAP_HEIGHT)};width:${pct(w, MAP_WIDTH)};height:${pct(h, MAP_HEIGHT)}`}>
              {picture ? <img class="tile-picture" src={picture} alt="" loading="lazy" referrerpolicy="no-referrer" /> : null}
              <span class="tile-words">{topic.page?.title ?? topic.name}</span>
            </a>
          );
        })}
      </div>
      {hidden > 0 ? <p class="mt-3 text-small text-ink-2">The {MAP_LIMIT} strongest of {MAP_LIMIT + hidden} topics. <a href="/topics">See them all</a>.</p> : null}
    </section>
  );
}

const dayOf = (d: string) => Date.parse(`${d}T00:00:00Z`);
/** A date label's width as a share of the line, wide enough for "Aug 2026" on the narrowest screen that shows it. */
const LABEL_WIDTH = 0.14;

/** What each dot says: a short date above the line, below it when its neighbour's label is in the way, and nothing when both are taken. */
export function timelineMarks(dates: string[], language = "en") {
  const days = dates.map(dayOf);
  const span = days[days.length - 1] - days[0] || 1;
  const sameYear = new Set(dates.map((d) => d.slice(0, 4))).size === 1;
  const endOf = [-Infinity, -Infinity];
  return days.map((day) => {
    const at = (day - days[0]) / span;
    const align = at < 0.06 ? "start" : at > 0.94 ? "end" : "middle";
    const left = align === "start" ? at : align === "end" ? at - LABEL_WIDTH : at - LABEL_WIDTH / 2;
    const free = [0, 1].find((r) => left >= endOf[r]);
    if (free === undefined) return { text: "", row: 0, align: "middle" };
    endOf[free] = left + LABEL_WIDTH;
    const options: Intl.DateTimeFormatOptions = sameYear ? { month: "short", day: "numeric", timeZone: "UTC" } : { month: "short", year: "numeric", timeZone: "UTC" };
    return { text: new Date(day).toLocaleDateString(language, options), row: free, align };
  });
}
export const niceDate = (d: string, language = "en") => {
  const t = dayOf(d);
  return Number.isNaN(t) ? d : new Date(t).toLocaleDateString(language, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
};

const RELATION_ROW = 66;
const RELATION_TOPIC_ROW = 56;

/** Rows for both sides, each ordered by where its links land on the other, so lines cross as little as they can. */
export function relationLayout(topics: number, videos: number, links: { t: number; v: number }[]) {
  const range = (n: number) => Array.from({ length: n }, (_, i) => i);
  let topicOrder = range(topics);
  let videoOrder = range(videos);
  const sorted = (order: number[], other: number[], mine: "t" | "v") => {
    const place = new Map(other.map((id, i) => [id, i / Math.max(1, other.length - 1)]));
    const here = new Map(order.map((id, i) => [id, i / Math.max(1, order.length - 1)]));
    const theirs = mine === "t" ? "v" : "t";
    const pull = (id: number) => {
      const mineLinks = links.filter((l) => l[mine] === id);
      return mineLinks.length ? mineLinks.reduce((sum, l) => sum + (place.get(l[theirs]) ?? 0), 0) / mineLinks.length : (here.get(id) ?? 0);
    };
    const at = new Map(order.map((id) => [id, pull(id)]));
    return [...order].sort((a, b) => (at.get(a) ?? 0) - (at.get(b) ?? 0) || a - b);
  };
  for (let sweep = 0; sweep < 8; sweep++) {
    topicOrder = sorted(topicOrder, videoOrder, "t");
    videoOrder = sorted(videoOrder, topicOrder, "v");
  }
  const height = Math.max(videos * RELATION_ROW, topics * RELATION_TOPIC_ROW);
  const yOf = (order: number[]) => new Map(order.map((id, i) => [id, (i + 0.5) * (height / order.length)]));
  return { height, topicY: yOf(topicOrder), videoY: yOf(videoOrder) };
}

/** Which videos each topic draws on: real links on both sides, the lines drawn once at build. Wide screens only; a phone gets the cards. */
export function RelationMap({ topics, videos, links }: { topics: { title: string; path: string }[]; videos: { title: string; path: string; thumb?: string; note: string }[]; links: { t: number; v: number; n: number }[] }) {
  const { height, topicY, videoY } = relationLayout(topics.length, videos.length, links);
  // The topics with most behind them read larger and draw darker, so the eye finds them first.
  const reach = topics.map((_, i) => links.filter((l) => l.t === i).length);
  const [low, high] = [Math.min(...reach), Math.max(...reach)];
  const weight = (i: number) => (high > low ? (reach[i] - low) / (high - low) : 0.5);
  return (
    <div class="relative hidden font-display lg:grid lg:grid-cols-[17rem_minmax(8rem,1fr)_25rem]" style={`height:${height}px`} data-relations>
      <div class="relative">
        {topics.map((t, i) => (
          <a href={href(t.path)} data-node={`t${i}`} class="group absolute right-0 flex w-full -translate-y-1/2 items-center justify-end gap-3 text-right no-underline" style={`top:${topicY.get(i)}px`}>
            <span class={`line-clamp-2 leading-tight tracking-tight group-hover:text-accent ${weight(i) > 0.5 ? "font-bold" : "font-medium text-ink-2"}`} style={`font-size:${(0.95 + weight(i) * 0.45).toFixed(3)}rem`}>{t.title}</span>
            <span class="shrink-0 rounded-full bg-tile group-hover:bg-accent" style={`width:${(6 + weight(i) * 8).toFixed(1)}px;height:${(6 + weight(i) * 8).toFixed(1)}px`} aria-hidden="true" />
          </a>
        ))}
      </div>
      <svg class="h-full w-full" viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" aria-hidden="true">
        {links.map((l) => {
          const [y1, y2] = [topicY.get(l.t), videoY.get(l.v)];
          return <path data-t={l.t} data-v={l.v} d={`M0,${y1} C50,${y1} 50,${y2} 100,${y2}`} vector-effect="non-scaling-stroke" style={`stroke-width:${(1 + Math.sqrt(l.n) * 0.7).toFixed(2)}px;--line:${(0.14 + weight(l.t) * 0.34).toFixed(2)}`} />;
        })}
      </svg>
      <div class="relative">
        {videos.map((v, i) => (
          <a href={href(v.path)} data-node={`v${i}`} class="group absolute left-0 flex w-full -translate-y-1/2 items-center gap-3 no-underline" style={`top:${videoY.get(i)}px`}>
            {v.thumb ? <img class="aspect-video w-28 shrink-0 rounded bg-panel object-cover" src={v.thumb} alt="" loading="lazy" referrerpolicy="no-referrer" /> : <span class="aspect-video w-28 shrink-0 rounded bg-panel" />}
            <span class="min-w-0">
              <span class="block truncate text-small font-medium group-hover:text-accent" title={v.title}>{v.title}</span>
              <span class="mt-0.5 block truncate text-[0.8125rem] text-ink-3">{v.note}</span>
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}

/** The videos a page cites, by date, when there is a span to show. A dot goes to its row below. */
export function Timeline({ groups, site }: { groups: { key: number; title: string; published: string; count: number }[]; site: Site }) {
  const dated = groups.filter((g) => g.published);
  if (dated.length < 2) return null;
  const [first, last] = [dayOf(dated[0].published), dayOf(dated[dated.length - 1].published)];
  const span = last - first;
  if (span <= 0) return null;
  const lang = site.settings.language;
  const marks = timelineMarks(dated.map((g) => g.published), lang);
  return (
    <div id="timeline" class="relative mt-5 hidden h-[4.5rem] px-2 sm:block" data-timeline>
      <div class="absolute top-10 right-2 left-2 border-t border-line-strong" />
      {dated.map((g, i) => {
        const size = Math.min(22, 10 + Math.sqrt(g.count) * 2);
        const x = pct(dayOf(g.published) - first, span);
        const mark = marks[i];
        return (
          <a href={`#from-${g.key}`} data-timeline-key={g.key} aria-label={`${g.title}, ${niceDate(g.published, lang)}`} title={g.title} class="group absolute top-0 h-full no-underline" style={`left:calc(0.5rem + (100% - 1rem) * ${((dayOf(g.published) - first) / span).toFixed(4)});width:0`} data-x={x}>
            {mark.text ? <span class={`absolute font-mono text-small whitespace-nowrap text-ink-2 group-hover:text-accent group-data-[on]:text-accent ${mark.align === "middle" ? "-translate-x-1/2" : ""} ${mark.row ? "top-[3.15rem]" : "top-3"}`} style={mark.align === "start" ? "left:-0.5rem" : mark.align === "end" ? "right:-0.5rem" : ""}>{mark.text}</span> : null}
            <span class="absolute rounded-full bg-accent ring-accent/30 transition-shadow group-hover:ring-4 group-data-[on]:ring-4" style={`left:${-size / 2}px;top:${41 - size / 2}px;width:${size}px;height:${size}px`} />
          </a>
        );
      })}
    </div>
  );
}
