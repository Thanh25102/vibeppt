# PowerPoint acceptance gate

The final target is desktop Microsoft PowerPoint on Windows. HTML preview approval alone is not final approval.

## Required checks

1. `vibeppt lint deck.json` has no errors.
2. The complete contact sheet has a clear narrative rhythm, no accidental repetition, and no obviously dense slide.
3. `vibeppt qa deck.pptx` reports the expected slide count, no OOXML errors, and editable objects in hybrid mode.
4. On Windows, QA exports every slide through installed PowerPoint to `powerpoint-render/` at 1920×1080.
5. Inspect the PowerPoint render for clipped text, substituted fonts, changed line breaks, distorted screenshots, chart labels, connector placement, and table overflow.
6. Open the PPTX and edit one title, one chart value, one table cell, and one diagram label. Save, close, and reopen it.
7. Confirm speaker notes and section order.

If a native chart, table, or diagram cannot preserve the intended design after one focused correction, set only that slide block to `renderMode: "flatten"`. Keep the rest of the deck hybrid.

## Existing presentations

`vibeppt import-pptx` exports reference PNGs and extracts text/notes through PowerPoint. It does not preserve master slides, animations, SmartArt semantics, or editable source objects. This is intentional: the new presentation is rebuilt from the supplied content and visual direction.
