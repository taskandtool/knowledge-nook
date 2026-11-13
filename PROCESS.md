# Knowledge Nook: process

How the app runs once it is built: starting a channel, keeping it current, and keeping
the site healthy.

The rules throughout:

- Scripts move the work along. AI is only called for what takes understanding.
- Each stage has a check, and later stages wait for it.
- Spending needs the owner's yes first: transcript credits, and AI over a whole channel.
- Publishing is the owner's decision. Only a person makes production public.
- Every job can run again safely and picks up where it stopped.

## Part 1: Starting a channel

### 1. Set the scope

Agree with the owner, and record:

- In `sources/`: the channels, websites and documents to read, and what to leave out (a
  date range, a minimum length, other languages), through `sources.mjs list`'s flags.
- In `SITE.md`: what the site is about, who it is for, and what must never be lost in this
  subject. The owner can edit it at any time.

### 2. List and estimate

`sources.mjs list` lists every video and page without fetching any transcripts. `--since`, `--min-minutes` and `--language` record what to leave out. Tell the
owner the number of sources, total hours, and the expected credits, AI cost and time.
Wait for a yes.

When the channel is the owner's own, `list --mine` reads it through the youtube connection
instead: no credits, but YouTube allows captions for about 40 videos a day, so a big channel
takes days. Any other channel needs ScrapeCreators.

### 3. Calibrate on a sample

Before spending on the whole channel, run the real pipeline on about 20 sources spread
across the channel's history:

`pipeline.mjs queue --sample 20` previews the spend. With the owner's yes, `--confirm` queues them and starts `tick`, which fetches them and
adds the distill jobs. When they finish, `tick` builds the topic files and stops, and
the activity log says so.

Then:

1. **Separate comparison.** A fresh chat compares about 5 distillations with their
   transcripts, and lists what was lost, what was added, and where the speaker was made
   to sound more or less certain.
2. **The owner reads a few** and says if they carry the point and the color.
3. **Test page.** Write one topic page from its topic file alone. If it feels thin or gets
   something wrong, the distillations are at fault.
4. **Model test.** Distill the same few sources in chats on Luna and Sol, and set the app
   to the cheapest one that keeps topics and detail.
5. **Starter topics.** The `topics` skill tidies what the sample tagged, and `build-index.mjs`
   rebuilds `index/topics.md`. The owner looks it over.

Adjust the `distill` skill and repeat until these pass. Do not go on from a sample that
failed.

### 4. Distill everything

`pipeline.mjs queue --all --confirm` queues the rest, in shuffled order, and starts `tick`, which
fetches them and adds the "Read next source" jobs. Each run is a fresh chat that claims one step with
`pipeline.mjs next source`, does it, and marks it with `pipeline.mjs done`, which refuses work that fails
its check:

1. **Notes,** with the `distill` skill.
2. **Moments,** with the `moments` skill: the source's most colorful, accurate nuggets at their exact seconds.
3. **Align and gist,** with the `align` skill: a reader who wrote neither fixes both against the transcript,
   adds what was missed, and writes the gist and strongest picks.

A source that fails three times is left unmarked and reported, and the rest carry on.

**Check:** `pipeline.mjs status` shows every source done. The separate comparison runs on a
sample of later sources too, since quality can drift from the first batch.

### 5. Tidy the topics

`tick` rebuilds `index/` when the sources finish. The `topics` skill merges the names moments
were tagged with into the few real subjects, in `index/aliases.yaml`, drops names that are no subject (`humor: -`), splits what's too big, and arranges a topic tree.

**Check:** the owner has seen the tree and agrees it is what the site should be.

### 6. Write the pages

`pipeline.mjs queue --pages --confirm` queues the topics that pass the publish gate, strongest first,
and `tick` adds the "Write next page" job. Each run is a fresh chat with the `write-page`
skill:

1. Reads `SITE.md` and `index/topics/<topic>.md`: every moment on the topic with the notes around it.
2. For several channels or speakers, or a very large topic, writes their takes first.
3. Writes the page: attributes every claim to the speaker if named and the channel or site
   if not, cites a link with a timestamp, keeps quotes short, and shows disagreements and
   changes over time.
4. Sets `part_of`, `broader` and `related`, linking only to topics that exist.
5. Runs `node scripts/check.mjs pages <file>`, which confirms its quotes and citations trace back to `raw/`.

A second fresh chat then verifies it with the skill's `references/verify.md`: it opens the transcript at every
link and corrects merged details, the writer's rules credited to a speaker, a quote given the wrong reason, and
links far from their claim. The page is not ready until this has run.

A topic that fails the publish gate gets no page yet, or stays out of search.

### 7. Link and cross-check

The `cross-check` skill runs across all pages: missing links between related topics,
overlap between pages, one topic described two ways. `build-index.mjs` suggests related
topics by how often they share sections, and `npm run check` finds orphans and broken
links. AI decides if a connection is real and writes the sentence that makes a reader
want to follow it.

### 8. Build, review, publish

1. `npm run deploy`, which runs the checks. The first deploy opens production to the team
   only.
2. `tt-crawl shoot` and `tt-crawl measure` show the pages at phone and desktop widths, and
   the owner reads the site: the map, search, a few topic pages, and a few citations clicked
   through.
3. The owner makes it public, starting with the strongest pages in search.
4. Submit the sitemap in Search Console.

## Part 2: Keeping it up to date

### New videos and pages

`pipeline.mjs watch --confirm`, on the owner's yes, adds the standing jobs. The weekly "Check for
new sources" job, a command that costs no AI when nothing is new:

1. `sources.mjs list` finds what is new. If nothing is, it stops.
2. `pipeline.mjs queue --new --confirm` queues it and starts `tick`. The owner's yes to `watch` covers this.
3. `tick` fetches, adds the distill jobs and rebuilds `index/` when they finish. Before any
   page, one run with the `topics` skill sorts what the batch changed: each name the site
   hasn't used joins the topic a reader would look it up under, is dropped, or stays a new idea
   that waits under the gate for a second source; and each topic that has grown past 30 moments (checked
   again when it doubles) splits into questions a reader would look up apart, the old topic
   staying as the broader page, or stays whole when it is one point said many ways. No page is
   written while the sort is open. Then `tick` queues the pages whose moments changed and
   any new topics that now pass the gate, and adds the write job.
4. "Write next page" rewrites each of those pages whole from its topic file, keeping the
   verified links of the points it keeps, and a fresh run verifies it, starting with any link
   that closes two paragraphs. A big topic's file keeps every moment but only the notes that fit one read: the
   moments its page cites and the newest sources first.
5. Deploying follows the owner's choice. If they agreed to automatic deploys (`Automatic deploys: yes` in `SITE.md`), `tick` deploys
   once the checks pass. Otherwise, it posts an activity line saying pages are ready, and the
   owner asks for the deploy in chat.


### Changed websites

The monthly "Crawl websites" job re-reads the sites in place, and `pipeline.mjs` notices which
pages changed. Only those are distilled again, replacing the old distillation, and pages
citing them are queued.

### Removed sources and correction requests

`sources.mjs list --full` flags a video that has gone. A correction request comes through the footer's contact, and a person decides. When something is removed, delete its notes, moments and takes, and `index/topics.md`: the next `tick` rebuilds the index and queues every page that cited it.

## Part 3: Keeping the site healthy

### On every deploy (no AI)

`npm run check` blocks a deploy for:

- Broken internal links and pages nothing links to.
- Quotes that do not match `raw/` and citations that do not trace to a source.
- Missing titles, descriptions, canonical tags or structured data.
- Thin pages open to indexing.
- Private text from `raw/`, `distilled/` or `takes/` in `dist/`.
- HTML from source text that would run, or links with an unsafe scheme.
- AI tells found by `tropes`.

### Weekly (no AI)

The "Site health" job runs `tt-crawl audit` on production: broken links, SEO basics and sitemap
drift. A failure shows on Jobs and in the activity log.

### Monthly (AI)

The "Audit" job, with the `cross-check` skill. It reads the latest audit first, and stops early if
nothing has changed and nothing is wrong. Then:

1. **Citations.** Trace a random sample of points back to the sources.
2. **Overlap.** Find pages that have drifted to cover the same ground, and merge them.
3. **Topic names.** Merge duplicates that new sources added.
4. **Missing pages.** Find topics with enough evidence but no page.
5. **Search Console.** Which pages get seen, which are ignored, what people search for that the
   site does not answer yet, and where thin pages are hurting indexing.
6. **Popular topics.** Update what the home page surfaces.

It leaves what needs a person in a deliverable, and posts what it changed to the activity log.

## When something goes wrong

| Problem | Do this |
|---|---|
| A distillation keeps failing its checks | Leave it unmarked, report it, and don't publish from it |
| Fetching is blocked or out of credits | `tick` stops, keeps progress, and posts activity saying why |
| Jobs are skipped for time or AI credit | Jobs says why; the next tick picks up once it is paid |
| Runs get thinner over time | Delete the distill jobs, compare with the sample, fix the skill |
| A page contradicts its sources | Fix it from the distillation. If that is at fault, redo that distillation |
| The distill rules change | Distill a sample again and compare. Redo everything only if the difference matters, since it costs a full run |
