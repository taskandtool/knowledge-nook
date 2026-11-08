---
name: site
description: Changes how the public site looks or works: its templates, colours and fonts, the topic map and other visuals, search and SEO. Use when asked to change the look, add a kind of page, or fix something on a page that is not its writing. Not for writing or correcting a page (write-page).
---

# Change the site

Pages are built from `content/` by `src/pages.tsx` inside `src/layout.tsx`. Done when `npm run check`
passes and you have looked at the result: `npm run build`, then `tt-crawl shoot /` and the changed pages,
at both widths. On a phone every view must still read, so a new visual needs a phone layout.

- **The look is `styles/theme.css`:** every colour, face and size. Change it there, and add a token
  rather than a one-off value. `src/layout.tsx` loads the fonts.
- **The logo:** the header and tab show the site's initials; a file at `static/logo.svg` replaces them.
- **Share images** are drawn by `src/og.ts` at build; they need `Address` in `SITE.md`.
- **Visuals are computed at build time** in `src/viz.tsx` and sent as HTML or SVG with real text and
  links, so a reader runs no script for them. They read titles, dates, links and counts, never a section's
  words, because distillations and transcripts stay private.
- **`static/site.js` only adds.** Scroll spy, timeline highlights and the ⌘K command center; a page must read and link without it.
- **A subject's differences belong in `SITE.md`,** not in code. Any owner's subject has to work.
- **Source text never runs.** All page writing goes through `src/markdown.ts`. `npm run check` fails on
  scripts, event handlers, unsafe links, or 40 words in a row from a private file.
- **The publish gate is the owner's:** `Publish gate:` in `SITE.md`, or `noindex: true` on one page.
  Don't loosen it to pass a check.
