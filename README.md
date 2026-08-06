# VibePPT

VibePPT is a source-available, local-first template studio, Codex workflow, and Node CLI for building visual Microsoft PowerPoint decks without reducing the result to a wall of marketing text.

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

## Public showcase

The repository includes a static Vietnamese product site generated from the same nine template manifests used by Studio. It has shareable template pages, dark/light contact sheets, live HTML presentations, installation docs, and no upload or account surface.

```bash
npm run site:build
npm run site:serve
```

The production image is published as `ghcr.io/thanh25102/vibeppt-site`. To run it on a server before a domain is available:

```bash
docker compose -f compose.site.yml pull
docker compose -f compose.site.yml up -d
```

Open `http://SERVER_IP:8080`. Put an existing reverse proxy and TLS in front of container port `8080` when a domain is ready.

## Install

Three paths, one end state: a `vibeppt` command on PATH, the `beautiful-ppt` skill installed for both Codex and Claude Code, and a **VibePPT Studio** entry in the Windows Start Menu.

### From the Windows installer

The friendliest option, and the only one that needs no terminal and no Node.js: download `VibePPT-Setup-<version>.exe` from the [latest release](https://github.com/Thanh25102/vibeppt/releases/latest) and run it. Every release also carries the npm tarball for the paths below. It installs per-user to `%LOCALAPPDATA%\VibePPT`, so Windows never asks for administrator rights.

The installer carries its own Node runtime (about 26 MB compressed), puts `vibeppt` on the user PATH, installs the agent skills, and adds a **VibePPT** Start Menu group.

To remove it, either open **Settings → Apps → VibePPT → Uninstall**, or use **Start Menu → VibePPT → Uninstall VibePPT**. Uninstalling deletes the program folder, removes the PATH entry, and takes the `beautiful-ppt` skill back out of `~/.codex/skills` and `~/.claude/skills` — leaving it would tell the agent to run a `vibeppt` command that no longer exists. Nothing is destroyed: the skill folders are moved to `~/.vibeppt/skill-backups/`, so a customised copy survives. Presentation projects and Customer Kits are never touched.

Build it yourself from a checkout:

```powershell
winget install --id JRSoftware.InnoSetup     # once, for the compiler
powershell -ExecutionPolicy Bypass -File .\scripts\build-installer.ps1
```

The result lands in `dist-installer\`. It bundles whatever `node.exe` the build machine runs, which must be version 22 or newer.

**Sign the executable before shipping it to anyone.** Unsigned, it shows *"Windows protected your PC"* on first run and the user must click **More info → Run anyway**. That is the mild failure. The severe one was observed during development: Kaspersky Endpoint Security deleted the installer *while it was running*, leaving a half-copied folder, no Start Menu entry, no uninstall entry and no closing dialog — indistinguishable, from the user's side, from the installer doing nothing. Endpoint products score an unsigned binary that drops executables and edits `PATH`, and the behaviour is not deterministic: a later build of the same installer ran untouched on the same machine.

Until there is a certificate, expect to walk each user through an antivirus exclusion, and treat any report of "I ran it and nothing happened" as a possible quarantine rather than a user error. `%LOCALAPPDATA%\Programs\VibePPT` containing some but not all of `dist`, `templates`, `presets`, `studio`, `scripts` and `skill` is the signature.

### From a git checkout

For your own machine, or any machine that should track changes:

```powershell
git clone https://github.com/Thanh25102/vibeppt.git
cd vibeppt
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

It checks Node, builds, runs `npm link`, then calls `vibeppt setup`. `npm link` symlinks the global command back to this folder, so leave the checkout where it is. If linking fails with `EPERM`, either run PowerShell as Administrator or move npm to a user-writable prefix with `npm config set prefix "$env:APPDATA\npm"`.

### From a packed tarball

For handing the tool to someone else. Build the artifact once, on any platform:

```powershell
npm run pack        # -> vibeppt-cli-<version>.tgz, about 650 kB
```

Then on the target machine, which needs nothing but Node:

```powershell
npm install -g --ignore-scripts .\vibeppt-cli-0.4.0-alpha.1.tgz
vibeppt setup
```

No git, no TypeScript build, no dev dependencies. `--ignore-scripts` skips Playwright's browser download because the renderer drives the installed Edge or Chrome; on a machine with neither, run `npx playwright install chromium` afterwards.

### What `vibeppt setup` does

Copies `skill/beautiful-ppt` into `~/.codex/skills/` and `~/.claude/skills/`, reports whether desktop PowerPoint answered, and writes the Start Menu shortcut. It is safe to re-run: an existing skill is moved to `~/.vibeppt/skill-backups/` first, deliberately outside the skills folder, because a backup left beside a skill is itself a valid `SKILL.md` and the agent would load it as a second copy. Pass `--no-shortcut` to skip the Start Menu entry. Restart the agent afterwards.

The `.claude/skills/vibe-deck/` skill in this repository is a thin Claude Code wrapper whose links are relative to the checkout; it applies when you work inside the repository itself, and is not part of `setup`.

### Verify the machine

```powershell
vibeppt help
npm run test:visual   # from a checkout only
```

`test:visual` is the acceptance check that matters: it builds the golden decks through the real browser and requires desktop PowerPoint to fit every text box. Green means both halves of the toolchain work on that machine.

## Visual workflow

1. Open **VibePPT Studio** from the Start Menu.
2. Browse nine original Sales and Marketing templates plus any private Customer Kits, all with light/dark contact sheets.
3. Pick a folder, enter a short brief, and optionally attach source files and a logo.
4. Click **Open VS Code & copy prompt**.
5. Open Codex or Claude Code, press `Ctrl+V`, and send.

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
vibeppt qa .\output\final\customer-deck.pptx
```

The PPTX is named after `meta.title` in `deck.json`, which `init` seeds from the folder name — so rename the file in the last command once you give the deck a real title.

Available templates are `launch-signal`, `saas-clarity`, `executive-minimal`, `bold-campaign`, `editorial-brand-story`, `proof-case-study`, `momentum-growth`, `proposal-grid`, and `product-walkthrough`. Legacy presets remain supported. Use `--theme light` or `--theme dark`. For a long deck, use `--section <id>` to build one 8–15-slide chapter before the full export.

On Windows, `vibeppt qa` also renders through desktop PowerPoint and fails the build on text that overflows its box or an object off the slide. Pass `--structural-only` to skip that pass, or `--powerpoint` to force it.

## Customer material as input

Before authoring, inventory what the customer supplied. The result of a deck is largely set here, not in the layout:

```powershell
vibeppt intake .\intake
```

It expects `brief.md`, `screenshots/`, `facts.md`, and `brand/`, exits non-zero while anything essential is missing, and warns about what will cap the quality — a brief that never names the audience or the decision, screenshots too small for a 1920px slide, fact lines with no source.

## Existing PPTX as input

```powershell
vibeppt import-pptx .\sources\old-deck.pptx --out .\sources\old-deck --force
```

PowerPoint renders reference images and extracts text/notes. Codex uses those materials to rebuild a new story; VibePPT does not perform fragile in-place edits.

## Customer template workshop

When a customer supplies a PPTX library, keep the originals private and build a visual index first:

```powershell
vibeppt library index .\customer-pptx --out .\customer-workshop
vibeppt studio --workshop .\customer-workshop
```

The index reads every PPTX, records structure and fonts, samples slides through desktop PowerPoint when available, and generates browser-viewable contact sheets. Codex then shortlists a coherent visual grammar, selects twelve practical layout roles with two alternatives each, and rebuilds them with DeckSpec/CSS rather than copying customer assets. Structural-only indexing is available with `--structural-only`.

On Windows, render only the shortlisted decks and final candidates at higher fidelity:

```powershell
vibeppt library render .\customer-workshop --shortlist .\customer-workshop\deck-shortlist.json
vibeppt library render .\customer-workshop --selection .\customer-workshop\selection.json
```

The recommended first pilot uses twelve roles: cover, agenda, section, problem, metrics, process, timeline, comparison, matrix, chart, team, and closing. After the pilot, ask the customer for three completed decks they consider genuinely good; use those to refine the second version instead of guessing their taste from a large template dump.

PPTX remains the primary source. PDF exports are useful only as visual comparison evidence for representative decks.

## Private Customer Kits

A kit packages rebuilt templates, brand profiles, and optional demo outputs without the raw customer library:

```powershell
vibeppt kit build .\kit-workspace --out .\customer.vibeppt-kit
vibeppt kit install .\customer.vibeppt-kit
vibeppt kit list
```

Studio also installs `.vibeppt-kit` files visually. Archives are checksum-verified, path-safe, size-limited, and restricted to template/brand/demo assets. Installed kits live under `%USERPROFILE%\.vibeppt` and remain local to that Windows account.

## Brand profiles

Open **Thương hiệu** in Studio to adjust fonts, core colors, radius, light/dark logos, and advanced theme tokens against a live slide preview. Saved profiles are reusable across compatible templates. The CLI path remains available:

```powershell
vibeppt brand add acme --from .\acme-brand --project .
```

Each profile contains installed font family names, both light and dark color tokens, and optional theme-specific logos. Brand source stays visible and local.

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
npm run test:site
npm run sample
```

On Windows, `npm run test:visual` additionally builds the golden decks and requires desktop PowerPoint to fit every text box. Run it after any change to `src/pptx.ts`, `src/html.ts`, or a template stylesheet — it is the only check that sees what PowerPoint actually lays out.

## License

Copyright 2026 Bùi Mạnh Thành. VibePPT is source available under the [PolyForm Shield License 1.0.0](LICENSE.md). It is not OSI open source; review the license before redistributing VibePPT or using it to provide a competing product.

The v0.4 ceiling is intentional: public static showcase, private Customer Kits, customer-library Workshop, guided brand profiles, fixed renderer components, and PowerPoint desktop QA. Studio is a chooser and handoff surface, not a drag-and-drop editor. VibePPT does not include arbitrary HTML input, animation round-tripping, SmartArt preservation, collaboration, telemetry, accounts, file upload, or a hosted generation service.
