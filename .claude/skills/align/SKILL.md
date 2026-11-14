---
name: align
description: Checks one source's moments and notes against its transcript, fixes both, and writes the gist and strongest picks. Use when asked to align a file in raw/.
---

# Align

A fresh reader catches what the first runs missed. Done when moments and notes agree with the transcript and each other, the gist and picks are written, and `node scripts/check-moments.mjs moments/<same path> --final` passes (and `node scripts/check-distilled.mjs distilled/<same path>`, if notes exist).

Read `SITE.md`, the transcript in `raw/` from start to end, the moments and any notes. Judge everything by the transcript: the moments and notes are not evidence.

- **Write as them.** "He says" or "he" in a moment or the gist becomes their own voice.
- **Bring color back.** The commonest fault is a story flattened into advice. Where a line could have come from anyone, rewrite it with their own stake, number or story, and add the nuggets that were missed.
- **Take out what they didn't say.** A word that changes the meaning, a lost caveat, a host's point given to the guest, a wrong second. Cut a line nobody would miss.
- Fix the read in `distilled/` the same way: their voice throughout, add what it missed, cut what's flat. Change nothing that's right.

Then, above `## Moments`:

```markdown
## Gist

Your boldest claim and why, in the speaker's own voice. Two or three sentences.

Your best story, and what you'd say to temper it. Two or three sentences.

## Strongest

- 00:04:07 The same point in as few words as it will go.
```

Keep the gist under 90 words, in short sentences. Don't list everything they covered; the moments already list it.

Pick about one every 5 minutes, at least 3, spread from start to end; the site shows each one large beside the read. Pick the surprises that make their point: lines that make a friend say "wait, what?". Include their central claim, in its sharpest line. Leave out a joke on its own and a line anyone could have said.

End by listing what you changed, one line each.
