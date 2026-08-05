# Product Walkthrough

Use this pack when the audience needs to *see* the product work, not hear a capability list.

## Story spine

1. **Cover** — one line on what changes for the user.
2. **Question** — open each chapter as the question it answers, not a noun ("Where does the work happen?" beats "Overview").
3. **Walkthrough** — the anchor slide. A real screen with 3–4 numbered callouts.
4. **Steps** — the operating flow, one node per handoff.
5. **Options** — the variants a buyer chooses between.
6. **Evidence** — sourced numbers, never placeholders.
7. **Compare / Spec** — the trade-off and the hard facts.
8. **Close** — one concrete next action.

## What carries the look

- **Two-tone titles.** Set `titleAccent` to the operative phrase, and keep it a real substring of `title`. One accent per slide; accenting everything accents nothing.
- **Callouts on the visual.** Put `callouts` on `visual` with `x`/`y` as percentages of the visual box. Three or four is the working range; six is the hard limit. Place them over quiet regions of the screenshot, never over the part they point at.
- **Section clock.** Set `timeBudget` on the section (e.g. `"12-20 · 08'"`) so the presenter can keep pace.

## Rules

- Screenshots must be the customer's own product, exported at 2x or as SVG. Do not decorate them and do not fake UI that does not exist.
- Callout titles are 2–4 words. The verb belongs in the title, the detail in `body`.
- Keep the accent colour for meaning: the accented phrase, the active step, the recommended option.
- Evidence numbers need `sourceRefs`. If a number cannot be sourced, cut the slide.
