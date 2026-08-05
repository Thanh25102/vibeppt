# VibePPT

VibePPT is a local-first Codex workflow and Node CLI for building visual Microsoft PowerPoint decks without reducing the result to a wall of marketing text.

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

The installer builds and links `vibeppt`, verifies PowerPoint, and installs the `beautiful-ppt` Codex skill under the current Windows user. Restart Codex after installation.

Then the customer can ask:

> Use $beautiful-ppt to create a 25-minute product presentation from the files in this folder. Use our brand, keep technical claims evidence-based, and give me both dark and light previews.

Codex reads the brief and attachments, authors the DeckSpec, uses its own image-generation capability when an original bitmap is useful, and drives the CLI. VibePPT itself has no API keys, cloud service, MCP server, or license server.

## Quick start

```powershell
vibeppt init .\customer-deck --preset cinematic
cd .\customer-deck
vibeppt lint .\deck.json
vibeppt preview .\deck.json --out .\output\preview --force
vibeppt build .\deck.json --mode hybrid --out .\output\final --force
vibeppt qa .\output\final\northstar-operations.pptx
```

Available presets are `cinematic`, `editorial`, and `corporate`. Use `--theme light` or `--theme dark`. For a long deck, use `--section <id>` to build one 8–15-slide chapter before the full export.

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
    └── brand.json
```

`--mode hybrid` is the default. Set `renderMode: "flatten"` on one dense chart/table/diagram when native PowerPoint objects cannot hold the intended visual. Use `--mode pixel` only when editability is not required.

## Development

```bash
npm install --ignore-scripts
npm test
npm run sample
```

The v1 ceiling is intentional: fixed renderer components, new-deck generation, and PowerPoint desktop QA. It does not include a browser editor, arbitrary HTML input, animation round-tripping, SmartArt preservation, collaboration, or a hosted service.
