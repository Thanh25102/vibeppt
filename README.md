# VibePPT

VibePPT is a local-first template studio, Codex workflow, and Node CLI for building visual Microsoft PowerPoint decks without reducing the result to a wall of marketing text.

The editable source is `deck.json`. The same source produces:

- a presentation-mode HTML preview;
- a hybrid `.pptx` with a high-fidelity visual layer plus editable text, charts, tables, and diagrams;
- slide PNGs and a contact sheet for visual review;
- structural and desktop-PowerPoint QA artifacts;
- a portable source bundle.

## Requirements

- Windows 10/11 for final delivery;
- Node.js 22 or newer;
- desktop Microsoft PowerPoint;
- Microsoft Edge or Google Chrome.

The renderer can be developed on Linux or macOS, but final QA is explicitly Windows PowerPoint.

## Install for a Codex user

Clone the private repository, then open PowerShell in it:

```powershell
git clone https://github.com/Thanh25102/vibeppt.git
cd vibeppt
```

Run the installer:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

The installer builds and links `vibeppt`, verifies PowerPoint, installs the `beautiful-ppt` Codex skill, and adds **VibePPT Studio** to the Windows Start Menu. Restart Codex after installation.

## Visual workflow

1. Open **VibePPT Studio** from the Start Menu.
2. Browse eight original Sales and Marketing templates with light/dark contact sheets.
3. Pick a folder, enter a short brief, and optionally attach source files and a logo.
4. Click **Open VS Code & copy prompt**.
5. Open Codex, press `Ctrl+V`, and send.

Studio binds only to `127.0.0.1`, does not call a cloud service, and never asks for an API key. It creates a portable presentation project and hands the actual authoring/build work to the installed skill.

Then the customer can ask:

> Use $beautiful-ppt to create a 25-minute product presentation from the files in this folder. Use our brand, keep technical claims evidence-based, and give me both dark and light previews.

Codex reads the brief and attachments, authors the DeckSpec, uses its own image-generation capability when an original bitmap is useful, and drives the CLI. VibePPT itself has no API keys, cloud service, MCP server, or license server.

## Quick start

```powershell
vibeppt init .\customer-deck --template launch-signal
cd .\customer-deck
vibeppt lint .\deck.json
vibeppt preview .\deck.json --out .\output\preview --force
vibeppt build .\deck.json --mode hybrid --out .\output\final --force
vibeppt qa .\output\final\northstar-operations.pptx
```

Available templates are `launch-signal`, `saas-clarity`, `executive-minimal`, `bold-campaign`, `editorial-brand-story`, `proof-case-study`, `momentum-growth`, and `proposal-grid`. Legacy presets remain supported. Use `--theme light` or `--theme dark`. For a long deck, use `--section <id>` to build one 8–15-slide chapter before the full export.

## Existing PPTX as input

```powershell
vibeppt import-pptx .\sources\old-deck.pptx --out .\sources\old-deck --force
```

PowerPoint renders reference images and extracts text/notes. Codex uses those materials to rebuild a new story; VibePPT does not perform fragile in-place edits.

## Brand profiles

Copy a preset folder, adjust `brand.json`, add a local logo if needed, then install it into a presentation project:

```powershell
vibeppt brand add acme --from .\acme-brand --project .
```

Each profile contains installed font family names and both light and dark color tokens. Brand source stays visible and local.

## Output layout

```text
output/final/
├── deck-name.pptx
├── preview/index.html
├── slides/slide-001.png
├── backgrounds/slide-001.png
├── contact-sheet.png
├── qa.json
└── source/
    ├── deck.json
    ├── brand.json
    └── template/
```

`--mode hybrid` is the default. Set `renderMode: "flatten"` on one dense chart/table/diagram when native PowerPoint objects cannot hold the intended visual. Use `--mode pixel` only when editability is not required.

## Development

```bash
npm install --ignore-scripts
npm test
npm run previews
npm run sample
```

The v0.2 ceiling is intentional: curated templates, guided local project creation, fixed renderer components, and PowerPoint desktop QA. Studio is a chooser and handoff surface, not a drag-and-drop editor. It does not include arbitrary HTML input, animation round-tripping, SmartArt preservation, collaboration, telemetry, or a hosted service.
