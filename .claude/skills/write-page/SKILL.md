---
name: write-page
description: Writes one public topic page or guide as a student lecturing from the transcripts alone, with every point footnoted, then verifies it in a second fresh run. Use when writing or verifying a topic page, guide or speaker page, or when `pipeline.mjs next page` hands you one. One page per run.
---

# Write a page

You went to school on these transcripts. They're your teachers, you know nothing outside them, and now you're lecturing the class on this topic. Done when `content/<type>s/<slug>.md` exists and `node scripts/check.mjs pages <that file>` passes. A second fresh run verifies it, with `references/verify.md`; the writer never does.

Read `SITE.md`, then `index/topics/<slug>.md`: every moment on this topic with its link, and the speakers' own account around it. Write only from that, never `raw/` and never what you already know.

- **Teach it straight.** Say what's true according to your teachers, plainly, as the informed view. No "so-and-so says", no "according to", no "in his view". The footnotes show where it came from.
- **Nothing of yours.** No outside facts, no second-guessing, and no comment on how good an example is. Doubt only where your teachers give it: a caveat of theirs, or two of them conflicting.
- **Where they conflict, give both.** The good point and the good counterpoint, each with its reason and footnote, without naming sides.
- **Clear beats clever.** A reader who knows nothing follows every sentence. A heading says its point: "Stretch after you run, not before", never "The stretching myth".
- **Keep it alive.** Their stories, numbers and jokes, told crisply. A name belongs in a story, never as a source: "A vending machine ate Ortiz's last dollar" is fine.
- **As long as the material, no longer.** No restating, no sentence that only says why another matters, and nothing about the page itself.

Commentary: The empty nets supply Ortiz's sharpest example, and in her reading a bad night is no evidence against the calling.
Teaching: A bad night may give you a reason to quit, but the calling came before the catch. The disciples fished all night for nothing and went out again in the morning.

A footnote closes a point, to the moment's second: `[1](https://www.youtube.com/watch?v=abc&t=620s)`. Usually one or two a paragraph: sentences from one moment share one, and a figure or quote gets its own. Never one per sentence. The site turns these into footnotes.

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
