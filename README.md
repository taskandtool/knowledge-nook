# Knowledge Nook

A Task & Tool **Starter App**: turns YouTube channels and websites into a public knowledge
site with no ads. A reader picks a topic and sees what the sources say about it, who said it,
when, and how the thinking changed, with every point linked to the moment or page it came from.
It works for any subject, and the owner brings the sources they have access to.

Installed with one click on Task & Tool, or cloned into a repository of your own. MIT licensed.

## How it works

1. **Read.** `scripts/sources.mjs` lists a channel and fetches transcripts through ScrapeCreators,
   or crawls a site with `tt-crawl`. Nothing spends without a yes.
2. **Distill.** One fresh AI run rewrites each source into a dense private document, and a second
   fresh run corrects it against the source. `scripts/check-distilled.mjs` catches quotes, names and
   numbers the source does not have, and stretches that were skimmed.
3. **Organize.** `scripts/build-index.mjs` files every section under its topics.
4. **Write.** One fresh run per page, from a topic's sections alone. `npm run check` traces every quote
   to its source and blocks a deploy on broken links, thin pages open to search, or private text.
5. **Publish.** Static pages on Cloudflare, with search from Pagefind. The machine can sleep while the
   site serves, and only a person makes it public.

`scripts/pipeline.mjs` runs all of this as recurring jobs on the machine, one item at a time.
`SITE.md` holds the owner's rules for the subject. `ARCHITECTURE.md` is the design and `PROCESS.md` how
it runs.

## Off Task & Tool

Set `SCRAPECREATORS_API_KEY`, run `npm install`, and follow `PROCESS.md` with Codex or Claude Code in the
folder. The pipeline works without its jobs: run `node scripts/pipeline.mjs tick` yourself. `npm run build`
writes `dist/`, which any static host can serve.

## Developing

`npm test` runs the scripts against stand-ins for ScrapeCreators, the bridge and `tt-crawl`, and spends
nothing. `npm run check` checks the working folders and the built site.
