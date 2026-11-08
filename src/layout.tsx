/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */
// The document around every page: head, header, footer.
import { existsSync } from "node:fs";
import { raw } from "hono/html";
import type { Child } from "hono/jsx";
import { initialsOf, type Site } from "./load";

export type Meta = { path: string; title?: string; description: string; noindex?: boolean; jsonLd?: object[]; head?: Child; image?: string };

const FONTS = "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400&family=Schibsted+Grotesk:wght@400..800&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&display=swap";

export const href = (path: string) => encodeURI(path);
export const SearchIcon = ({ size = 16 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
);
export const canonical = (site: Site, path: string) => (site.settings.url ? site.settings.url + href(path) : null);
/** JSON inside a script tag: a "<" in a title must never close it. */
const json = (value: object) => JSON.stringify(value).replace(/</g, "\\u003c");

export function Layout({ site, meta, children }: { site: Site; meta: Meta; children?: Child }) {
  const { name, language, corrections } = site.settings;
  const logo = existsSync(new URL("../static/logo.svg", import.meta.url));
  const contact = /^https?:\/\//.test(corrections) ? corrections : corrections.includes("@") ? `mailto:${corrections}` : "";
  const title = meta.title ? `${meta.title} · ${name}` : name;
  const url = canonical(site, meta.path);
  const nav = [
    ["/topics", "Topics"],
    ...(site.pages.some((p) => p.type === "guide") ? [["/guides", "Guides"]] : []),
    ...(site.pages.some((p) => p.type === "speaker") ? [["/speakers", "Speakers"]] : []),
    ...(site.pages.some((p) => p.type === "channel") ? [["/channels", "Channels"]] : []),
    ...([...site.sources.values()].some((s) => s.citedBy.length || s.moments.length) ? [["/sources", "Sources"]] : []),
    ["/new", "What's new"],
  ];
  return (
    <html lang={language}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <meta name="description" content={meta.description} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={meta.description} />
        <meta property="og:type" content="article" />
        {meta.image ? <meta property="og:image" content={meta.image} /> : null}
        {meta.image ? <meta name="twitter:card" content="summary_large_image" /> : null}
        {meta.noindex ? <meta name="robots" content="noindex" /> : null}
        {url && !meta.noindex ? <link rel="canonical" href={url} /> : null}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
        <link rel="stylesheet" href={FONTS} />
        <link rel="stylesheet" href="/site.css" />
        <link rel="icon" href={logo ? "/logo.svg" : "/favicon.svg"} type="image/svg+xml" />
        {(meta.jsonLd ?? []).map((o) => <script type="application/ld+json">{raw(json(o))}</script>)}
        <script type="module" src="/site.js" />
        {meta.head}
      </head>
      <body class="min-h-screen bg-canvas text-ink">
        <a href="#main" class="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:bg-accent focus:px-4 focus:py-2 focus:text-accent-ink">Skip to content</a>
        <header class="border-b border-line font-display">
          <div class="mx-auto flex max-w-wide flex-wrap items-center gap-x-8 gap-y-2 px-4 py-4 sm:px-8">
            <a href="/" class="flex items-center gap-2.5 text-xl font-bold no-underline">
              {logo ? <img src="/logo.svg" alt="" class="h-8 w-auto" /> : <span class="logo-mark" aria-hidden="true">{initialsOf(name)}</span>}
              {name}
            </a>
            <nav aria-label="Main" class="order-3 w-full sm:order-none sm:w-auto">
              <ul class="flex flex-wrap gap-x-5 gap-y-1 text-small">
                {nav.map(([to, label]) => (
                  <li><a href={to} class="text-ink-2 no-underline underline-offset-[0.4rem] hover:text-ink aria-[current=page]:font-medium aria-[current=page]:text-ink aria-[current=page]:underline" aria-current={to === meta.path || meta.path.startsWith(`${to}/`) ? "page" : undefined}>{label}</a></li>
                ))}
              </ul>
            </nav>
            <a href="/search" data-palette-open aria-label="Search" class="ml-auto flex items-center gap-2.5 rounded-xl border border-line-strong bg-surface p-2.5 text-small text-ink-2 no-underline shadow-sm transition-colors hover:border-ink hover:text-ink sm:w-56 sm:px-3.5 sm:py-2 lg:w-72">
              <SearchIcon />
              <span class="hidden flex-1 sm:inline">Search</span>
              <kbd data-palette-key class="hidden rounded bg-panel px-1.5 font-mono text-[0.8125rem] text-ink-2 sm:inline">⌘K</kbd>
            </a>
          </div>
        </header>
        <main id="main">{children}</main>
        <dialog id="palette" aria-label="Search this site">
          <div class="flex items-center gap-3 border-b border-line px-5">
            <span class="text-ink-3"><SearchIcon size={20} /></span>
            <input id="palette-input" type="text" role="combobox" aria-expanded="true" aria-controls="palette-results" aria-autocomplete="list" autocomplete="off" spellcheck={false} placeholder="Search everything" aria-label="Search" class="w-full bg-transparent py-4.5 text-[1.0625rem] outline-none placeholder:text-ink-3" />
            <button type="button" data-palette-close class="shrink-0 rounded-md bg-panel px-2 py-0.5 font-mono text-[0.8125rem] text-ink-2 hover:text-ink">esc</button>
          </div>
          <div id="palette-results" role="listbox" aria-label="Results" class="max-h-[min(62vh,34rem)] overflow-y-auto overscroll-contain pb-2" />
          <div class="hidden items-center gap-5 border-t border-line px-5 py-2.5 text-[0.8125rem] text-ink-3 sm:flex">
            <span><kbd class="palette-kbd">↑</kbd> <kbd class="palette-kbd">↓</kbd> to move</span>
            <span><kbd class="palette-kbd">↵</kbd> to open</span>
            <span><kbd class="palette-kbd">esc</kbd> to close</span>
          </div>
        </dialog>
        <footer class="mt-24 border-t border-line font-display text-small text-ink-2">
          <div class="mx-auto flex max-w-wide flex-wrap justify-between gap-x-8 gap-y-2 px-4 py-8 sm:px-8">
            <p>{name}</p>
            {contact ? <p><a href={contact}>Corrections</a></p> : null}
          </div>
        </footer>
      </body>
    </html>
  );
}
