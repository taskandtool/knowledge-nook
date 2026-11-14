---
name: write-page
description: Writes one public topic page or guide from the transcripts alone, every point footnoted, then verifies it in a second fresh run. Use when writing, rewriting or verifying a topic page, guide or speaker page, or when `pipeline.mjs next page` hands you one. One page per run.
---

# Write a page

You went to school on these transcripts. They're your teachers, you know nothing outside them, and now you're lecturing the class on this topic. Done when `content/<type>s/<slug>.md` exists and `node scripts/check.mjs pages <that file>` passes. A second fresh run verifies it, with `references/verify.md`; the writer never does.

Read `SITE.md`, then `index/topics/<slug>.md`: every moment on this topic with its link, and the speakers' own account around it. Write only from that, never `raw/` and never what you already know.

- **Teach it straight.** Say what your teachers hold true, plainly, as the informed view. No "so-and-so says", no "according to", no "in his view". The footnotes show where it came from.
- **Nothing of yours.** No outside facts, no second-guessing, and no comment on how good an example is. Doubt only where your teachers give it: a caveat of theirs, or two of them conflicting.
- **Where they disagree, say so.** Give each view with its reason and footnote; naming who holds it is optional. A view that changed over time gets both, dated.
- **Weight by repetition.** A point they come back to across sources leads, told once with its strongest footnotes. It never gets more sentences.
- **Each story once on the site.** A moment marked `Told on:` belongs to that page: here, give it one sentence and a link there. Do the same for each narrower page `pipeline.mjs next` lists.
- **Be clear, not clever.** A reader who knows nothing follows every sentence. A heading says its point: "Stretch after you run, not before", never "The stretching myth".
- **Keep it alive.** Their stories, numbers and jokes, told crisply. A name belongs in a story, never as a source: "A vending machine ate Ortiz's last dollar" is fine.
- **As long as the material, no longer.** No restating, no sentence that only says why another matters, and nothing about the page itself.

Commentary: The empty nets supply Ortiz's sharpest example, and in her reading a bad night is no evidence against the calling.
Teaching: A bad night may give you a reason to quit, but the calling came before the catch. The disciples fished all night for nothing and went out again in the morning.

Pointer: The empty-nets story is told under [calling](/topics/calling/), where it belongs.
Point: One empty night says little about [a calling](/topics/calling/): the disciples went out again in the morning.

A footnote closes a point, to the moment's second: `[1](https://www.youtube.com/watch?v=abc&t=620s)`. Only a `Moment` line has a link to give; leave out a story found only in the notes. Usually one or two a paragraph: sentences from one moment share one, and a figure or quote gets its own. Never one per sentence. The site turns these into footnotes.

```markdown
---
type: topic
title: Tight and clear, like Stretch after you run, not before
description: One sentence of the view itself.
topic: the topic
broader: [only topics in index/tree.md]
related: [only topics in index/tree.md]
---

Text, with links. `## Headings` only where the page needs them. No `#` heading: the title is above.
```

`noindex: true` holds a page out of search. A guide's steps are theirs: where they give no order, say the order is the page's.
