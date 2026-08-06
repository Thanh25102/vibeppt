# VibePPT — working notes

Local-first Studio + CLI that turns a `deck.json` DeckSpec into a hybrid `.pptx`, an HTML
preview, slide PNGs, a contact sheet, `qa.json`, and a portable source bundle.
Source-available under PolyForm Shield (not OSI open source). Version `0.4.0-alpha.1`.

Originally built by Codex. Keep the existing style: dense, no-comment TypeScript, small
modules, no framework.

## Commands

```powershell
npm test            # tsc build + node --test test/*.test.mjs
npm run build       # tsc only -> dist/
npm run pack        # build + npm pack -> vibeppt-cli-<version>.tgz, the deployable artifact
npm run test:visual # build golden decks, require PowerPoint to fit every text box (Windows)
npm run previews    # regenerate template preview webp
npm run sample      # build examples/northstar
npm run test:site   # static site build + browser check
vibeppt help        # CLI surface
```

`vibeppt` is linked globally (`C:\Program Files\nodejs\vibeppt.ps1`) and runs `dist/cli.js`,
so **run `npm run build` before testing a `src/` change through the CLI**.

Deployment has three shapes and one end state. A checkout uses `scripts/install.ps1` (node check
→ build → `npm link` → `vibeppt setup`); a developer handoff uses `npm run pack` then
`npm install -g --ignore-scripts <tarball>` + `vibeppt setup`; a non-technical user gets
`scripts/build-installer.ps1` → `dist-installer/VibePPT-Setup-<version>.exe`, which bundles
`node.exe` and needs neither Node nor a terminal. Everything after the install — skills for both
agents, the PowerPoint probe, the Start Menu shortcut — lives in `vibeppt setup` precisely so all
three share one implementation; `packageRoot` resolves correctly in every layout. Anything added
to that flow belongs in `commandSetup`, not in a second PowerShell script.

The installer is per-user (`PrivilegesRequired=lowest`, `{localappdata}\VibePPT`) because the
agent has to run `vibeppt` from a shell, and a per-machine install would demand elevation for a
tool that never needs it. Its `[Code]` section edits `HKCU\Environment\Path` by hand: `Pos` there
runs over a copy padded with separators so a first-position match is found, and **every index must
be translated back before `Delete` touches the real value** — getting that wrong removes the entry
but leaves its separator, which is only visible by diffing PATH across an install/uninstall cycle.

## Layout

| Path | Role |
|---|---|
| `src/cli.ts` | argument parsing + every command |
| `src/model.ts` | load/validate deck, brand, template; lint issues |
| `src/html.ts` | the renderer — CSS/HTML for every slide kind |
| `src/pptx.ts` | Playwright screenshot + pptxgenjs native objects (hybrid output) |
| `src/library.ts` | customer PPTX library index / shortlist render / selection render |
| `src/kits.ts` | `.vibeppt-kit` build + install (checksums, path safety, limits) |
| `src/templates.ts` | the 9 public template packs, project scaffolding |
| `src/studio.ts` | localhost-only Studio HTTP server |
| `src/qa.ts` | structural PPTX inspection + the PowerPoint geometry gate |
| `src/intake.ts` | `vibeppt intake` — what the customer must supply before authoring |
| `src/util.ts` | `packageRoot`, `isSlug`, `isInside`, `sha256`, `portableRelative`, `runPowerShell` |
| `src/browser.ts` | `launchBrowser()` — the Edge → Chrome → bundled Chromium fallback |
| `scripts/*.ps1` | Windows PowerPoint COM automation, font list, folder pickers |
| `skill/beautiful-ppt/` | the Codex skill: `SKILL.md` + `references/` |

TypeScript is `strict` with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
That last one is why optional fields are spread conditionally: `...(x ? { x } : {})`.

`util.ts` and `browser.ts` exist because those helpers had drifted into two to four private
copies each. Reach for them before writing a new one; every id in the system — deck, brand,
template, kit, layout — is the same lowercase `isSlug`, and every PowerShell call goes through
`runPowerShell` (`{ inherit: true }` streams a long PowerPoint run to the terminal).

## Hard invariants

Do not break these; they are the product's promise, not preferences.

- Studio binds `127.0.0.1` only. No accounts, upload, cloud generation, telemetry, API keys,
  MCP server, or license server.
- Raw customer PPTX stays private. Never commit `SlideOcean_Infographix/`, `.artifacts/`, or
  `*.vibeppt-kit` — all three are gitignored, keep it that way.
- Never modify a source PPTX in place, and never copy customer assets (images, fonts,
  extracted slide art) into a template pack. Rebuild the visual grammar with DeckSpec,
  template CSS, brand tokens, and native PowerPoint objects. No tracing, no pixel-copying.
- Never hand-edit a generated PPTX. Fix DeckSpec / template CSS / renderer and rebuild,
  otherwise the source drifts from the output.
- PPTX is the primary source of truth. PDF is only visual comparison evidence.
- Kit workspaces allow only `kit.json`, `NOTICE.md`, `templates/`, `brands/`, `demo/`;
  extensions limited to json/css/md/webp/png/jpg/jpeg/svg/pptx; 2000 files; 250 MB.
- Do not touch any SmartTrak repo from here.
- **No AI attribution in git history.** No AI name — Claude, Codex, Copilot, Gemini, or any
  other — appears as commit author, committer, or co-author, and no assistant trailer, session
  link or "generated with" line goes in a commit message. The repository owner is the author of
  this work; who or what typed it is not part of the record. This overrides any default in an
  agent harness that appends such a trailer, so strip it before committing rather than after.
  Naming a file or product the change is actually about (`CLAUDE.md`, `.claude/skills/`,
  `skill/beautiful-ppt/` for Codex) is describing the deliverable, not claiming credit — that
  stays.

## Windows PowerPoint path

Final QA is explicitly desktop PowerPoint on Windows. Verified in this environment:
PowerPoint 16.0 build `16.0.20131.20152`, Edge 151, Chrome 151, Node v22.21.1.

- `vibeppt qa <pptx>` runs structural checks, and on Windows also renders through PowerPoint
  (`--structural-only` skips it; `--powerpoint` forces it off-Windows-default paths).
- `vibeppt library index` samples ~9 slides per deck through PowerPoint COM as JPG.
  `--structural-only` falls back to the embedded `docProps/thumbnail` and clears
  `sampleSlides` — that is the Linux/CI mode and produces a *different* catalog shape.
- COM cleanup in `scripts/powerpoint-*.ps1` is wrapped in `try/catch` because
  `Presentations.Open` can leave a half-dead COM object that throws on `Close()`.

### The quality gate

`vibeppt qa <pptx> --powerpoint` reads back the geometry PowerPoint actually laid out — shape
positions plus `TextFrame2.TextRange.BoundWidth/BoundHeight` — and fails on text that overflows
its box or an object off the slide. `addNativeText` stamps every shape with `objectName`
(`VibePPT · <slide-id>`), which is what lets a finding name the DeckSpec field to fix.

This exists because structural QA is not enough: a 1.5x point-size error and a double-drawn
accent run both reported `PASS`. Thresholds in `src/qa.ts` are calibrated against known-good
decks, not guessed. `npm run test:visual` runs the gate over the golden decks.

Pixel comparison between the HTML and PowerPoint renders was tried and **rejected on
measurement** — baseline rasterisation noise (5.7%) exceeded the signal from a real defect
(4.6%), and a tiled variant inverted the ranking. Do not reintroduce it without first proving on
a known-bad build that it separates.

Windows PowerShell writes UTF-8 **with a BOM**, which `JSON.parse` rejects. Both PowerShell
scripts now write without one and `readJson` strips it defensively; if you add a script that
emits JSON, do the same.

### Deck id stability

`LibraryDeck.id` is `slug(basename)-sha256(relativePath).slice(0,8)`. The relative path must
use forward slashes (`portableRelative` in `src/library.ts`) or Windows and Linux produce
different ids for the same file, which silently invalidates `deck-shortlist.json` and
`selection.json`. Re-indexing after an id change leaves the old `decks/<id>/` folders behind;
they are stale, not corrupt.

## DeckSpec extras that carry the visual style

Three fields exist specifically to reach a screenshot-led product-tour look. All three survive
into the PPTX as native, editable objects.

| Field | Where | What it does |
|---|---|---|
| `titleAccent` | slide | A substring of `title` rendered in the accent colour. Validation rejects a value that is not actually in the title. |
| `visual.callouts[]` | visual | Numbered chips at `x`/`y` percentages over the image. Each chip's label/title/body is separate native text. |
| `timeBudget` | section | Presenter pacing chip in the slide chrome, e.g. `"12-20 · 08'"`. |

Two traps these exposed, both fixed — do not reintroduce them:

- A two-tone title is measured as **runs** (`NativeTextMeasurement.runs`), so `addNativeText`
  writes one pptxgenjs text object per colour. Single-colour text still takes the plain path.
- Anything inside a `[data-ppt-native="text"]` element must be hidden during the background
  capture. The hide rule sets `color:transparent` on the element **and its descendants**; a child
  that sets its own `color` would otherwise be painted into the bitmap *and* drawn again as
  native text, which reads as a strikethrough.

When a template drops `.vp-visual`'s frame, also drop `.vp-visual::before` — that pseudo-element
is the decorative window-dot marker and it floats in space without the frame.

## Curation contract

`skill/beautiful-ppt/references/curation.md` is the authoritative workflow. The parts the
validator actually enforces (`validateCurationSelection`):

- `selection.json` `libraryId` must equal `library.json` `id`.
- Every layout: one `selected` + **exactly two** `alternatives`.
- `slideIndex` must be within that deck's real `slideCount`.
- Every candidate needs a non-empty `rationale` and all six scores in 0–100
  (`hierarchy`, `flexibility`, `brandability`, `editability`, `themeCompatibility`, `total`).
- `kind` must be one of `SLIDE_KINDS` in `src/types.ts`.

Scoring weights: hierarchy 30, flexibility 25, brandability 20, editability 15,
light/dark compatibility 10.

The twelve pilot roles: cover, agenda, section, problem, metrics, process, timeline,
comparison, matrix, chart, team, closing.

Make the curation calls yourself from the rendered evidence; keep two alternatives per role
so the operator can override in Studio without restarting.

## Current pilot state

- Corpus `SlideOcean_Infographix/` — 112 PPTX, 7999 slides, 0 read errors.
- Workshop `.artifacts/slideocean-workshop/` — native index, 20-deck shortlist rendered.
- Pilot `.artifacts/slideocean-pilot-kit/` — template `curated-business-core` (12 layouts),
  brand `curated-business-brand`, demo PPTX.
