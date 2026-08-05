# Intake contract

How good a deck can look is set before any slide is authored. A tour of real product screens
carrying sourced numbers looks good almost regardless of layout; the same layout filled with
placeholder copy looks like a template. Collect the material first.

Ask the customer for one folder:

```text
intake/
  brief.md        audience · the decision they make afterwards · duration · language
  screenshots/    real product screens, PNG at 1600px+ wide, or SVG
  facts.md        one line per number, each with its source
  brand/          logo-light.*, logo-dark.*, fonts, colours
```

Then inventory it:

```powershell
vibeppt intake .\intake
```

It exits non-zero while anything essential is missing, and warns about what will limit the
result: a brief that never names the audience or the decision, screenshots too small to survive
being placed on a 1920px slide, fact lines with no source, a single logo that cannot work on both
themes.

## Rules

- **Never invent what is missing.** No benchmark, customer outcome, security property, product
  spec or screenshot gets made up to fill a gap. Ask, or cut the slide.
- Every number that reaches a slide carries its source in `sourceRefs`. If it cannot be sourced,
  it is not evidence and does not belong on an evidence slide.
- Screenshots are the customer's own product, exported at 2x or as SVG. Do not decorate them and
  do not fake UI that does not exist.
- A missing intake is a finding to report, not a problem to paper over with generated filler.
