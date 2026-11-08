# Knowledge Nook: architecture

This is the design we build and check against as we
go; change it when the build teaches us something. `PROCESS.md` covers how the
app runs once it exists.

## What it is

An app that turns YouTube channels and websites into a public knowledge site
with no ads. A reader picks a topic and sees what the sources say about it, who
said it, when, and how the thinking changed, with every point linked to the
moment or page it came from.

The owner brings the channels and sites they have access to; the app does not
choose them. It has to work for any subject: science, teaching, comedy,
barbecue. Nothing in the pipeline may assume one kind of content.

## Decisions

1. **The read and moments are the center.** Every source gets a read, all it says in the speaker's voice in
   about a third of the words, and moments: its most colorful, accurate nuggets, each one line at its exact second. Later stages read these. Only scripts, align
   runs and page verify runs go back to the raw text.
2. **Reading does not judge.** Notes and moments record what was said, right or wrong. The
   only interpretation is choosing what a moment is about, which it may never say.
3. **No voice but the transcripts.** No opinion, knowledge or doubt of ours gets in. A source's page is a
   future version of the speaker, saying it all crisper, jokes and stories included, so a reader can read it
   instead of watching. A topic page is a student who knows only these transcripts, lecturing on them: the
   informed view stated plainly, conflicts given as point and counterpoint, footnotes instead of "so-and-so
   says". Clarity over cleverness. This replaces an earlier rule that pages attribute every claim, which made a
   reader referee between names. The site therefore states claims plainly; only the footnotes say whose.
4. **Transcripts and working files stay private.** Raw transcripts, crawled pages and takes never reach the
   site. A source's read, moments and gist are public by design.
5. **Topics come from reading, not keyword counts,** and they live on moments. Each moment
   gets one or two, and the `topics` skill merges them into the few real subjects a reader
   would look up. A topic on a whole source files nothing: that once made one topic of two
   whole interviews, 53 passages long, beside 259 names used once.
6. **One fresh AI run per source and per page.** Runs do not share context or
   edit each other's files, so sources can be processed in any order and a bad
   run can be redone alone. 200 videos means 200 chats, which is fine.
7. **Source text is data, never instructions.** Codex runs here with its sandbox
   off, because the machine is the boundary. A transcript that says "ignore your
   instructions" is something the speaker said, and nothing more.
8. **Say nothing when the data is missing.** No speaker name, chapters or publish
   date is normal. Leave the field out and never guess. A page then attributes to the
   channel or site, and a view that needs the data does not appear.
9. **The owner's rules win.** `SITE.md` ships with the app and is the owner's to edit:
   the subject, the audience, and what matters here (always keep temperatures on a
   barbecue site, always keep sample sizes on a science site). Every AI run reads it
   and follows it over a skill's defaults, so differences between subjects never get
   hardcoded.

## Who does what

The test: if the same input should always give the same answer, a script does it.
If it takes understanding, Codex does it, with its normal tools.

| Work | Done by |
|---|---|
| Calling vendors, numbering lines, keeping dates and URLs | Script |
| What is pending, who has what, what comes next | Script |
| Creating and removing jobs as work starts and ends | Script |
| Rebuilding the topic files, queueing pages that new material touched | Script |
| Coverage, quotes, dropped names and numbers, links, SEO | Script |
| Reading a source, a topic file or a page | Codex: `sed`, `grep`, its file tools |
| Notes, moments, gists, choosing topics | Codex |
| Merging topic names, writing pages, deciding if a link is real | Codex |
| What to build, what to publish, whether quality is good enough | The owner |

**Existing tools come first.** The pipeline adds only five scripts (under "Scripts"); the site has its own build and dev scripts.

| Need | Already exists |
|---|---|
| Reading and searching files | Codex's shell and file tools |
| Crawling sites, with dates where a feed or WordPress gives them | `tt-crawl pages`, `tt-crawl import` |
| Checking a live site: broken links, SEO basics, sitemap | `tt-crawl audit` |
| Seeing and measuring pages at phone and desktop widths | `tt-crawl shoot`, `tt-crawl measure` |
| Jobs, activity, deliverables, deploy, connections | The bridge, `~/tools/taskandtool.py` |
| AI tells | `tropes.mjs`, copied from the skills repository |
| Noticing changed files | The logic in Company Brain's `brain_status.py` |
| A site's build and its checks | The shape of the Website app's `scripts/build.ts` and `scripts/check.mjs`, cut to static pages |
| Search | The Pagefind command, run over `dist/` |
| Documents to markdown | `markitdown`, which comes with `tt-crawl` |
| Keeping source text from running as code | The approach in Company Brain's `safe-text` plugin |

## The pipeline

| Stage | Done by | Reads | Writes |
|---|---|---|---|
| 1. List sources | Script | A channel or site | `sources/` |
| 2. Fetch | Script | `sources/` | `raw/` |
| 3. Notes, one fresh run per source | Codex | `raw/`, `index/topics.md` | `distilled/` |
| 4a. Moments, another fresh run | Codex | `raw/`, `distilled/` | `moments/` |
| 4b. Align and gist, a third fresh run: the transcript decides | Codex | `raw/`, `distilled/`, `moments/` | Corrections in both, and the gist and strongest picks |
| 4c. Check each step | Script | The above | Pass, or findings to fix |
| 5. Build the topic files | Script | `moments/`, `distilled/`, `index/aliases.yaml` | `index/` |
| 6. Tidy topic names | Codex and the owner | `index/topics.md` | `index/aliases.yaml`, `index/tree.md` |
| 7. Write takes per speaker or channel, when useful | Codex | `index/topics/<topic>.md` | `takes/<speaker or channel>/<topic>.md` |
| 8. Write pages, one run per page | Codex | Topic files or takes | `content/` |
| 8b. Verify, one more fresh run per page | Codex | `content/`, `raw/` at each link | Corrections in `content/` |
| 9. Link and cross-check | Script and Codex | `content/`, `index/` | Links and findings |
| 10. Build and deploy | Script | `content/` | `dist/`, production |

Stages 3 to 6 run first on a sample. That produces the starter topic list every
later run reads, so 200 independent runs do not invent 200 names for one idea. A
run prefers a listed name and may add a new one; stage 6 merges what is left.

Stage 7 pays off with several speakers or a very large topic. With one channel
and a normal topic, stage 8 reads the topic file directly.

## Files

```text
SITE.md                 the owner's rules: subject, audience, what matters here
log.md                  append-only: what each pass read, wrote and changed
pipeline/state.json     what is queued, claimed, done and failed; only pipeline.mjs writes it
sources/                what to read: one list per channel or site, each source's state
raw/
  youtube/<channel>/    <date>-<video id>.md: numbered lines with timestamps
  web/<host>/           pages from tt-crawl
  docs/                 <date>-<name>.md: uploaded PDFs, slides and documents
distilled/              the same path as in raw/: the read, public on the source page
moments/                the same path as in raw/: the gist, strongest picks and moments, which are public
index/                  built by script, except aliases.yaml and tree.md
  topics.md             every topic with its number of sources: what a run reads first
  topics/<topic>.md     every moment on that topic, by source and date, with the notes around it
  aliases.yaml          names that are one topic, kept by the `topics` skill
  tree.md               how topics nest, kept by the `topics` skill
takes/                  <speaker or channel>/<topic>.md: one view in date order
content/                the pages' source: topics, guides, speakers, channels, sources
src/  styles/  static/  the site: Hono templates, Tailwind, visualizations
scripts/                the pipeline's and the site's scripts, all Node
.claude/skills/         one skill per kind of AI work; Codex sees them too
.taskandtool/setup.sh   dependencies and the web service; after-setup.sh adds tt-crawl
starter-app.json        the manifest: `ready` is the web service, `needs` suggests the
                        scrapecreators connection, and an empty chat offers to add a channel
```

`sources/`, `raw/`, `distilled/`, `moments/`, `index/`, `takes/`, `content/`, `pipeline/` and `log.md` are the
owner's working knowledge. As in Company Brain, they stay out of the app's git
repository and come back from platform backups on a replacement machine.

Topic files are the main working surface: plain markdown that Codex opens and
greps like anything else, rebuilt from the distillations, so no run ever edits
them and a change of alias only needs a rebuild.

### A raw transcript

The video's details first, whichever it has: title, channel, date, description and
chapters. Descriptions often name the guests. Then one numbered line per caption, so
a run reads it in ranges with `sed -n` and a quote can be checked by line:

```text
L0088 00:03:12 the words of that caption
```

### The read

```yaml
---
title: The video's title
source: youtube
url: https://youtube.com/watch?v=abc123
published: 2019-03-02
speakers: [only names the title, description or source itself gives]
---
```

Captions are unlikely to carry speaker labels, so `speakers` will often be absent, and a web page may have
no `published`. The one required structure: short sections, a few minutes each at most, each opening
`## 00:03:12` (a web page's location in place of the time). The rest follows the source.

### Moments

```markdown
---
title: The video's title
url: https://youtube.com/watch?v=abc123
---

## Gist

Their boldest claim and why, then their best story and what tempers it. Under 90 words.

## Strongest

- 00:09:32 Three to five lines, copied from below.

## Moments

- 00:09:32 | pricing | We raised prices 8% and lost two customers out of four hundred, if you trust our count.
```

## Pages

| Page | What it does | In search results |
|---|---|---|
| **Home** | The way in: search, a topic map, what is popular and rising | Yes |
| **Topic** | The narrative on one subject: what is agreed, what is debated, who says what, how it changed, claims only one source makes, what to read next | Once it passes the publish gate |
| **Guide** | Ordered steps or a tutorial, citing a source for each step | Once it passes the publish gate |
| **Speaker or channel** | One named person's or channel's views across topics, over time | Once it has enough substance |
| **Source** | One video or site: the gist and the whole read, beside a player the timestamps jump | Only when it has a gist and an open page cites it |
| **Compare** | This source against that one on a topic (later) | Case by case |
| **Search** | ⌘K on any page opens a command center over the page: results by kind, from Pagefind's search API. The full page adds filters by channel, speaker, topic and page type | No |
| **What's new** | New and updated pages, from `content/.dates.json`, which the build keeps: a page's date moves only when its words change | Yes |

**How topics relate.** Each point lives on the most specific page where it is
true. A broader page keeps a short summary and links to the narrower one. A
section becomes its own page when it outgrows a screen and has enough sources.
Pages declare their relationships in front matter, and the site renders the
links from those fields:

```yaml
type: topic
part_of: [how-to-build-a-landing-page]
broader: [copywriting]
related: [landing-page-social-proof]
```

**Visualizations.** All are ours, computed once at build time with D3 and sent as plain
HTML and SVG, so a reader loads no script and no data for them, and all their words are
real text and real links:

- On the home page, topics joined by lines to the videos they draw on, drawn once at build. Hovering either side lights what it connects to. Wide screens only; a phone gets the topic cards.
- A topic map of the main subjects, for the Topics page, once 3 topics are written: tiles
  grouped by `index/tree.md`, sized by how much the sources say, each with one of its videos behind a dark gradient.
- A picture for shared links on each topic and guide: `src/og.ts` draws a video's picture behind a dark gradient, with the title, at build time. No browser and no AI; each video is fetched once and kept in `.cache/`. A page without one shares its video's thumbnail.
- YouTube's public thumbnails, one at a time: untouched for a video, and for a topic a poster, the picture behind a dark gradient with the title on it. Never a stack, a collage or a face crop: all read as crowded.
- Related topics on each topic page as poster tiles (its own related ones first, then the nearest), when there are two or more.
- "Where this comes from" at the end of a written page: a chart of the videos it cites, by date, when there are two dates or more, then one row per video with the points cited from it.
- Beside the writing, the video being cited where you're reading, as a thumbnail from YouTube's public image address, and its line, large. The player loads on a click.
- Footnotes: a small number that reads past, a card on hover or tap with the source and its line, and a click that goes to our source page at that moment, not to YouTube.

**Calm by rule.** If a reader can see something, they can open it: a topic with no page never
shows publicly. Red means one thing, a citation: the footnote marks and the chart's dots. Timestamps are quiet gray, red on hover.

Each has a phone layout, and each page keeps its real text. The visuals are a
way in, not a replacement for the writing. They read only titles, dates, links and counts
from the working files, never a section's words.

**Popular and rising.** Before there is traffic, code ranks topics by how many
sources cover them and how recently. Then Search Console (already a connection)
shows what people search for. Reader events through a Worker come last, and
actions like opening a source count for more than clicks, since whatever is at
the top gets clicked most.

## The site

- **Hono and pre-rendering, from the Website Starter App.** Every page builds to
  static HTML, served from Cloudflare as static assets. The machine can sleep
  while the site serves.
- **Not Quartz.** It gives search, backlinks and a graph, but no page types or
  custom layouts, and it loads the whole content index in the browser. Pagefind,
  page front matter and D3 replace those three, and the views that make this site
  worth visiting are custom either way.
- **A little script, never required.** `static/site.js` keeps the contents with the scroll, lights the timeline and runs the command center. Every page reads and every link works without it.
- **Pagefind for search.** It runs over `dist/` at build time and needs no server. Citations are left out of its excerpts.
  Only the main content element is indexed (`data-pagefind-body`), with
  `data-pagefind-filter` for channel, speaker, topic and page type. It stems English, so no
  stemming of our own.
- **Source text never runs as code.** Pages are written from text the owner does not
  control, and the public reads them. HTML in markdown renders as plain text, a link
  or picture with a scheme other than web, mail or phone goes nowhere, and titles and
  topics lose their angle brackets. `npm run check` fails on anything that slips by.
- **No Worker yet.** `deploy` serves `dist/` as static assets and answers a missing page
  with `404.html`. Redirects would be the first reason for one. Search by meaning or an
  "ask" feature would come later, with a database.
- **No database at the start.** The first thing that may need one is logging
  reader events.
- **Size.** Cloudflare lists 20,000 files per Worker version on its free plan and
  100,000 on paid, 25 MiB per file, and Pagefind's index files count. Its Workers
  for Platforms page, which is how we deploy, lists no limit. Plan for under 20,000
  until a real deploy says otherwise.

## SEO

- Static HTML for every page, with a unique title and description.
- Clean, stable URLs, a canonical tag, `sitemap.xml` and `robots.txt`.
- Structured data: `Article` and `BreadcrumbList`. `VideoObject` and `Clip` only on
  a source page where the video can be watched.
- No review or rating markup. Google says not to aggregate ratings from other sites.
- Real update dates, and footnotes on every claim. No disclaimers or explanations of method: the links to every moment show it. A `Corrections` line in `SITE.md` puts a contact in the footer.
- **The publish gate.** Google's scaled content policy names mass AI pages, scraping,
  and stitching content together without adding value. So a thin page stays out of
  the sitemap with `noindex` unless it cites 2 sources and runs 300 words, counted from the
  page itself. The real gate comes earlier: no page gets queued until its topic has 2 sources
  giving at least 2 moments each and 5 in all (`Publish gate:` in `SITE.md`), so nothing thin
  needs padding, and a thin idea merges into a broader topic. A source page needs a gist and
  a citing page that is open.
  Filter and search results are never indexed.
- **Release in waves.** Start with the strongest pages and add more as they prove
  themselves in Search Console. `noindex: true` in a page's front matter holds it back.
- `npm run check` tests all of this before a deploy, and `tt-crawl audit` tests the
  live site.

## On the machine

The app lives on its sprite, like every Starter App. The repository is the app,
cloned to `~/app`. Dev is the `web` service on the team address. Production is
`npm run deploy`, and only a person can make it public.

### Getting transcripts

Through the `scrapecreators` connection and the machine's gateway, from a script.
YouTube blocks machines like ours, so we never fetch from it directly. The gateway
takes the machine token, so a command job can do this with no AI and no open chat.

| Need | Endpoint | Cost |
|---|---|---|
| A channel's videos, dates and lengths | `/v1/youtube/channel-videos`, paged by `continuationToken` | 1 credit per page |
| One video's description, chapters, keywords and date | `/v1/youtube/video` | 1 credit |
| One transcript, with `startMs`, `endMs` and `startTimeText` | `/v1/youtube/video/transcript` | 1 credit; free when no captions come back |

So a video costs about 2 credits.

Shorts and live streams have their own endpoints and are left out at first. Websites
come through `tt-crawl pages --external --images none`, with `tt-crawl import` for
dated posts. Neither needs AI. A page with no date sorts as undated.

Uploaded documents convert with `markitdown` into `raw/docs/`, dated by when they were
made if known. A citation points to the document and its section in place of a
timestamp. From there they follow the same pipeline.

### Answering in chat

The owner can ask the AI about the subject. It answers from the topic files with their
citations. An answer that took real synthesis across sources is worth keeping, so the AI
offers to make it a page, with the `write-page` skill, and the same checks and publish
gate apply.

### Manifest

`starter-app.json` shows suggestions in an empty chat based on which files exist, like
Company Brain's: add a channel while `sources/` holds none, write pages once
`index/topics.md` exists and `content/` has none, and deploy once pages exist.

### Scripts

Five for the pipeline, all Node, since the site already needs it and has a YAML parser. Each
is one command per workflow and follows the `agent-scripts` skill: usage, plain output,
exit codes, tests, and the `data` skill's `cli.mjs` for arguments and errors. They reach
the platform through the bridge's commands. Skills name a command and when to run it;
`--help` owns the flags.

A failure names the fix: `viewer.py check` in Company Brain prints the exact link to
write, and each finding from these scripts does the same (the file and line, what is
wrong, and what to write or run instead). `pipeline.mjs done` and `tick` append what
happened to `log.md`.

| Script | Does |
|---|---|
| `sources.mjs` | `list`: a channel or site's counts, hours and estimate, spending at most the listing's credits, and what to leave out (`--since`, `--min-minutes`, `--language`). `fetch`: pending sources into `raw/`, resuming after a stop, and needs `--confirm` since it spends credits. `crawl`: a website's pages into `raw/web/<host>/` through `tt-crawl`, and every known site again with no address |
| `pipeline.mjs` | The state of everything. `status`: what is pending at each stage, ignoring `tt-crawl`'s own reports and indexes. `queue`: what to work on, such as `--sample 20`, `--all` or `--pages`. `next`: claims one item with a lock, so jobs never take the same one. `done`: marks it once its check passes, so a run cannot pass work the check refuses. `tick`: see below. `watch`: the standing jobs, on the owner's yes |
| `check-distilled.mjs` | Coverage to the end with no unexplained gap, length (speech keeps 20% to 40%, and `SITE.md` can change that), thin stretches, quotes that really appear, names and numbers added or dropped, front matter. Any language. No `tropes`: distillations are private, and it flags a subject's own words ("leverage" on an investing channel); `scripts/check.mjs` runs it on public pages |
| `build-index.mjs` | `index/topics.md` and every `index/topics/<topic>.md`, applying aliases: each moment with its link and the notes around it. Related topics by shared moments. Which topics pass the publish gate, and which are big enough to split |
| `scripts/check.mjs` | `npm run check`, the shape of the Website app's, with `check-site.mjs` reading `dist/`: links, orphans, the publish gate, SEO, page quotes traced to `raw/`, `tropes`, no private text and no unsafe HTML or links in `dist/` |

### Skills

Codex is the agent we build on. Skills live in `.claude/skills/`, and each turn links
them so Codex and Claude Code both see them. Each stays short and holds only what
takes judgment, written with the `agent-instructions` skill and compared against a
bare prompt so it earns its place.

| Skill | When | What it covers |
|---|---|---|
| `distill` | The read, one source per run | A future version of the speaker: every idea and story, no fluff |
| `moments` | Moments, one source per run, a fresh run | The nuggets: color is the job, accuracy the limit |
| `align` | A third fresh run per source | Fixes moments and notes against the transcript, writes the gist and picks. A fresh reader has caught real errors on every kind of work tried here |
| `topics` | After a batch of distilling | Merging names, the topic tree |
| `write-page` | One page or speaker take at a time, then a second fresh run to verify it (`references/verify.md`) | The writing standard, attribution, page relationships. Verifying is not optional: three rounds of tightening the writing rules (Nov 2026) left figures and quotes right but kept producing the writer's own rules credited to the speaker and links minutes off, and a fresh reader with the transcript found them each time |
| `cross-check` | Before a first deploy and in the audit | Overlap, missing links, citation samples, Search Console |
| `site` | Changing how the site works | Templates, visualizations, SEO |

`tropes` is copied from the skills repository. The Website app's `design` skill does not fit:
it is built around a business's first screen and photographs. The look here is the tokens in
`styles/theme.css`, and the `site` skill covers changing it. The shared `writing` skill does
not fit either: it writes business copy from the owner's facts.

Adding a channel is mostly running scripts, so it gets no skill. AGENTS.md routes that
ask to `PROCESS.md` Part 1, routes other asks to the right skill, and lists each script
in one line.

### Scheduled jobs

Facts from `Workers.RunScheduledJob`, `Jobs` and the `schedule-job` skill that shape
this design:

- A command job runs with the machine token, so it can use the gateway and the bridge.
  It cannot call AI, because the AI token exists only during a turn. It gets 30 minutes
  and keeps 10,000 characters of output.
- A prompt job opens a new chat each run and lasts until the turn ends, with no
  30-minute limit. It uses the app's model. Jobs do not choose a model.
- **An app runs 3 jobs at once, counting commands and prompts together.** A job over
  that waits and tries again each minute, so the platform already limits the rate. A
  job never overlaps itself: if it is still running, that tick is skipped.
- A recurring job runs at most every 15 minutes. An app holds 25 recurring jobs, and
  one-off jobs do not count.
- One-off jobs stay listed on the Jobs tab for good, so 200 of them would bury it.
- When computer time or AI credit runs out, runs are skipped and Jobs says why.

So AI work runs as a few recurring jobs that each take the next item, and one command
job runs the machinery:

| Job | Type | When | Does |
|---|---|---|---|
| Run the pipeline | Command | Every 15 minutes, only while work is queued | `pipeline.mjs tick` |
| Read next source | Prompt, 2 copies | Every 15 minutes, only while sources are queued | `pipeline.mjs next source` hands out one step on one source: notes, moments or align, each with its skill |
| Write next page | Prompt, 1 | Every 15 minutes, only while pages are queued | `pipeline.mjs next page`, then the `write-page` skill |
| Check for new sources | Command | Weekly | `sources.mjs list` and `pipeline.mjs queue --new`. No AI when nothing is new |
| Crawl websites | Command | Monthly, if there are sites | `sources.mjs crawl`; changed pages are queued |
| Site health | Command | Weekly, once deployed | `tt-crawl audit`. A failure shows on Jobs and in Activity, with no AI |
| Audit | Prompt | Monthly | The `cross-check` skill; each run costs a full AI turn |

**`pipeline.mjs tick`** moves the queue along with no AI. It fetches what is pending
(stopping before the job's 30 minutes), adds the distill jobs when sources are ready,
rebuilds `index/` when distilling finishes, queues the pages that new sections touched,
adds the write job, removes each job when its queue is empty, posts activity, and
removes itself when nothing is left. After a vendor stops it (out of credits, a refusal) it says
so once and waits 6 hours before asking again. It uses the bridge's `schedule-job`, `list-jobs`
and `unschedule-job`. It only ever works through what was queued, so a person's
`pipeline.mjs queue` is the gate before a sample or a whole channel.

Pages wait until no source is pending or claimed, so a page never misses a section
still being written.

Two jobs at 15-minute ticks handle up to 8 runs an hour, so about 3 sources with their
three runs each, about 75 hours for 200 videos, and leave a slot for `tick`. The machine sleeps between runs, and deleting
the jobs stops everything at once. A prompt run that finds an empty queue stops, and
`tick` removes its job by the next pass, so an idle queue costs at most a small turn or
two.

## Cost

Measured in Nov 2026 from Codex's session logs on 11 real videos (10.8 hours), priced at GPT-6.1 Sol in
`lib/task_tool/ai/pricing.ex` ($2 fresh input, $0.10 cached, $10 output per million). These are estimates: the
runs used `gpt-5.6-sol`, and any long-context pricing is left out.

| Work | Cost |
|---|---|
| A source's notes, moments and align | About $0.70 to $0.90 per hour of video, so $0.45 to $0.60 per 40 minutes |
| A page, written and verified | About $0.30 to $0.50 |
| Tidying topics | Under $1 a pass |

200 one-hour videos come to about $150, plus pages and transcript credits (about 2 a video). Each run re-sends its
context with every step, so most tokens are cached input: tens of millions for a site, at a tenth of the price.
Cost splits about evenly between fresh input, cached input and output. Codex's own "tokens used" line leaves
cached input out. Luna costs a twentieth of Sol, but lost too much on the first test.

## How the flow was chosen

Tested in Nov 2026 on two videos, an interview and a sermon: the same transcript through different `AGENTS.md`
and skills from the same tiny prompt, three runs each, judged by blind readers who listed the best points before
opening any output. A direction, not proof:

- Notes then verify then moments then gist came last with both readers, and cost the most. Bare runs with no
  skills came near the bottom, overlong, and often failed the check.
- All 36 skill runs in the first round opened the right skill from a tiny prompt and a 50-word `AGENTS.md`.
- The biggest gain came from the skill: naming color as the job, with examples from other videos, moved outputs
  from the bottom half to the top under both readers. Pushed too far it picked jokes over the point, which a
  second pass at the skill corrected.
- Moments then gist was about as good for source pages, at a bit over half the cost. One reader on two topic
  pages: pages with notes beat pages from moments on a heavy topic, and tied on a thin one. So notes stay.

## Build order

Each step ends with something we can look at before starting the next. Steps 1 to 5 run
in a folder on a computer with `codex exec`; only steps 6 and 8 need a real machine.
All nine are built. Steps 6, 8 and 9 have run only on a computer, with stand-ins for the
bridge and ScrapeCreators, so their first real run is still to do.

1. **Fetch.** `sources.mjs`, the raw format. Look at: a few real numbered transcripts.
2. **Distill by hand.** The `distill` skill, on a few sources of different kinds, next
   to a bare prompt on the same sources. Look at: are they dense, do they keep the color,
   did Codex read the whole source, and does the skill beat the bare prompt? Everything
   rests on this step.
3. **Check.** `check-distilled.mjs`, and a separate run comparing distillations to
   transcripts. Look at: what gets lost, then fix the skill.
4. **Topics.** `build-index.mjs` and the `topics` skill. Look at: does the list read like
   an outline of the subject, and are the topic files useful to read?
5. **One page from markdown.** The `write-page` skill, on one topic and one guide, with no
   site yet. Look at: is it good using distillations alone?
6. **Site.** Hono pages, Pagefind, SEO, `npm run check`, deployed to the team.
7. **Visuals.** The topic map first, from real data, then the timeline and who says what.
8. **Jobs.** `pipeline.mjs`'s `next`, `done` and `tick`, and the recurring jobs, on a real
   machine with a small channel.
9. **Packaging.** `setup.sh`, `starter-app.json`, AGENTS.md, the repository and the listing.

## Questions to settle while building

1. **The publish gate's numbers.** Tune them on real pages.
