# Knowledge Nook

**A searchable website your AI agent builds from YouTube videos and websites
and changes by chat.** The agent writes a page for each topic the videos
cover. You can click any point to hear it at the second it was said.

[![Deploy on Task & Tool](https://taskandtool.com/images/deploy-button.svg)](https://taskandtool.com/accounts/register?starter_app=knowledge-nook)

![A Knowledge Nook topic page, the video it cites, and the chart of topics and videos](https://taskandtool.com/images/starter-apps/knowledge-nook.webp)

It's made to run on Task & Tool. On Task & Tool your AI agent gets a
computer for this app. The agent reads the videos' captions there, writes
the pages and checks the quotes against the transcripts. The site is built
with Hono, Tailwind and Pagefind. The agent publishes it as static pages on
Cloudflare.

## Get started

Click the button above, or pick Knowledge Nook when you create an app on
[Task & Tool](https://taskandtool.com/starter-apps/knowledge-nook). Then
paste a YouTube channel or a website into the chat.

See it in use on the [Knowledge Nook
page](https://taskandtool.com/starter-apps/knowledge-nook).

## Features

### Topic pages from what your videos say

The agent writes a topic page only from the sources and gives every point a
footnote. Hover over a footnote to see the line and its time. Click it to
play the video from that second in the player beside the page. The agent
keeps quotes to 30 words. It checks them against the transcript and fixes
any it can't find there. Besides topics, the agent can write guides and
speaker pages.

![A topic page, Separate conviction from excitement, beside the video it cites](https://taskandtool.com/images/marketing/knowledge-nook-topic.webp)

### A fresh agent checks the pages against the transcripts

When a page is written, a fresh run of the agent opens the transcript at
every link. It corrects details from two videos merged into one, quotes
given the wrong reason, and links placed far from the point they support. A
page isn't ready until this run has passed.

### Read a video instead of watching it

The agent rewrites each video the way the speaker would say it with the
repetition cut. It keeps the stories and jokes. The written version is 20%
to 40% as long as the spoken words. You can change that range in `SITE.md`.
A video's page has the player, this written version and its highlights:
short lines at their exact seconds. Click a highlight to start the video
there.

### The agent sorts the highlights into topics

The agent files every highlight under its topics. When two names mean the
same subject, the agent merges them. When a topic grows past 30 highlights,
the agent splits it into the separate questions a reader would look up. A
topic gets a page once 2 sources give it at least 2 highlights each and 5 in
all. You can change those two numbers in `SITE.md`. On a wide screen, hover
over a topic on the home page to highlight the videos about it. Once 3
topics have pages, the topics page has a map of them. A topic gets a bigger
box the more the sources say about it.

![The topics chart. Options trading is lit up and linked to the five videos that cover it](https://taskandtool.com/images/marketing/knowledge-nook-chart.webp)

### Visitors can search the whole site

Press ⌘K, or Ctrl K, on any page. Search results are grouped into topics,
guides, speakers, channels, sources and highlights. The matching words are
marked in the results. The search index is built with the site and needs no
server.

<img src="https://taskandtool.com/images/marketing/knowledge-nook-search.webp" width="420" alt="A search for nvidia that found topics and sources">

### Sources can be your channel, any public channel or a website

One site can use several channels and websites.

| Source | How the agent reads it |
|---|---|
| Your own channel | Through your YouTube connection, at no cost. YouTube allows captions for about 40 videos a day. A big channel takes days. |
| Any public channel | Through ScrapeCreators, a paid service, for about 2 credits a video |
| Websites | With [`tt-crawl`](https://github.com/taskandtool/crawler), our crawler, at no cost. The agent also reads a site's dated posts if it has a feed. |

A video with no captions costs nothing. Captions often come late. The agent
tries such a video again until it is 14 days old.

### The cost before any work starts

The agent lists a channel's videos first and tells you the count, the hours,
the credits, the AI cost and the time. Then it reads about 20 videos from
across the channel's history as a sample. You read a few, and the agent
adjusts its rules before it reads the rest.

### Scheduled updates

Once you say yes, the agent adds the jobs that apply to your site. Site
health needs the site's address in `SITE.md`.

| Job | When | What it does |
|---|---|---|
| Check for new sources | Every Monday | Reads new videos and rewrites the pages they change. No AI cost when nothing is new. |
| Crawl websites | The 1st of each month | Reads each site again and rewrites the pages that cite a changed page |
| Site health | Every Monday | Checks production for broken links, SEO basics and sitemap drift |
| Audit | The 1st of each month | Traces a sample of citations, merges pages that overlap, and finds topics with enough material but no page |

The agent tells you when new pages are ready. You ask it to publish them in
the chat.

### Checks before every deploy

The agent runs `npm run check` and fixes what it finds. A deploy can't go
out while any of these fail:

| Check | What it catches |
|---|---|
| Quotes | Quotes that aren't in the transcript or run over 30 words, links to a second the video doesn't have, and a quote or figure more than 4 minutes from the second its link opens |
| Writing | Lines that report a speaker ("he argues") instead of making the point, and phrases that read as AI |
| SEO | Missing titles, descriptions, canonical tags or structured data, thin pages open to search, and a sitemap that doesn't match the pages |
| Links | Broken links and anchors, and pages nothing links to |
| Copying and safety | 40 words in a row copied from the agent's private files, HTML from a source that would run, and unsafe links |

### Skills in this repo

A skill is a set of instructions the agent loads when a task needs it. This
repo has 8:

| Skill | What it does |
|---|---|
| `distill` | Writes a video's or page's written version |
| `moments` | Picks a source's highlights at their exact seconds |
| `align` | Checks the highlights and written version against the transcript, and writes the summary |
| `topics` | Merges, drops and splits topics, and arranges the topic tree |
| `write-page` | Writes a topic page, guide or speaker page, then checks it in a second run |
| `cross-check` | Audits the site as a whole: citations, overlap and missing links |
| `site` | Changes how the site looks or works |
| `tropes` | Spots phrases that read as machine-written |

The agent uses scripts for the steps that need no AI. A fresh run of the
agent does each AI step on one video or page. Each script has a `--help`.
`npm test` runs the tests on the scripts and the site. They use stand-ins
for ScrapeCreators and YouTube and cost nothing.

### Static pages on Cloudflare

The agent builds the pages as plain HTML files before it publishes them.
Cloudflare serves the files from servers near each visitor. The app's
computer can sleep while people read the site. The agent also builds the
sitemap, `robots.txt` and structured data for Google. Once `SITE.md` has the
site's address, the agent also draws a share picture for each written page.

## Why run it on Task & Tool

Task & Tool is the easiest place to run it: the agent has the YouTube and
ScrapeCreators connections and the scheduled jobs it needs. You get:

- Its own computer for the agent
- A dev address your team opens to see the site before it goes live
- Publishing on your own domain with a free SSL certificate. Only your team
  sees production until you make it public.
- Connections to YouTube, ScrapeCreators and other services. Task & Tool
  keeps their keys out of this repo.
- Scheduled jobs for the new videos, crawls and audits above

## Make it your own

Ask the agent for any change in the chat. To start from your own copy, fork
this repo, change what you like, and start a new app from your fork on Task
& Tool. You can also copy its skills from `.claude/skills/` into another
repo.

## What's in the repo

```
src/              the site: pages, layout, topic map and share pictures
static/           the site's browser script, and the built CSS
styles/           the Tailwind theme
scripts/          reading sources, the pipeline, the checks and the build
test/             the tests, with stand-ins for ScrapeCreators and YouTube
.claude/skills/   the 8 skills
SITE.md           your rules for the site: its subject, publish gate and deploys
PROCESS.md        each step from a new channel to a healthy site
AGENTS.md         what the agent reads first
.taskandtool/     setup for an install on Task & Tool
starter-app.json  what the app needs and its chat suggestions
```

The agent keeps the transcripts, written versions, highlights, topic index
and pages in `sources/`, `raw/`, `distilled/`, `moments/`, `takes/`,
`index/`, `content/` and `pipeline/` on the app's computer. None of those
folders are in the repo.

## Commands

The agent runs these on the app's computer. With Node 20 or later, you can
run the site on your own computer too: `npm install`, then `npm run dev`. It
has no pages until `content/` has some.

- `npm run dev` serves the site on localhost:3000. It reads the pages fresh
  on every request and restarts when the code changes.
- `node scripts/sources.mjs list @channel` lists a channel's videos with
  their hours and credits.
- `node scripts/sources.mjs crawl <url>` reads a website's pages into
  `raw/web/`.
- `node scripts/pipeline.mjs status`: what is at each stage.
- `node scripts/pipeline.mjs queue`: previews the cost of new work. With
  `--confirm`, it queues that work.
- `npm run check` runs the checks above, and `npm test` runs the tests.
- `npm run build` writes the site to `dist/`.
- `npm run deploy` runs the checks and publishes the site to production. It
  works only on Task & Tool.

## Third-party tools

- [`tt-crawl`](https://github.com/taskandtool/crawler), our crawler, for
  reading websites.
- npm packages: `hono`, `@hono/node-server`, `marked`, `pagefind`,
  `tailwindcss` + `@tailwindcss/cli`, `tsx`, `node-html-parser` (MIT);
  `d3-hierarchy`, `yaml` (ISC); `satori`, `@resvg/resvg-js` (MPL-2.0);
  `typescript` (Apache-2.0); Schibsted Grotesk via `@fontsource` (OFL-1.1).

## Contributing

Pull requests are welcome. The repo holds no credentials.

## License

MIT. See `LICENSE`.
