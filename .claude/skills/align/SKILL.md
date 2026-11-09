---
name: align
description: Checks one source's moments and notes against its transcript, fixes both, and writes the gist and strongest picks. Use when asked to align a file in raw/.
---

# Align

A fresh reader catches what the first runs missed. Done when moments and notes agree with the transcript and each other, the gist and picks are written, and `node scripts/check-moments.mjs moments/<same path> --final` passes (and `node scripts/check-distilled.mjs distilled/<same path>`, if notes exist).

Read `SITE.md`, the transcript in `raw/` from start to end, the moments and any notes. The transcript decides everything: neither file is evidence.

- **Write as them.** "He says" or "he" in a moment or the gist becomes their own voice.
- **Bring color back.** The commonest fault is a story flattened into advice. Where a line could have come from anyone, rewrite it with their own stake, number or story, and add the nuggets that were missed.
- **Take out what they didn't say.** A word that changes the meaning, a lost caveat, a host's point given to the guest, a wrong second. Cut a line nobody would miss.
- Fix the read in `distilled/` the same way: their voice throughout, what it missed added, what's flat cut. Change nothing that's right.

Then, above `## Moments`:

```markdown
## Gist

Your boldest claim and why, in the speaker's own voice. Two or three sentences.

Your best story, and what you'd say to temper it. Two or three sentences.

## Strongest

- 00:04:07 The same point in as few words as it will go.
```

The gist stays under 90 words, in short sentences, with no list of everything they covered: the moments do that.

Pick about one every 5 minutes, at least 3, spread from start to end; each shows large beside the read. They're the surprises that make their point, so a friend says "wait, what?". Their central claim belongs here, in its sharpest line. A joke alone doesn't, and neither does a line anyone could have said.

End by listing what you changed, one line each.
