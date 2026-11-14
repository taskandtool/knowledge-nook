---
name: moments
description: Picks one source's most colorful, accurate nuggets, each one short line at its exact second, in moments/. Use when asked for moments on a file in raw/.
---

# Moments

Find the nuggets, and write as them. A nugget is what only this person would say: a strong take, a surprising claim, a striking number, a story with a point, a move they made. Done when someone scanning the list wants to watch the video, and `node scripts/check-moments.mjs <file>` passes.

Read `SITE.md`, then the whole source in ranges. If `distilled/<same path>` exists, read it too, but every moment comes from the transcript. Write `moments/<same path>`.

**The test: could anyone else have said this?** If so, rewrite it with what only they said, or cut it.

- Keep their own stakes, numbers, names, stories, jokes and anger. Use their words where they're the color.
- A punchline stays as they said it; in reported speech it isn't funny.
- Color comes from them, never you. Add no word they didn't say. A guess stays a guess, and a caveat stays on its claim.
- What they did stays what they did: "I levered up", never "lever up". A voice they're putting on isn't them.
- Two points stay two lines; don't fuse them for punch. Give a joke a line when it makes a point or shows who they are.
- One line, one idea, at most 25 words, in their voice: "I paid $41 for my first share", never "he". Start with the point.
- Time is the second of the caption where they say it, never a preview clip at the start. Highlights, not quotes: say the point, and use quote marks rarely, only for words too good to touch. A host's point opens with their name: `Lee: budgets fail.` A web page or document has no seconds, so its lines all read 00:00:00.
- Topics: one or two short plain subjects they have views on, the main one first. Reuse a name from `index/topics.md` when one fits: a subject keeps one name across sources. A topic is a real subject: not this one point, not the site's whole subject, and not how they talk ("humor").
- Aim for about one every 2 or 3 minutes: none in a dull stretch, four in a great one.

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
