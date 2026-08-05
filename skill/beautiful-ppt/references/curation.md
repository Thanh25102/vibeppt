# Customer template curation

Use this workflow when a customer supplies many PPTX files and wants a reusable VibePPT Customer Kit. PPTX is the primary source. A PDF export is optional visual evidence for a few representative decks, not a replacement for the PPTX.

## 1. Protect the source

- Work in a private local folder and confirm the raw PPTX directory is ignored by Git.
- Never modify source PPTX files in place.
- Never package source PPTX files, extracted images, fonts, or copied slide assets into a template pack.
- Record customer/license restrictions in `NOTICE.md`.

## 2. Map the whole library

```powershell
vibeppt library index .\customer-pptx --out .\customer-workshop
vibeppt studio --workshop .\customer-workshop
```

On Windows, the index samples slides through desktop PowerPoint. Structural-only indexing is acceptable for an initial map:

```powershell
vibeppt library index .\customer-pptx --out .\customer-workshop --structural-only
```

Read `library.json`, `CURATION.md`, and the PNG contact sheets; open the generated HTML fallback if Chromium was unavailable. Report the deck count, slide count, read errors, theme pairs, chart density, and dominant categories. Do not ask the user to choose from hundreds of slides.

## 3. Shortlist visual systems

Choose 10–20 coherent decks and write `deck-shortlist.json`:

```json
{ "version": 1, "libraryId": "customer-library", "decks": ["deck-id"] }
```

Prefer a grammar that is readable, brandable, editable, and usable in both themes. Reject a deck that depends on copied illustration assets even if it looks impressive. On Windows, render the full shortlisted decks:

```powershell
vibeppt library render .\customer-workshop --shortlist .\customer-workshop\deck-shortlist.json
```

## 4. Select twelve reusable roles

Select one winner and exactly two alternatives for each role: cover, agenda, section, problem, metrics, process, timeline, comparison, matrix, chart, team, and closing. Write `selection.json` using the schema shown in `CURATION.md`, score every candidate from 0–100, and include a concrete rationale.

Use these weights:

- hierarchy 30%;
- flexibility 25%;
- brandability 20%;
- editability 15%;
- light/dark compatibility 10%.

Render the selected slides at high resolution before rebuilding:

```powershell
vibeppt library render .\customer-workshop --selection .\customer-workshop\selection.json
```

Continue with the best-supported selection without waiting for approval. The Workshop UI lets the operator swap in either stored alternative when desired.

## 5. Rebuild, do not trace

Recreate the visual grammar with DeckSpec, template CSS, brand tokens, and native PowerPoint objects. Declare every supported layout in `template.json` and set `layout` on sample slides. The result should preserve hierarchy and rhythm, not pixel-copy a source slide.

Create a factual 12-slide demo about the customer workflow or supplied business topic. Generate light and dark previews, then build and inspect the PPTX. Use desktop PowerPoint as the final acceptance gate for fonts, overflow, line breaks, native charts, tables, diagrams, and theme logos.

## 6. Package privately

The kit workspace contains only these allowlisted folders and files:

```text
kit.json
NOTICE.md
templates/<template-id>/
brands/<brand-id>/
demo/
```

Build the archive:

```powershell
vibeppt kit build .\kit-workspace --out .\customer.vibeppt-kit
```

Install it in Studio or with `vibeppt kit install .\customer.vibeppt-kit`. Verify that the template preview, light/dark brand, demo contact sheet, and a newly generated project all work before delivery.

Ask for three completed decks the customer considers genuinely good only after the pilot. Use them to refine the grammar and role priorities in a second kit version; do not block the first pilot on that request.
