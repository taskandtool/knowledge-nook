# Knowledge Nook

**A searchable website your AI agent builds from YouTube videos and
websites.** You change it by asking the agent in the chat. The agent writes
a page for each topic in the videos. Click any point on a page to hear the
speaker say it.

[![Deploy on Task & Tool](https://taskandtool.com/images/deploy-button.svg)](https://taskandtool.com/accounts/register?starter_app=knowledge-nook)

![A Knowledge Nook topic page, its source video, and the chart of topics and videos](https://taskandtool.com/images/starter-apps/knowledge-nook.webp)

It's made to run on Task & Tool. Your AI agent gets a computer there for
this app. The agent reads the videos' captions there, writes the pages and
checks the quotes against the transcripts. The site is built with Hono,
Tailwind and Pagefind. The agent publishes it as static pages on Cloudflare.

## Get started

Click the button above, or pick Knowledge Nook when you create an app on
[Task & Tool](https://taskandtool.com/starter-apps/knowledge-nook). Then
paste a YouTube channel or a website into the chat.

See it in use on the [Knowledge Nook
page](https://taskandtool.com/starter-apps/knowledge-nook).

## Features

### Topic pages from what's said in your videos

The agent writes a topic page only from the sources and gives every point a
footnote. Hover over a footnote to see the line and its time. Click it to
play the video from that second in the player beside the page. The agent
keeps quotes to 30 words. It checks them against the transcript and fixes
any it can't find there. Besides topics, the agent can write guides and
speaker pages.

![A topic page, Separate conviction from excitement, beside its source video](https://taskandtool.com/images/marketing/knowledge-nook-topic.webp)

### A second agent checks the pages against the transcripts

After the agent writes a page, a second agent reads the transcript at each
link. It fixes details mixed up from two videos, quotes used for the wrong
point, and links far from the point they back up. A page isn't ready until
that agent passes it.

### Read a video instead of watching it

The agent rewrites each video in the speaker's voice and cuts the
repetition. It keeps the stories and jokes. The written version is 20% to
40% as long as the spoken words. You can change that range in `SITE.md`. A
video's page has the player, this written version and its highlights: short
quotes, each linked to its second in the video. Click a highlight to start
the video there.

### The agent sorts the highlights into topics

The agent puts each highlight under the topics it's about. It merges two
topics that are one subject under two names. When a topic has more than 30
highlights, the agent splits it into the separate questions a reader would
look up. The agent writes a topic's page once the topic has 5 highlights and
2 of its sources have at least 2 each. You can change those two numbers in
`SITE.md`. On a wide screen, hover over a topic on the home page to light up
the videos about it. Once 3 topics have pages, the topics page has a map of
them. The more material a topic has, the bigger its box.

![The topics chart. Options trading is lit up and linked to its five videos](https://taskandtool.com/images/marketing/knowledge-nook-chart.webp)

### Visitors can search the whole site

Press ⌘K, or Ctrl K, on any page. Search results are grouped into topics,
guides, speakers, channels, sources and highlights. The matching words are
marked in the results. The search index is built with the site. There's no
server to run.

<img src="https://taskandtool.com/images/marketing/knowledge-nook-search.webp" width="420" alt="Topics and sources in a search for nvidia">

### Sources can be your channel, any public channel or a website

You can use several channels and websites on one site.

| Source | How the agent reads it |
|---|---|
| Your own channel | Through your YouTube connection, at no cost. You can get captions for about 40 videos a day from YouTube. The agent needs days for a big channel. |
| Any public channel | Through ScrapeCreators, a paid service, for about 2 credits a video |
| Websites | With [`tt-crawl`](https://github.com/taskandtool/crawler), our crawler, at no cost. The agent also reads a site's dated posts if it has a feed. |

A video with no captions costs nothing. New videos often have no captions
yet. The agent keeps trying until the video is 14 days old.

### The cost before the agent starts

The agent lists a channel's videos first and tells you the count, the hours,
the credits, the AI cost and the time. Then it reads about 20 videos from
across the channel's history as a sample. You read a few. Then the agent
adjusts its rules and reads the rest.

### Scheduled updates

Once you approve the work, the agent adds the jobs for your site. Put the
site's address in `SITE.md` to turn on the Site health job.

| Job | When | What the agent does |
|---|---|---|
| Check for new sources | Every Monday | Reads new videos and rewrites any page with new material. No AI cost when nothing is new. |
| Crawl websites | The 1st of each month | Reads each site again and rewrites the pages built on a changed page |
| Site health | Every Monday | Checks production for broken links, SEO basics and sitemap drift |
| Audit | The 1st of each month | Traces a sample of citations, merges overlapping pages, and finds topics with enough material but no page |

The agent tells you when new pages are ready. Then ask it in the chat to
publish them.

### Checks before every deploy

The agent runs `npm run check` and can't deploy until it has fixed
everything below:

| Check | What counts as a problem |
|---|---|
| Quotes | Quotes that aren't in the transcript or are over 30 words, links to a second the video doesn't have, and a quote or figure more than 4 minutes from the time in its link |
| Writing | Lines like "he argues" in place of the point itself, and AI-sounding phrases |
| SEO | Missing titles, descriptions, canonical tags or structured data, thin pages open to search, and a sitemap that doesn't match the pages |
| Links | Broken links and anchors, and pages with no links to them |
| Copying and safety | 40 words in a row copied from the agent's private files, runnable HTML from a source, and unsafe links |

### Skills in this repo

A skill is a set of instructions the agent loads when it needs them. This
repo has 8:

| Skill | Used for |
|---|---|
| `distill` | Rewriting a video or web page in fewer words |
| `moments` | Picking a source's highlights and the second each one starts |
| `align` | Checking the highlights and written version against the transcript, and writing the summary |
| `topics` | Merging, dropping and splitting topics, and arranging the topic tree |
| `write-page` | Writing a topic page, guide or speaker page, then checking it in a second run |
| `cross-check` | Auditing the whole site: citations, overlap and missing links |
| `site` | Changing how the site looks or works |
| `tropes` | Spotting machine-sounding phrases |

The agent uses scripts wherever no AI is needed. A new agent session does
each AI step, one video or page at a time. Each script has a `--help`. Run
`npm test` to test the scripts and the site. The tests have stand-ins for
ScrapeCreators and YouTube and cost nothing.

### Static pages on Cloudflare

The agent builds the pages as plain HTML files before it publishes them.
Visitors get the files from Cloudflare servers near them. People can read
the site while the app's computer is asleep. The agent also builds the
sitemap, `robots.txt` and structured data for Google. Once `SITE.md` has the
site's address, the agent draws a share picture for each written page.

## Why run it on Task & Tool

Task & Tool is the easiest place to run it: the agent has the YouTube and
ScrapeCreators connections and the scheduled jobs it needs. You get:

- Its own computer for the agent
- A dev address your team opens to see the site before you publish it
- Publishing on your own domain with a free SSL certificate. Only your team
  sees production until you make it public.
- Connections to YouTube, ScrapeCreators and other services. We keep their
  keys out of this repo.
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
run the site on your own computer too: `npm install`, then `npm run dev`.
The site has no pages until `content/` has some.

- `npm run dev`: the site on localhost:3000. You see page and code changes
  on the next reload.
- `node scripts/sources.mjs list @channel`: a channel's videos with their
  hours and credits.
- `node scripts/sources.mjs crawl <url>`: a website's pages, saved to
  `raw/web/`.
- `node scripts/pipeline.mjs status`: what is at each stage.
- `node scripts/pipeline.mjs queue`: the cost of new work. Add `--confirm`
  to queue it.
- `npm run check`: the checks above. `npm test`: the tests.
- `npm run build`: the site, built into `dist/`.
- `npm run deploy`: run the checks and publish the site to production. You
  can run it only on Task & Tool.

## Third-party tools

- [`tt-crawl`](https://github.com/taskandtool/crawler), our crawler, for
  reading websites.
- npm packages: `hono`, `@hono/node-server`, `marked`, `pagefind`,
  `tailwindcss` + `@tailwindcss/cli`, `tsx`, `node-html-parser` (MIT);
  `d3-hierarchy`, `yaml` (ISC); `satori`, `@resvg/resvg-js` (MPL-2.0);
  `typescript` (Apache-2.0); Schibsted Grotesk via `@fontsource` (OFL-1.1).

## Contributing

Pull requests are welcome. There are no credentials in the repo.

## License

MIT. See `LICENSE`.
