---
name: vibe-deck
description: Use when the user wants to create, redesign, or iterate on a presentation deck through conversation - "make me a deck about X", "build slides for Y", "make this deck prettier", "turn these notes into a presentation". Interviews the user, authors a DeckSpec, builds a hybrid PPTX with VibePPT, then reviews its own contact sheet and fixes what it finds before showing the result.
---

# Vibe a deck

Turn a conversation into a `.pptx` the user can open in PowerPoint and still edit. You author
`deck.json`; the VibePPT renderer owns layout. Never write raw HTML slides and never hand-edit
the generated PPTX.

Read `CLAUDE.md` in the repo root for the hard invariants before doing anything else.

## 1. Interview — short, then stop asking

Ask only what you cannot infer. Four questions is the ceiling:

- **Audience and decision.** Who is in the room and what do they decide afterwards?
- **Duration.** Drives slide count: roughly one slide per 90 seconds.
- **Material.** Files, screenshots, numbers, brand colours, an existing deck?
- **Theme.** Dark or light. Default dark for product, light for executive.

If the user says "just make it", pick sensible defaults, say what you picked in one line, and
build. Do not interrogate someone who wants to see something first.

## 2. Gather before authoring

- Read every supplied file. Do not ask the user to restate what is already in them.
- On Windows with an existing PPTX: `vibeppt import-pptx <file> --out sources/ref --force`,
  then read `reference.json` and the rendered slide images.
- For public facts, look them up and keep the URL in `sourceRefs`. **Never invent a benchmark,
  a customer outcome, a security property, or a product spec.** If a number cannot be sourced,
  cut the claim rather than soften it.

## 3. Pick a template

`vibeppt studio` lists them, or read `templates/*/template.json`. Match on `categories` and
`moods`. `product-walkthrough` is the screenshot-led one: two-tone titles, numbered callouts on
a product visual, a section clock. Read the pack's `recipe.md` before authoring against it.

Scaffold the real project so the pack and brand come along:

```powershell
vibeppt init .\deck-folder --template product-walkthrough --theme dark
```

## 4. Author deck.json

Read `skill/beautiful-ppt/references/deckspec.md` for the full schema. The parts that carry the
look:

- **One idea per slide.** The title states the idea as a sentence; the body supports it.
- **`titleAccent`** — the operative phrase of the title, rendered in the accent colour. Must be a
  real substring of `title`. One per slide.
- **`visual.callouts`** — numbered chips at `x`/`y` percentages over a screenshot. Three or four.
  Place them over quiet regions, never over what they point at.
- **`timeBudget`** on a section — presenter pacing, e.g. `"12-20 · 08'"`.
- **`tone`** on items — use the accent for the recommended or active option, not decoratively.
- **`notes`** — what the presenter says. **`sourceRefs`** — where each number came from.

Structure the deck as sections of 8-15 slides so each can be reviewed on its own.

## 5. Build, then critique your own output

```powershell
vibeppt lint .\deck.json
vibeppt build .\deck.json --theme dark --out .\output\dark --force
```

**Now read `output/dark/contact-sheet.png` yourself.** This step is the whole point — the linter
passes on decks that look wrong. Check every slide against this list:

- A title that wrapped into an ugly orphan line, or overflowed its box.
- A visual that letterboxed, leaving callouts floating on empty background.
- Callouts covering the thing they annotate, or colliding with each other.
- Cards with wildly uneven text lengths in the same row.
- Two consecutive slides with the same shape — vary the composition.
- Decorative pseudo-elements left over from a frame you disabled in template CSS.
- Placeholder numbers that survived into a slide claiming evidence.

Fix what you find in `deck.json` or the template CSS, rebuild, and look again. Two or three
rounds is normal. Only show the user once you would be happy to present it yourself.

## 6. Verify in PowerPoint

Windows is the acceptance gate, not the browser:

```powershell
vibeppt qa .\output\dark\<deck>.pptx --powerpoint
```

Then read `output/dark/powerpoint-render/slide-*.png` — these are what PowerPoint actually draws,
and they catch what the HTML preview cannot: font substitution, rewrapped titles, overflow,
misplaced objects. Fix at DeckSpec/CSS/source level and rebuild. Never nudge the PPTX by hand.

## 7. Deliver

Give absolute paths to the `.pptx`, `contact-sheet.png`, and `preview/index.html`, plus both
themes if the user wanted both. State plainly anything you could not verify — a font you did not
test, a number the user must confirm, a screenshot that is a placeholder.

## Recovery

- Missing browser: install Microsoft Edge, or `npx playwright install chromium`.
- Missing font: switch the brand to an installed Windows font before final QA.
- Title overflows only in PowerPoint: the measurement or point-size conversion drifted — check
  `PT_PER_PX` in `src/pptx.ts`, do not paper over it in the DeckSpec.
