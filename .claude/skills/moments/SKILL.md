---
name: moments
description: Pans one source for its most colorful, accurate nuggets, each one short line at its exact second, in moments/. Use when asked for moments on a file in raw/.
---

# Moments

Pan for gold, and write as them. A nugget is what only this person would say: a strong take, a surprising claim, a number that lands, a story with a point, a move they made. Color is the job; a flat line is a failed line. Done when someone scanning the list wants to watch the video, and `node scripts/check-moments.mjs <file>` passes.

Read `SITE.md`, then the whole source in ranges. If `distilled/<same path>` exists, read it too, but every moment comes from the transcript. Write `moments/<same path>`.

**The test: could anyone else have said this?** If so, rewrite it with what only they said, or cut it.

- Keep their own stakes, numbers, names, stories, jokes and anger. Use their words where they're the color.
- A punchline stays as they said it; reported speech kills it.
- Color comes from them, never you. Add no word they didn't say. A guess stays a guess, and a caveat stays on its claim.
- What they did stays what they did: "I levered up", never "lever up". A voice they're putting on isn't them.
- Two points stay two lines; don't fuse them for punch. A joke earns a line when it carries a point or shows who they are.
- One line, one idea, at most 25 words, in their voice: "I paid $41 for my first share", never "he". Start with the point.
- Time is the second of the caption where they say it, never a preview clip at the start. Highlights, not quotes: say the point, and use quote marks rarely, only for words too good to touch. A host's point opens with their name: `Lee: budgets fail.` A web page or document has no seconds, so its lines all read 00:00:00.
- Topics are one or two short plain things they have views on, the same across sources: a topic in `index/topics.md` when one fits. A real subject, not this one point, not the site's whole subject, and not how they talk ("humor").
- It averages one every 2 or 3 minutes. A dull stretch gets none, and a great one gets four.

Flat: Everyday observations can reveal investment opportunities before the experts see them.
Nugget: Our corner shop sold out of oat milk by nine every Saturday, so at 15 I put $300 of birthday money into the brand. It tripled. The signal is not in spreadsheets.

Flat: Failure can be a useful motivator.
Nugget: I keep the bib from the marathon I quit at mile 19 taped inside my closet door, so I see it every morning.

Lost caveat: Her first trade tripled her money.
Kept: That oat milk bet tripled, and there was luck in it: at that age I had no real way to vet it.

```markdown
---
title: from the raw file
url: from the raw file
speakers: [only names the source gives]
---

## Moments

- 00:25:37 | topic, topic | The line.
```
