---
name: topics
description: Tidies the site's topics after a batch of sources: merges names into the few real subjects a reader would look up, splits what's too big, and arranges a tree the owner can check. Use when asked to tidy or merge topics, or when index/topics.md reads like a mess.
---

# Tidy the topics

The site's structure comes from this list. Done when `index/topics.md` reads like an outline of the subject, each topic that passes the gate is a page worth reading, and the owner has seen `index/tree.md`.

Run `node scripts/build-index.mjs`, then read `SITE.md` and `index/topics.md`. Names come from moments, so most are one-offs.

- **Merge hard.** In `index/aliases.yaml`, one `other name: name to keep` a line, send every one-off into the plainest real subject it belongs to. A site has dozens of topics, not hundreds. A name no reader would look up goes too. Open a topic file when you can't tell.
- **Split what's huge.** A topic marked big enough to split is several: change the tags in `moments/` for the ones that belong under a narrower name. Nothing else there changes.
- **A topic is something they have views on.** Two tests. As broad as the site: if it could be the site's title, it's the site, so it goes ("investing" on an investing site). How they talk, not what about: humor, stories, preaching style and tone aren't subjects ("humor in sermons"). Would they say "here's what I think about ___"? Move those moments to what they were actually about.
- **Don't merge two ideas to make numbers.** A real idea with one source can wait under the gate.
- **Tree:** `index/tree.md`, nested bullets from broad subjects down, each topic that passes the gate once. It's how pages get `broader` and `part_of`.

Rebuild after editing. Topic files are built; never edit them. Then show the owner the tree and the topics that pass.
