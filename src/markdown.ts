// A page's markdown to HTML. Pages are written from text the owner does not control and
// the public reads them, so HTML renders as plain text and a link with a scheme other
// than web, mail or phone goes nowhere.
import { Marked, type Tokens } from "marked";

const SAFE_SCHEMES = new Set(["http", "https", "mailto", "tel"]);

export const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** The address when it is safe to follow. Only named schemes pass, so a scheme broken up with spaces or control characters does not. */
export function safeHref(href: string | null | undefined): string | null {
  if (!href) return null;
  const head = /^[^/?#]*/.exec(href)?.[0] ?? "";
  const colon = head.indexOf(":");
  if (colon < 0) return head.includes("&") ? null : href.trim();
  return SAFE_SCHEMES.has(head.slice(0, colon).toLowerCase()) ? href.trim() : null;
}

/** A heading's markdown as plain words: what its anchor and its contents line both come from. */
const headingWords = (markdown: string) => markdown.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, "").replace(/[<>]/g, "");

export function headingId(text: string) {
  return text.normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, "-").replace(/^-+|-+$/g, "");
}

/** "1153" to "19:13"; an hour shows when there is one. */
export function clock(total: number) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const [h, m, s] = [Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60];
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** A link to a moment, as the seconds it opens at. */
export function secondsIn(href: string): number | null {
  const m = /[?&]t=(\d+)s?(?:&|#|$)/.exec(href);
  return m && /^https?:\/\//.test(href) ? Number(m[1]) : null;
}

export type Reference = { n: number; path: string; title: string; at: number | null; line: string; video?: string | null; published?: string; big?: string };
type Resolve = (href: string) => Omit<Reference, "n"> | null;

/** Set for the length of one render: how a citation becomes a numbered note. */
let footnote: ((href: string) => string | null) | null = null;

const marked = new Marked({
  gfm: true,
  renderer: {
    html(token) {
      return escapeHtml(token.raw);
    },
    link(this: any, { href, title, tokens }: Tokens.Link) {
      const text = this.parser.parseInline(tokens);
      const safe = safeHref(href);
      if (!safe) return text;
      const note = /^https?:\/\//.test(safe) ? footnote?.(safe) : null;
      if (note) return note;
      return `<a ${/^https?:\/\//.test(safe) ? 'rel="noopener" ' : ""}href="${escapeHtml(safe)}"${title ? ` title="${escapeHtml(title)}"` : ""}>${text}</a>`;
    },
    image({ href, title, text }: Tokens.Image) {
      const safe = safeHref(href);
      if (!safe || /^(mailto|tel):/i.test(safe)) return escapeHtml(text);
      return `<img src="${escapeHtml(safe)}" alt="${escapeHtml(text)}"${title ? ` title="${escapeHtml(title)}"` : ""} loading="lazy">`;
    },
    heading(this: any, { tokens, depth, text }: Tokens.Heading) {
      // The page's own title is its only h1.
      const level = Math.max(depth, 2);
      const inner = this.parser.parseInline(tokens);
      const id = headingId(headingWords(text));
      return `<h${level}${level === 2 && id ? ` id="${escapeHtml(id)}"` : ""}>${inner}</h${level}>\n`;
    },
  },
});

export const toHtml = (markdown: string) => marked.parse(markdown, { async: false }) as string;

const LINK = String.raw`\[[^\]]*\]\(https?:[^)\s]+\)`;
const BRACKETED = new RegExp(String.raw`\(\s*(${LINK}(?:[,;]?\s*${LINK})*)\s*\)`, "g");

/** A page's writing, with each citation a small numbered note that reads past, and the list those numbers point to. */
export function renderWithNotes(markdown: string, resolve: Resolve) {
  const references: Reference[] = [];
  const numbers = new Map<string, number>();
  let occurrence = 0;
  footnote = (href) => {
    const found = resolve(href);
    if (!found) return null;
    let n = numbers.get(href);
    if (!n) {
      n = references.length + 1;
      numbers.set(href, n);
      references.push({ n, ...found });
    }
    return `<sup class="fn" data-pagefind-ignore><a href="#fn-${n}" data-fn="${n}" data-to="${escapeHtml(encodeURI(found.path))}${found.at === null ? "" : `#t=${found.at}`}" id="reference-${n}-${++occurrence}" aria-label="Source ${n}">${n}</a></sup>`;
  };
  try {
    const html = (marked.parse(markdown.replace(BRACKETED, "$1"), { async: false }) as string).replace(/\s+<sup class="fn"/g, '<sup class="fn"').replace(/<\/sup>\s*,?\s*<sup class="fn"/g, '</sup><sup class="fn"');
    return { html, references };
  } finally {
    footnote = null;
  }
}

/** A page's section headings, for its table of contents. */
export function headingsOf(markdown: string) {
  return (marked.lexer(markdown) as Tokens.Heading[])
    .filter((t) => t.type === "heading" && t.depth === 2)
    .map((t) => {
      const text = headingWords(t.text);
      return { text, id: headingId(text) };
    });
}
