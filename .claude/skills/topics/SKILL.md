---
name: topics
description: Tidies the site's topics: merges names into the few subjects a reader would look up, drops names that are no subject, splits a topic that answers separate questions, and arranges a tree the owner checks. Use when asked to tidy, merge or split topics, or when `pipeline.mjs next` hands you a batch.
---

# Tidy the topics

The site's structure comes from this list. Done when `index/topics.md` reads like an outline of the subject, each topic that passes the gate is a page worth reading, and the owner has seen `index/tree.md`.

Run `node scripts/build-index.mjs`, then read `SITE.md` and `index/topics.md`. Names come from moments, so most are one-offs.

- **Merge hard.** In `index/aliases.yaml`, one `other name: name to keep` a line (a chain resolves to its end, and the rebuild prints the result), send every one-off into the plainest real subject it belongs to. A site has dozens of topics. Merge only into a topic it is about, never two ideas to make the numbers, and never away a topic that has a page: others merge into it. A real idea with one source waits under the gate. Open a topic file when you can't tell.
- **Split by question, not size.** A topic is several when its moments answer questions a reader would look up apart: "how big a bet" and "when to sell" under investing. Retag those moments in `moments/` with the narrower name first and the old one after it (`position sizing, risk management`), so the old topic becomes the broader page; nothing else there changes. The same point told fifty times is one topic, and so are the caveats, disagreements and changes of mind on one question. "Big enough to split" only says look.
- **A topic is something they have views on.** Two tests. As broad as the site: if it could be the site's title, it's the site ("investing" on an investing site). How they talk, not what about: humor, stories, preaching style and tone aren't subjects ("humor in sermons"). Would they say "here's what I think about ___"? A name that fails, or that no reader would look up, is dropped: `humor: -`. The rebuild says how many moments that leaves with no topic.
- **Tree:** `index/tree.md`, nested bullets from broad subjects down, each topic that passes the gate once. It's how pages get `broader` and `part_of`.

Rebuild after editing. Topic files are built; never edit them. Then show the owner the tree and the topics that pass.

**A batch.** When `pipeline.mjs next` hands you `pipeline/briefs/batch.md`, judge only what it lists, by the rules above. A new name joins a topic, is dropped, or stays a new idea under the gate; a big topic splits or stays whole. A kept name that passes the gate goes into `index/tree.md`, and a split-off one under the topic it came from. Say what you merged, dropped and split in one line.
