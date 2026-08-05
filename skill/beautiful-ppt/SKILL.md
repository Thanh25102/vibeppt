---
name: beautiful-ppt
description: Create polished, presentation-ready Microsoft PowerPoint decks from a chat brief and arbitrary local source files. Use for new business or product decks, rebuilding an existing PPTX from scratch, applying a reusable brand profile, producing a visual HTML preview, or exporting a hybrid PPTX with editable text, charts, tables, and diagrams.
---

# Beautiful PPT

Turn source material into a coherent visual story, then use the local `vibeppt` CLI to produce and verify the deliverables. Treat an existing PPTX as content and visual reference only; never patch it in place.

## Workflow

1. Inspect every supplied source before proposing the story. Recover the audience, decision, duration, facts, required claims, screenshots, and brand material. Do not make the user restate information already present in files.
2. If the source includes a PPTX on Windows, run `vibeppt import-pptx source.pptx --out sources/reference --force`, then inspect `reference.json` and the rendered slide images.
   If the request is to turn a customer PPTX library into a reusable private template system, stop this deck workflow and follow [references/curation.md](references/curation.md) end to end. Make the shortlist and layout decisions yourself unless the user explicitly asks to approve them.
3. Choose one narrative spine. Split large decks into sections of 8–15 slides so each section can be reviewed independently. Keep factual claims traceable in `sourceRefs` or speaker notes.
4. If Studio created the project, read `brief.md`, `template/template.json`, and `template/recipe.md` before authoring. Preserve the selected `templateProfile` and theme unless the brief clearly requires a different direction. If no presentation project exists, run `vibeppt init <deck-folder> --template launch-signal`. Read [references/deckspec.md](references/deckspec.md) before authoring `deck.json`.
5. Use original generated images only when a bitmap visual materially improves the story. Save them under `assets/`, ask for no embedded text, and create theme-specific variants when light and dark treatments differ. Use native slide objects for data, processes, topology, comparisons, and tables.
6. Author or revise `deck.json`; do not create arbitrary HTML. Let the renderer own layout and presentation controls.
7. Validate and preview the current section:

   ```powershell
   vibeppt lint deck.json
   vibeppt preview deck.json --section product --theme dark --out output/product-preview --force
   ```

8. Build each section, inspect its contact sheet at full size, and fix hierarchy, density, wording, overflow, weak repetition, and unsupported claims before continuing:

   ```powershell
   vibeppt build deck.json --section product --mode hybrid --out output/product --force
   ```

9. Build the complete deck only after the sections hold together. Run `vibeppt qa output/final/deck.pptx`; on Windows this also renders through desktop PowerPoint. Read [references/powerpoint-qa.md](references/powerpoint-qa.md) for the acceptance gate.
10. Deliver the PPTX, `preview/index.html`, `contact-sheet.png`, `qa.json`, and the `source/` bundle. Report any font, PowerPoint, external-source, or visual assumption that was not actually verified.

## Visual standard

- Lead with an operational or decision story, not a feature catalogue.
- Prefer one dominant visual idea per slide and strong contrast in scale.
- Replace marketing filler with diagrams, product evidence, timelines, comparison structures, or concrete use cases.
- Keep titles short enough to scan. Move explanation into notes instead of shrinking everything.
- Reuse a small visual grammar, but vary composition enough that consecutive slides do not feel templated.
- Treat the selected template as a visual grammar and story recommendation, not a requirement to retain sample wording or every recipe step.
- Do not invent benchmarks, customer outcomes, security properties, product screens, or architecture claims.

## Native versus flattened

Default to hybrid output. Text remains editable. Charts, tables, and diagrams remain native unless they are too dense or visually specialized; set `renderMode` to `flatten` only for that block. Use `--mode pixel` only when exact visual fidelity is more important than editability.

## Recovery

- Missing browser: install Microsoft Edge or run `npx playwright install chromium` from the VibePPT package.
- Missing font: switch the brand profile to an installed Windows font before final QA.
- PowerPoint render mismatch: keep the HTML preview as the design reference, adjust the DeckSpec or native block, rebuild, and rerun QA. Do not manually nudge the generated PPTX because the source would drift.
