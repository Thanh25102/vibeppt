---
name: vibe-deck
description: Use when the user wants to create, redesign, or iterate on a presentation deck through conversation - "make me a deck about X", "build slides for Y", "make this deck prettier", "turn these notes into a presentation". Interviews the user, authors a DeckSpec, builds a hybrid PPTX with VibePPT, then reviews its own contact sheet and PowerPoint render and fixes what it finds before showing the result.
---

# Vibe a deck

Turn a conversation into a `.pptx` the user can open in PowerPoint and still edit.

**The workflow itself lives in [`skill/beautiful-ppt/SKILL.md`](../../../skill/beautiful-ppt/SKILL.md)
and its `references/` folder — read those and follow them.** They are the single source of truth,
shared with the Codex skill, so this file stays a thin wrapper rather than a second copy that
drifts. In particular:

- [`references/intake.md`](../../../skill/beautiful-ppt/references/intake.md) — what to collect before authoring, and the rule against inventing what is missing.
- [`references/deckspec.md`](../../../skill/beautiful-ppt/references/deckspec.md) — the schema.
- [`references/visual-review.md`](../../../skill/beautiful-ppt/references/visual-review.md) — how to review your own output. This is a required stage.
- [`references/curation.md`](../../../skill/beautiful-ppt/references/curation.md) — only when turning a customer PPTX library into a Customer Kit.

Read `CLAUDE.md` in the repo root for the hard invariants before touching anything.

## What is different in Claude Code

**Interview briefly, then stop asking.** Four questions is the ceiling: audience and the decision
they make afterwards; duration; what material exists; dark or light. If the user says "just make
it", pick defaults, say what you picked in one line, and build. Do not interrogate someone who
wants to see something first.

**Review your own work before showing it.** After building, actually read
`output/<theme>/contact-sheet.png` and the PowerPoint renders with the Read tool, critique them
against `references/visual-review.md`, fix, and rebuild. Only surface the deck once you would be
happy to present it yourself. The two renderer bugs this project has shipped both passed lint and
`qa.json`; looking at the picture is what caught them.

**Deliver absolute paths** to the `.pptx`, `contact-sheet.png` and `preview/index.html`, and state
plainly anything you could not verify — a font you did not test, a number the user must confirm,
a placeholder that is still standing in for a real screenshot.
