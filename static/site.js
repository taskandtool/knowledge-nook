// The few things a page does in the browser: the contents follow the scroll, the timeline's
// dots and rows light each other, and the command center searches with Pagefind. A page reads
// and every link works without any of this.

const TYPE_ORDER = ["Topic", "Guide", "Speaker", "Channel", "Source", "Moment"];
const PLURAL = { Topic: "Topics", Guide: "Guides", Speaker: "Speakers", Channel: "Channels", Source: "Sources", Moment: "Highlights" };
const PER_GROUP = 5;

/** Pagefind names the built file; the site's addresses have no .html. */
export const cleanUrl = (url) => url.replace(/\.html(?=$|[#?])/, "");

const escapeHtml = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** An excerpt's text, with only Pagefind's own highlight surviving as HTML. */
export const safeExcerpt = (excerpt) => escapeHtml(excerpt.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&")).replace(/&lt;(\/?)mark&gt;/g, "<$1mark>").replace(/\s+([.,;:])/g, "$1");

/** Results under their kind, in the site's order, each kind keeping Pagefind's ranking. */
export function groupResults(results) {
  const groups = new Map();
  for (const r of results) {
    const type = r.filters?.type?.[0] ?? "Topic";
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type).push(r);
  }
  return [...groups.entries()].sort((a, b) => TYPE_ORDER.indexOf(a[0]) - TYPE_ORDER.indexOf(b[0])).map(([type, items]) => ({ type, label: PLURAL[type] ?? type, items }));
}

/** Words a person typed, ready to match. */
const termsOf = (query) => query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Instant matches from the site's own list, before the full search answers: every word must appear. */
export function matchLocal(data, query, scope) {
  const terms = termsOf(query);
  if (!terms.length) return [];
  const hit = (text) => { const low = text.toLowerCase(); return terms.every((t) => low.includes(t)); };
  const rank = (text) => (text.toLowerCase().startsWith(terms[0]) ? 0 : 1);
  const items = (data.items ?? []).filter((i) => (!scope || i.type === scope) && hit(`${i.title} ${i.note ?? ""}`)).sort((x, y) => rank(x.title) - rank(y.title));
  const moments = (data.moments ?? []).filter((m) => hit(`${m.text} ${m.source}`)).map((m) => ({ type: "Moment", title: m.text, path: m.path, note: `${m.source} · ${m.at}` }));
  return scope ? items : [...items, ...moments];
}

/** A title with the typed words marked, safely: marked first, each piece escaped. */
export function markTerms(text, query) {
  const terms = termsOf(query).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!terms.length) return escapeHtml(text);
  return text.split(new RegExp(`(${terms.join("|")})`, "giu")).map((part, i) => (i % 2 ? `<mark>${escapeHtml(part)}</mark>` : escapeHtml(part))).join("");
}

/** Local matches first, then full search results they don't repeat, by kind. */
export function mergeResults(local, found) {
  const seen = new Set(local.map((i) => i.path));
  const extra = found.map((r) => ({ type: r.filters?.type?.[0] ?? "Topic", title: r.meta?.title ?? r.url, path: cleanUrl(r.url), excerpt: r.excerpt ?? "" })).filter((r) => !seen.has(r.path));
  const groups = new Map();
  for (const item of [...local, ...extra]) {
    if (!groups.has(item.type)) groups.set(item.type, []);
    if (groups.get(item.type).length < PER_GROUP) groups.get(item.type).push(item);
  }
  return [...groups.entries()].sort((a, b) => TYPE_ORDER.indexOf(a[0]) - TYPE_ORDER.indexOf(b[0])).map(([type, items]) => ({ type, label: PLURAL[type] ?? type, items }));
}

/** What shows before anything is typed: a little of everything worth opening. */
export function startGroups(data, scope) {
  // Searching one kind: all of it, ready to pick from.
  if (scope) return [{ type: scope, label: PLURAL[scope] ?? scope, items: (data.items ?? []).filter((i) => i.type === scope) }].filter((g) => g.items.length);
  const of = (type, n) => (data.items ?? []).filter((i) => i.type === type).slice(0, n);
  const groups = [
    { type: "Topic", label: "Topics", items: of("Topic", 4) },
    { type: "Guide", label: "Guides", items: of("Guide", 3) },
    { type: "Source", label: "Newest sources", items: of("Source", 3) },
    { type: "Moment", label: "Highlights", items: (data.moments ?? []).slice(0, 3).map((m) => ({ type: "Moment", title: m.text, path: m.path, note: `${m.source} · ${m.at}` })) },
  ];
  return groups.filter((g) => g.items.length);
}

/** The next selection, wrapping at either end. */
export const moveSelection = (current, delta, count) => (count ? (current + delta + count) % count : -1);

function scrollSpy() {
  const nav = document.querySelector("[data-scrollspy]");
  if (!nav) return;
  const links = [...nav.querySelectorAll("a")];
  const targets = links.map((a) => document.getElementById(decodeURIComponent(a.hash.slice(1))));
  let ticking = false;
  const update = () => {
    ticking = false;
    let on = -1;
    targets.forEach((t, i) => {
      if (t && t.getBoundingClientRect().top <= 140) on = i;
    });
    // At the very bottom the last heading may never reach the line.
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) on = links.length - 1;
    links.forEach((a, i) => (i === on ? a.setAttribute("aria-current", "true") : a.removeAttribute("aria-current")));
  };
  addEventListener("scroll", () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  }, { passive: true });
  update();
}

function timelines() {
  const parts = document.querySelectorAll("[data-timeline-key]");
  for (const el of parts) {
    const toggle = (on) => {
      for (const other of parts) if (other.dataset.timelineKey === el.dataset.timelineKey) other.toggleAttribute("data-on", on);
    };
    el.addEventListener("mouseenter", () => toggle(true));
    el.addEventListener("mouseleave", () => toggle(false));
  }
}

const ICONS = {
  Topic: '<path d="M4 7h16M4 12h10M4 17h13"/>',
  Guide: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4Z"/><path d="M5 17a3 3 0 0 1 3-3h11"/>',
  Speaker: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  Channel: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9 5 3-5 3V9Z"/>',
  Source: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9 5 3-5 3V9Z"/>',
  Moment: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
};
const iconOf = (type) => `<span class="palette-icon" data-kind="${escapeHtml(type)}"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[type] ?? ICONS.Topic}</svg></span>`;

function palette() {
  const dialog = document.getElementById("palette");
  const input = document.getElementById("palette-input");
  const list = document.getElementById("palette-results");
  if (!dialog || !input || !list) return;
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  for (const k of document.querySelectorAll("[data-palette-key]")) k.textContent = isMac ? "⌘K" : "Ctrl K";

  let pagefind = null;
  let data = null;
  let options = [];
  let selected = -1;
  let asked = 0;
  let scope = null;
  const placeholder = input.getAttribute("placeholder");

  const select = (i) => {
    selected = i;
    options.forEach((o, n) => o.setAttribute("aria-selected", String(n === i)));
    const on = options[i];
    if (on) {
      input.setAttribute("aria-activedescendant", on.id);
      on.scrollIntoView({ block: "nearest" });
    } else input.removeAttribute("aria-activedescendant");
  };
  // A row's picture: its own, or for a highlight or a full-search result, its page's.
  const pictureOf = (item) => {
    const thumb = item.thumb ?? (data?.items ?? []).find((i) => i.path === item.path.split("#")[0])?.thumb;
    return thumb ? `<img class="palette-thumb" src="${escapeHtml(thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : iconOf(item.type);
  };
  const row = (item, id, query) => {
    const line = item.excerpt ? safeExcerpt(item.excerpt) : escapeHtml(item.note ?? "");
    return `<a id="${id}" role="option" aria-selected="false" href="${escapeHtml(item.path)}" class="palette-row">${pictureOf(item)}<span class="min-w-0 flex-1"><span class="palette-title">${markTerms(item.title, query)}</span>${line ? `<span class="palette-note">${line}</span>` : ""}</span><span class="palette-go" aria-hidden="true">↵</span></a>`;
  };
  const show = (groups, query, top = "") => {
    let n = 0;
    const html = groups.map((g) => `<div role="group" aria-label="${escapeHtml(g.label)}"><p class="palette-label">${escapeHtml(g.label)}</p>${g.items.map((i) => row(i, `palette-option-${n++}`, query)).join("")}</div>`).join("");
    const all = query && !scope ? `<a id="palette-option-${n++}" role="option" aria-selected="false" href="/search?q=${encodeURIComponent(query)}" class="palette-row palette-all">All results<span class="palette-go" aria-hidden="true">↵</span></a>` : "";
    list.innerHTML = top + html + all;
    options = [...list.querySelectorAll('[role="option"]')];
    options.forEach((o, i) => o.addEventListener("mousemove", () => selected !== i && select(i)));
    select(query ? 0 : -1);
  };
  const showStart = () => show(data ? startGroups(data, scope) : [], "");
  const search = async () => {
    const query = input.value.trim();
    const mine = ++asked;
    if (!query) return showStart();
    // Titles answer at once; the full search adds to them when it arrives.
    const local = data ? matchLocal(data, query, scope) : [];
    if (local.length) show(mergeResults(local, []), query);
    if (!pagefind) {
      if (!local.length) list.innerHTML = `<p class="palette-empty">Search appears after the site is built.</p>`;
      return undefined;
    }
    pagefind.preload(query);
    const found = await pagefind.debouncedSearch(query, scope ? { filters: { type: scope } } : {}, 80);
    if (!found || mine !== asked) return undefined;
    const results = await Promise.all(found.results.slice(0, 10).map((r) => r.data()));
    if (mine !== asked) return undefined;
    const groups = mergeResults(local, results);
    if (groups.length) return show(groups, query);
    options = [];
    selected = -1;
    input.removeAttribute("aria-activedescendant");
    list.innerHTML = `<p class="palette-empty">Nothing for “${escapeHtml(query)}”. Try fewer words.</p>`;
    return undefined;
  };
  // Loaded once, as soon as someone heads for search, so opening feels instant.
  let warmed = null;
  const warm = () => {
    warmed ??= Promise.all([
      fetch("/palette.json").then((r) => (r.ok ? r.json() : null)).then((d) => { data = d; }).catch(() => {}),
      import("/pagefind/pagefind.js").then(async (p) => { await p.options({ excerptLength: 22 }); pagefind = p; p.init?.(); }).catch(() => {}),
    ]);
    return warmed;
  };
  const open = async (only = null) => {
    if (dialog.open) return;
    scope = only;
    input.setAttribute("placeholder", only ? `Search ${(PLURAL[only] ?? only).toLowerCase()}` : placeholder);
    dialog.showModal();
    input.value = "";
    showStart();
    input.focus();
    await warm();
    search();
  };

  addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (dialog.open) dialog.close();
      else open();
    }
  });
  for (const a of document.querySelectorAll("[data-palette-open]")) {
    a.addEventListener("pointerenter", warm, { once: true });
    a.addEventListener("focus", warm, { once: true });
    a.addEventListener("click", (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      open(a.dataset.paletteScope ?? null);
    });
  }
  document.querySelector("[data-palette-close]")?.addEventListener("click", () => dialog.close());
  // A click on the dimmed page closes it.
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });
  input.addEventListener("input", search);
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      select(moveSelection(selected, e.key === "ArrowDown" ? 1 : -1, options.length));
    } else if (e.key === "Enter" && options[selected]) {
      e.preventDefault();
      location.href = options[selected].href;
    }
  });
}

/** A timestamp plays that moment here, in the page's own player. */
export const seekUrl = (video, seconds) => `https://www.youtube-nocookie.com/embed/${video}?start=${seconds}&autoplay=1`;

/** Which of these seconds a jump lands on: nearest, within 3 minutes. -1 for none. */
export function nearestMoment(seconds, at) {
  let best = -1;
  seconds.forEach((s, i) => {
    if (Math.abs(s - at) <= 180 && (best < 0 || Math.abs(s - at) < Math.abs(seconds[best] - at))) best = i;
  });
  return best;
}

/** A footnote: hover or focus previews it; a click follows unless the topic player handles it. */
function footnotes() {
  const marks = document.querySelectorAll("[data-fn]");
  if (!marks.length) return;
  const card = document.createElement("div");
  card.className = "fn-card";
  card.hidden = true;
  card.setAttribute("role", "tooltip");
  document.body.append(card);
  let leaving = 0;
  const hide = () => {
    card.hidden = true;
  };
  const show = (a) => {
    clearTimeout(leaving);
    const note = document.getElementById(`fn-${a.dataset.fn}`);
    if (!note) return;
    const title = note.closest("[data-group]")?.querySelector("[data-group-title]")?.outerHTML ?? "";
    const time = note.querySelector("[data-note-time]")?.outerHTML ?? "";
    card.innerHTML = `<div>${title} ${time}</div><div class="mt-1 font-body text-ink-2">${note.querySelector("[data-note-line]")?.innerHTML ?? ""}</div>`;
    card.hidden = false;
    const r = a.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left + scrollX - 16, scrollX + document.documentElement.clientWidth - card.offsetWidth - 8));
    const above = r.top - card.offsetHeight - 8;
    card.style.left = `${left}px`;
    card.style.top = `${(above > 8 ? above : r.bottom + 8) + scrollY}px`;
  };
  const later = () => {
    leaving = setTimeout(hide, 160);
  };
  card.addEventListener("pointerenter", () => clearTimeout(leaving));
  card.addEventListener("pointerleave", later);
  for (const a of marks) {
    a.addEventListener("pointerenter", (e) => e.pointerType === "mouse" && show(a));
    a.addEventListener("pointerleave", (e) => e.pointerType === "mouse" && later());
    // Keyboard focus previews the source on hover-capable screens.
    a.addEventListener("focus", () => a.matches(":focus-visible") && !matchMedia("(hover: none)").matches && show(a));
    a.addEventListener("blur", later);
    a.addEventListener("click", (e) => {
      if (e.defaultPrevented) { hide(); return; }
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      location.href = a.dataset.to;
    });
  }
  document.addEventListener("click", (e) => {
    if (!card.hidden && !card.contains(e.target) && !e.target.closest?.("[data-fn]")) hide();
  });
  addEventListener("keydown", (e) => e.key === "Escape" && hide());
}

/** The video's second a reader has reached: how far the line is through the part it falls in. */
export function secondAt(parts, line) {
  if (!parts.length) return null;
  let i = parts.findIndex((p) => line < p.top + p.height);
  if (i < 0) i = parts.length - 1;
  const part = parts[i];
  const next = parts[i + 1]?.at ?? part.at + 180;
  const through = Math.min(1, Math.max(0, (line - part.top) / (part.height || 1)));
  return part.at + through * (next - part.at);
}

/** Where on the page a second of the video falls: secondAt, the other way round. */
export function lineAt(parts, second) {
  if (!parts.length) return null;
  let i = parts.findLastIndex((p) => p.at <= second);
  if (i < 0) i = 0;
  const part = parts[i];
  const next = parts[i + 1]?.at ?? part.at + 180;
  const through = Math.min(1, Math.max(0, (second - part.at) / (next - part.at || 1)));
  return part.top + through * part.height;
}

/** The moment they've just passed, or the first when they haven't reached one. */
export function momentAt(moments, second) {
  let found = moments[0] ?? null;
  for (const m of moments) if (m.at <= second) found = m;
  return found;
}

/** Beside a written page: the source cited where you're reading. A footnote click plays its moment here; on a phone a link leads back. */
function readingRail() {
  const root = document.querySelector("[data-reading-rail]");
  const panel = root?.querySelector("[data-evidence-panel]");
  if (!panel) return;
  const noteOf = (a) => document.getElementById(`fn-${a.dataset.fn}`);
  const marks = [...document.querySelectorAll("article [data-fn]")].filter(noteOf);
  if (!marks.length) return;
  const wide = matchMedia("(min-width: 52rem)");
  const frame = root.querySelector("[data-rail-frame]");
  const play = root.querySelector("[data-rail-play]");
  const [thumb, title, text] = ["thumb", "title", "text"].map((n) => root.querySelector(`[data-rail-${n}]`));
  const back = root.querySelector("[data-rail-return]");
  let shown = document.getElementById(`fn-${panel.dataset.evidenceCurrent}`);
  let playing = false;
  let returnTo = null;
  const stop = () => {
    if (frame.querySelector("iframe")) frame.replaceChildren(...(play ? [play] : []));
    playing = false;
  };
  const preview = (note) => {
    shown = note;
    title.textContent = note.dataset.title;
    title.title = note.dataset.title;
    title.href = note.dataset.to;
    frame.hidden = !note.dataset.video;
    if (note.dataset.video && play) {
      play.href = note.dataset.to;
      play.setAttribute("aria-label", `Play ${note.dataset.title}`);
      thumb.src = note.dataset.thumb;
    }
    // A video speaks for itself; a written source shows its line.
    const line = note.querySelector("[data-note-line]")?.textContent || note.dataset.big || "";
    text.textContent = line;
    text.hidden = !!note.dataset.video || !line;
  };
  const start = (note) => {
    stop();
    root.setAttribute("data-evidence-selected", "");
    preview(note);
    if (note.dataset.video) {
      const player = document.createElement("iframe");
      player.className = "h-full w-full";
      player.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
      player.allowFullscreen = true;
      player.title = note.dataset.title;
      player.src = seekUrl(note.dataset.video, note.dataset.at || 0);
      frame.replaceChildren(player);
      playing = true;
    }
  };
  const activate = (note, origin) => {
    returnTo = { mark: origin, top: origin.getBoundingClientRect().top };
    start(note);
    const number = note.id.slice(3);
    panel.setAttribute("aria-label", `Reference ${number}: ${note.dataset.title}${note.dataset.stamp ? ` at ${note.dataset.stamp}` : ""}`);
    const box = panel.getBoundingClientRect();
    const away = !wide.matches || box.top < 0 || box.top >= innerHeight;
    if (back && origin.id) {
      back.href = `#${origin.id}`;
      back.textContent = `Back to reference ${number}`;
      back.hidden = !away;
    }
    for (const a of marks) a.toggleAttribute("data-reference-selected", a === origin);
    if (away) {
      panel.scrollIntoView({ block: "start" });
      panel.focus({ preventScroll: true });
    }
  };
  for (const a of marks) {
    a.addEventListener("click", (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      activate(noteOf(a), a);
    });
  }
  back?.addEventListener("click", (e) => {
    if (!returnTo || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    stop();
    root.removeAttribute("data-evidence-selected");
    back.hidden = true;
    preview(shown);
    panel.setAttribute("aria-label", "Cited source");
    for (const a of marks) a.removeAttribute("data-reference-selected");
    const { mark, top } = returnTo;
    scrollTo({ top: scrollY + mark.getBoundingClientRect().top - top });
    mark.focus({ preventScroll: true });
    returnTo = null;
    schedule();
  });
  play?.addEventListener("click", (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || !shown.dataset.video) return;
    e.preventDefault();
    start(shown);
  });
  // While nothing plays, the panel follows the last footnote above the reading line.
  let ticking = false;
  const follow = () => {
    ticking = false;
    if (!wide.matches || playing || root.hasAttribute("data-evidence-selected")) return;
    const line = Math.min(innerHeight * 0.3, 240);
    let found = marks[0];
    for (const a of marks) if (a.getBoundingClientRect().top <= line) found = a;
    const note = noteOf(found);
    if (note !== shown) preview(note);
  };
  const schedule = () => {
    if (!ticking) { ticking = true; requestAnimationFrame(follow); }
  };
  addEventListener("scroll", schedule, { passive: true });
  wide.addEventListener("change", () => {
    if (back && returnTo) back.hidden = wide.matches;
    schedule();
  });
  schedule();
}

/** On the home page: lighting what a topic or a video connects to. */
function relations() {
  for (const root of document.querySelectorAll("[data-relations]")) {
    const paths = [...root.querySelectorAll("path[data-t]")];
    const nodes = [...root.querySelectorAll("[data-node]")];
    const clear = () => {
      delete root.dataset.active;
      for (const el of [...paths, ...nodes]) el.removeAttribute("data-lit");
    };
    const light = (node) => {
      clear();
      root.dataset.active = "";
      node.setAttribute("data-lit", "");
      const [kind, id] = [node.dataset.node[0], node.dataset.node.slice(1)];
      const other = kind === "t" ? "v" : "t";
      for (const p of paths) {
        if (p.dataset[kind] !== id) continue;
        p.setAttribute("data-lit", "");
        root.querySelector(`[data-node="${other}${p.dataset[other]}"]`)?.setAttribute("data-lit", "");
      }
    };
    for (const node of nodes) {
      node.addEventListener("pointerenter", () => light(node));
      node.addEventListener("focus", () => light(node));
      node.addEventListener("pointerleave", clear);
      node.addEventListener("blur", clear);
    }
  }
}

/** The home page's big line: a different strong one each visit. */
function heroPick() {
  const hero = document.querySelector("[data-hero]");
  if (!hero) return;
  const picks = JSON.parse(hero.dataset.picks);
  const pick = picks[Math.floor(Math.random() * picks.length)];
  if (!pick) return;
  const thumb = hero.querySelector("[data-hero-thumb]");
  const link = hero.querySelector("[data-hero-link]");
  const swap = (src) => {
    thumb.setAttribute("src", src);
    thumb.toggleAttribute("data-large", src !== pick.thumb);
    link.querySelector("[data-hero-text]").textContent = pick.text;
    link.setAttribute("href", pick.to);
  };
  // The large picture when YouTube has one, and only once it's here, so nothing flashes empty.
  const picture = new Image();
  picture.onload = () => swap(picture.src);
  picture.onerror = () => swap(pick.thumb);
  picture.src = pick.thumb.replace("hqdefault", "maxresdefault");
}

/** On the Sources page: one channel at a time. With no script, every source shows. */
function sourceFilters() {
  const bar = document.querySelector("[data-filters]");
  if (!bar) return;
  bar.classList.remove("hidden");
  bar.classList.add("flex");
  const buttons = [...bar.querySelectorAll("[data-filter]")];
  const cards = [...document.querySelectorAll("[data-card]")];
  bar.addEventListener("click", (e) => {
    const chosen = e.target.closest?.("[data-filter]");
    if (!chosen) return;
    for (const b of buttons) b.setAttribute("aria-pressed", String(b === chosen));
    for (const c of cards) c.hidden = !!chosen.dataset.filter && c.dataset.channel !== chosen.dataset.filter;
  });
}

function sourceMoments() {
  const player = document.getElementById("player");
  const fmt = (s) => {
    const pad = (n) => String(n).padStart(2, "0");
    const [h, m, x] = [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60];
    return h ? `${h}:${pad(m)}:${pad(x)}` : `${m}:${pad(x)}`;
  };
  document.addEventListener("click", (e) => {
    const a = e.target.closest?.("[data-seek]");
    if (!a || !player || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    player.src = seekUrl(player.dataset.video, a.dataset.seek);
    // Beside the read on a wide screen, above it on a phone.
    if (player.getBoundingClientRect().bottom < 0 || player.getBoundingClientRect().top > innerHeight) player.scrollIntoView({ block: "start" });
  });

  const rows = [...document.querySelectorAll("[data-moment]")];
  const moments = rows.map((row) => ({ at: Number(row.dataset.at), text: row.dataset.punch ?? row.lastElementChild.textContent, href: row.querySelector("a")?.getAttribute("href") }));
  const now = document.querySelector("[data-moment-now]");
  const parts = [...document.querySelectorAll("[data-part]")];
  // The rail shows the strongest as you read; the list holds the rest.
  const strongest = moments.filter((_, i) => rows[i].hasAttribute("data-strong"));
  const biggest = strongest.length ? strongest : moments;
  let shown = null;
  const showMoment = (m) => {
    if (!now || !m || m === shown) return;
    shown = m;
    now.querySelector("[data-moment-text]").textContent = m.text;
    const time = document.querySelector("[data-moment-time]");
    time.textContent = fmt(m.at);
    time.dataset.seek = m.at;
    if (m.href) time.setAttribute("href", m.href);
    now.classList.remove("changing");
    void now.offsetWidth;
    now.classList.add("changing");
  };
  const details = document.querySelector("[data-moments]");
  const list = document.querySelector("[data-moment-list]");
  const lightRow = (i) => {
    for (const lit of list.querySelectorAll("[data-on]")) lit.removeAttribute("data-on");
    const row = rows[i];
    if (!row) return;
    row.setAttribute("data-on", "");
    // Only the list moves, never the page behind it.
    const [box, spot] = [list.getBoundingClientRect(), row.getBoundingClientRect()];
    if (spot.top < box.top || spot.bottom > box.bottom) list.scrollTop += spot.top - box.top - (box.height - spot.height) / 2;
  };
  const reading = () => parts.map((p) => ({ at: Number(p.dataset.part), top: p.getBoundingClientRect().top + scrollY, height: p.offsetHeight }));
  const READ_LINE = 0.4;
  // After a click on the list, the reader's place is the line they chose until they move.
  let held = false;
  for (const move of ["wheel", "touchmove", "keydown"]) addEventListener(move, () => { held = false; }, { passive: true });
  if (parts.length && moments.length) {
    let ticking = false;
    const follow = () => {
      ticking = false;
      if (held) return;
      // Nothing moves until the read is on screen: the strongest stays until then.
      if (parts[0].getBoundingClientRect().top > innerHeight * READ_LINE) return;
      const second = secondAt(reading(), scrollY + innerHeight * READ_LINE);
      if (details?.open) lightRow(moments.indexOf(momentAt(moments, second)));
      if (now && getComputedStyle(now).display !== "none") showMoment(momentAt(biggest, second));
    };
    addEventListener("scroll", () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(follow);
      }
    }, { passive: true });
    details?.addEventListener("toggle", follow);
    list?.addEventListener("click", (e) => {
      const go = e.target.closest?.("[data-go]");
      if (!go || e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      const i = rows.indexOf(go.closest("[data-moment]"));
      held = true;
      lightRow(i);
      showMoment(moments[i]);
      const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
      scrollTo({ top: lineAt(reading(), moments[i].at) - innerHeight * READ_LINE, behavior: calm ? "auto" : "smooth" });
    });
  }

  // A link straight to a moment: /sources/x#t=123, on arrival or from search on this same page.
  const goToMoment = () => {
    const at = /^#t=(\d+)$/.exec(location.hash)?.[1];
    if (!at) return;
    const palette = document.getElementById("palette");
    if (palette?.open) palette.close();
    if (player) player.src = seekUrl(player.dataset.video, at);
    for (const lit of document.querySelectorAll("[data-moment][data-on]")) lit.removeAttribute("data-on");
    const target = nearestMoment(moments.map((m) => m.at), Number(at));
    if (target >= 0) {
      rows[target].setAttribute("data-on", "");
      showMoment(moments[target]);
    }
    // A phone needs the selected video in view; wide screens can keep the read beside it.
    const part = [...parts].reverse().find((p) => Number(p.dataset.part) <= Number(at));
    if (player && matchMedia("(max-width: 63.999rem)").matches) player.scrollIntoView({ block: "start" });
    else if (part) part.scrollIntoView({ block: "start" });
    else if (target >= 0) {
      rows[target].closest("details")?.setAttribute("open", "");
      rows[target].scrollIntoView({ block: "center" });
    }
  };
  addEventListener("hashchange", goToMoment);
  goToMoment();
}

if (typeof document !== "undefined") {
  sourceMoments();
  readingRail();
  relations();
  heroPick();
  sourceFilters();
  footnotes();
  scrollSpy();
  timelines();
  palette();
}
