import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { createContactSheets, type ContactSheetItem } from "./contact-sheet.js";
import { readJson, slugify } from "./model.js";
import { SLIDE_KINDS, type CurationCandidate, type CurationSelection, type LibraryCatalog, type LibraryDeck, type LibraryDeckStats, type LibraryShortlist, type ThemeName } from "./types.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export interface IndexLibraryOptions {
  sourceRoot: string;
  outDir: string;
  id?: string;
  name?: string;
  force?: boolean;
  structuralOnly?: boolean;
  createSheets?: boolean;
}

export interface RenderLibraryOptions {
  workspace: string;
  force?: boolean;
  createSheets?: boolean;
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function decodeXml(value: string): string {
  return value.replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&#39;", "'");
}

function numericSort(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true });
}

async function pptxFiles(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await pptxFiles(target));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".pptx")) result.push(target);
  }
  return result.sort(numericSort);
}

function inferTheme(relative: string): ThemeName | undefined {
  if (/(?:^|[\\/_-])dark(?:[\\/_-]|$)/i.test(relative)) return "dark";
  if (/(?:^|[\\/_-])light(?:[\\/_-]|$)/i.test(relative)) return "light";
  return undefined;
}

function inferCategory(filename: string): string {
  return path.basename(filename, path.extname(filename))
    .replace(/_(?:dark|light)_v.*$/i, "")
    .replace(/[_-]+/g, " ")
    .trim() || "Uncategorized";
}

function sampledSlides(slideCount: number, count = 9): number[] {
  if (slideCount <= 0) return [];
  const wanted = Math.min(count, slideCount);
  return [...new Set(Array.from({ length: wanted }, (_, index) => Math.round((index * (slideCount - 1)) / Math.max(1, wanted - 1)) + 1))];
}

async function inspectDeck(source: string, sourceRoot: string): Promise<{ deck: Omit<LibraryDeck, "sampleImages" | "status">; zip: JSZip }> {
  const content = await readFile(source);
  const sourceHash = sha256(content);
  const zip = await JSZip.loadAsync(content);
  const names = Object.keys(zip.files);
  const slideNames = names.filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort(numericSort);
  const slides = await Promise.all(slideNames.map((name) => zip.file(name)!.async("text")));
  const presentation = await zip.file("ppt/presentation.xml")?.async("text") ?? "";
  const size = presentation.match(/<p:sldSz[^>]*cx="(\d+)"[^>]*cy="(\d+)"/);
  const themeNames = names.filter((name) => /^ppt\/theme\/theme\d+\.xml$/.test(name));
  const themes = await Promise.all(themeNames.map((name) => zip.file(name)!.async("text")));
  const fonts = [...new Set(themes.flatMap((theme) => [...theme.matchAll(/typeface="([^"]*)"/g)].map((match) => decodeXml(match[1] ?? "")).filter(Boolean)))].sort();
  const relative = path.relative(sourceRoot, source);
  const stableId = `${slugify(path.basename(source, path.extname(source)))}-${sha256(relative).slice(0, 8)}`;
  const stats: LibraryDeckStats = {
    charts: names.filter((name) => /^ppt\/charts\/chart\d+\.xml$/.test(name)).length,
    pictures: slides.reduce((sum, xml) => sum + [...xml.matchAll(/<p:pic(?:\s|>)/g)].length, 0),
    shapes: slides.reduce((sum, xml) => sum + [...xml.matchAll(/<p:sp(?:\s|>)/g)].length, 0),
    notes: names.filter((name) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name)).length,
    animatedSlides: slides.filter((xml) => xml.includes("<p:timing")).length,
    fonts,
  };
  const themeHint = inferTheme(relative);
  return {
    zip,
    deck: {
      id: stableId,
      name: path.basename(source, path.extname(source)),
      source: path.resolve(source),
      sourceHash,
      category: inferCategory(source),
      ...(themeHint ? { themeHint } : {}),
      slideCount: slideNames.length,
      width: Number(size?.[1] ?? 0),
      height: Number(size?.[2] ?? 0),
      sampleSlides: sampledSlides(slideNames.length),
      stats,
    },
  };
}

async function runPowerPointImport(input: string, output: string, options: { slides?: number[]; format: "PNG" | "JPG"; width: number; height: number }): Promise<void> {
  if (process.platform !== "win32") throw new Error("PowerPoint rendering requires Windows with desktop Microsoft PowerPoint installed.");
  const args = [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(packageRoot, "scripts", "powerpoint-import.ps1"),
    "-InputPptx", input, "-OutputDir", output, "-Format", options.format, "-Width", String(options.width), "-Height", String(options.height),
  ];
  if (options.slides?.length) args.push("-SlideIndices", options.slides.join(","));
  const child = spawn("powershell.exe", args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const stderr: Buffer[] = [];
  child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
  const code = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (value) => resolve(value ?? 1));
  });
  if (code !== 0) throw new Error(Buffer.concat(stderr).toString("utf8").trim() || `PowerPoint import failed with exit code ${code}.`);
}

async function embeddedThumbnail(zip: JSZip): Promise<{ content: Buffer; extension: string } | null> {
  for (const candidate of ["docProps/thumbnail.jpeg", "docProps/thumbnail.jpg", "docProps/thumbnail.png"]) {
    const file = zip.file(candidate);
    if (file) return { content: await file.async("nodebuffer"), extension: path.extname(candidate).toLowerCase() };
  }
  return null;
}

function assertSafeWorkspace(sourceRoot: string, outDir: string): void {
  const source = path.resolve(sourceRoot);
  const output = path.resolve(outDir);
  if ([path.parse(output).root, path.resolve(homedir()), source].includes(output)) throw new Error(`Refusing to use a broad or source directory as the library workspace: ${output}`);
}

async function allExist(root: string, paths: string[]): Promise<boolean> {
  return (await Promise.all(paths.map((item) => stat(path.resolve(root, item)).catch(() => null)))).every((item) => item?.isFile());
}

function curationGuide(catalog: LibraryCatalog): string {
  return `# VibePPT curation workspace

Use \`$beautiful-ppt\` to curate **${catalog.name}** into one coherent 12-layout customer pack.

1. Read \`library.json\` and inspect \`contact-sheets/decks-*.png\` (or the HTML fallback when Chromium is unavailable).
2. Choose one coherent, brandable visual grammar before choosing individual layouts.
3. Write \`deck-shortlist.json\` with 10–20 deck ids, then run \`vibeppt library render . --shortlist deck-shortlist.json\`.
4. Inspect the rendered deck contact sheets and create \`selection.json\` with one winner and two alternatives for each layout.
5. Score hierarchy 30%, flexibility 25%, brandability 20%, editability 15%, light/dark compatibility 10%.
6. Rebuild the selected grammar with DeckSpec, safe CSS and native objects. Do not copy source PPTX assets into the pack.
7. Make the curation decisions yourself and continue through the pilot; retain two alternatives so the operator can override without restarting.

Required roles: cover, agenda, section, problem, metrics, process, timeline, comparison, matrix, chart, team, closing.

Selection shape:

\`\`\`json
{
  "version": 1,
  "libraryId": "${catalog.id}",
  "updatedAt": "ISO-8601",
  "pack": { "id": "customer-core", "name": "Customer Core", "summary": "Reusable customer grammar" },
  "visualDirection": "One concrete visual direction",
  "layouts": [{
    "id": "cover", "name": "Cover", "kind": "hero", "purpose": "Open the story",
    "selected": { "deckId": "deck-id", "slideIndex": 1, "image": "decks/deck-id/slides/slide-001.jpg", "score": { "hierarchy": 90, "flexibility": 85, "brandability": 85, "editability": 80, "themeCompatibility": 80, "total": 85 }, "rationale": "Concrete reason" },
    "alternatives": [
      { "deckId": "alternative-a", "slideIndex": 2, "image": "decks/alternative-a/slides/slide-002.jpg", "score": { "hierarchy": 84, "flexibility": 88, "brandability": 82, "editability": 82, "themeCompatibility": 80, "total": 84 }, "rationale": "Concrete reason" },
      { "deckId": "alternative-b", "slideIndex": 3, "image": "decks/alternative-b/slides/slide-003.jpg", "score": { "hierarchy": 82, "flexibility": 86, "brandability": 84, "editability": 80, "themeCompatibility": 82, "total": 83 }, "rationale": "Concrete reason" }
    ]
  }]
}
\`\`\`
`;
}

export async function indexLibrary(options: IndexLibraryOptions): Promise<LibraryCatalog> {
  const sourceRoot = path.resolve(options.sourceRoot);
  const outDir = path.resolve(options.outDir);
  assertSafeWorkspace(sourceRoot, outDir);
  if (!(await stat(sourceRoot).catch(() => null))?.isDirectory()) throw new Error(`PPTX library not found: ${sourceRoot}`);
  if (options.force && await stat(outDir).catch(() => null)) await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  const existing = await readJson<LibraryCatalog>(path.join(outDir, "library.json")).catch(() => null);
  const existingBySource = new Map(existing?.decks.map((deck) => [path.resolve(deck.source), deck]) ?? []);
  const files = await pptxFiles(sourceRoot);
  if (!files.length) throw new Error(`No PPTX files found under: ${sourceRoot}`);
  const decks: LibraryDeck[] = [];
  const sheetItems: ContactSheetItem[] = [];

  for (const source of files) {
    try {
      const inspected = await inspectDeck(source, sourceRoot);
      const previous = existingBySource.get(path.resolve(source));
      if (!options.force && previous?.sourceHash === inspected.deck.sourceHash && previous.sampleImages.length && await allExist(outDir, previous.sampleImages)) {
        decks.push(previous);
        previous.sampleImages.forEach((image, index) => sheetItems.push({ image: path.join(outDir, image), label: previous.name, caption: previous.sampleSlides[index] ? `Slide ${previous.sampleSlides[index]}` : previous.category }));
        continue;
      }
      const samplesDir = path.join(outDir, "decks", inspected.deck.id, "samples");
      await rm(samplesDir, { recursive: true, force: true });
      await mkdir(samplesDir, { recursive: true });
      const sampleImages: string[] = [];
      if (options.structuralOnly || process.platform !== "win32") {
        const thumbnail = await embeddedThumbnail(inspected.zip);
        if (thumbnail) {
          const filename = `deck-thumbnail${thumbnail.extension}`;
          await writeFile(path.join(samplesDir, filename), thumbnail.content);
          sampleImages.push(path.relative(outDir, path.join(samplesDir, filename)).split(path.sep).join("/"));
        }
      } else {
        await runPowerPointImport(source, samplesDir, { slides: inspected.deck.sampleSlides, format: "JPG", width: 640, height: 360 });
        sampleImages.push(...inspected.deck.sampleSlides.map((index) => path.relative(outDir, path.join(samplesDir, `slide-${String(index).padStart(3, "0")}.jpg`)).split(path.sep).join("/")));
      }
      const deck: LibraryDeck = { ...inspected.deck, ...(options.structuralOnly || process.platform !== "win32" ? { sampleSlides: [] } : {}), sampleImages, status: "ready" };
      decks.push(deck);
      sampleImages.forEach((image, index) => sheetItems.push({ image: path.join(outDir, image), label: deck.name, caption: deck.sampleSlides[index] ? `Slide ${deck.sampleSlides[index]}` : deck.category }));
    } catch (error) {
      const relative = path.relative(sourceRoot, source);
      const themeHint = inferTheme(relative);
      decks.push({
        id: `${slugify(path.basename(source, path.extname(source)))}-${sha256(relative).slice(0, 8)}`,
        name: path.basename(source, path.extname(source)), source: path.resolve(source), sourceHash: "", category: inferCategory(source),
        ...(themeHint ? { themeHint } : {}), slideCount: 0, width: 0, height: 0, sampleSlides: [], sampleImages: [],
        stats: { charts: 0, pictures: 0, shapes: 0, notes: 0, animatedSlides: 0, fonts: [] }, status: "error", error: (error as Error).message,
      });
    }
  }
  const now = new Date().toISOString();
  const catalog: LibraryCatalog = {
    version: 1,
    id: options.id ? slugify(options.id) : slugify(path.basename(sourceRoot)),
    name: options.name?.trim() || path.basename(sourceRoot),
    sourceRoot,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    decks,
  };
  await writeFile(path.join(outDir, "library.json"), JSON.stringify(catalog, null, 2), "utf8");
  await writeFile(path.join(outDir, "CURATION.md"), curationGuide(catalog), "utf8");
  if (options.createSheets !== false && sheetItems.length) await createContactSheets(sheetItems, path.join(outDir, "contact-sheets"), "decks");
  return catalog;
}

export function validateLibraryShortlist(value: LibraryShortlist, catalog: LibraryCatalog): void {
  if (value.version !== 1 || value.libraryId !== catalog.id || !Array.isArray(value.decks) || !value.decks.length) throw new Error("Invalid deck shortlist.");
  const known = new Set(catalog.decks.filter((deck) => deck.status === "ready").map((deck) => deck.id));
  for (const id of value.decks) if (!known.has(id)) throw new Error(`Shortlist references an unknown deck: ${id}`);
}

function validateCandidate(candidate: CurationCandidate, catalog: LibraryCatalog): void {
  const deck = catalog.decks.find((item) => item.id === candidate.deckId);
  if (!deck || candidate.slideIndex < 1 || candidate.slideIndex > deck.slideCount) throw new Error(`Selection references an invalid slide: ${candidate.deckId}#${candidate.slideIndex}`);
  if (!candidate.rationale?.trim()) throw new Error("Every selected candidate needs a rationale.");
  for (const key of ["hierarchy", "flexibility", "brandability", "editability", "themeCompatibility", "total"] as const) {
    const value = candidate.score?.[key];
    if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error(`Invalid curation score ${key}.`);
  }
}

export function validateCurationSelection(selection: CurationSelection, catalog: LibraryCatalog): void {
  if (selection.version !== 1 || selection.libraryId !== catalog.id || !selection.layouts?.length) throw new Error("Invalid curation selection.");
  const ids = new Set<string>();
  for (const layout of selection.layouts) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(layout.id) || ids.has(layout.id)) throw new Error(`Invalid or duplicate layout id: ${layout.id}`);
    ids.add(layout.id);
    if (!SLIDE_KINDS.includes(layout.kind)) throw new Error(`Unsupported layout kind: ${layout.kind}`);
    validateCandidate(layout.selected, catalog);
    if (layout.alternatives.length !== 2) throw new Error(`Layout ${layout.id} must provide exactly two alternatives.`);
    layout.alternatives.forEach((candidate) => validateCandidate(candidate, catalog));
  }
}

export async function renderLibraryShortlist(shortlistPath: string, options: RenderLibraryOptions): Promise<void> {
  const workspace = path.resolve(options.workspace);
  const catalog = await readJson<LibraryCatalog>(path.join(workspace, "library.json"));
  const shortlist = await readJson<LibraryShortlist>(path.resolve(shortlistPath));
  validateLibraryShortlist(shortlist, catalog);
  if (process.platform !== "win32") throw new Error("Library slide rendering requires Windows with desktop PowerPoint.");
  const summaries: Array<{ deckId: string; slides: string[]; contactSheets: string[] }> = [];
  for (const id of shortlist.decks) {
    const deck = catalog.decks.find((item) => item.id === id)!;
    const output = path.join(workspace, "decks", deck.id, "slides");
    if (options.force) await rm(output, { recursive: true, force: true });
    if (!(await stat(path.join(output, "reference.json")).catch(() => null))?.isFile()) {
      await mkdir(output, { recursive: true });
      await runPowerPointImport(deck.source, output, { format: "JPG", width: 640, height: 360 });
    }
    const slides = (await readdir(output)).filter((name) => /^slide-\d+\.jpg$/i.test(name)).sort(numericSort).map((name) => path.join(output, name));
    const contactSheets = options.createSheets === false ? [] : (await createContactSheets(slides.map((image, index) => ({ image, label: `${deck.name} · ${String(index + 1).padStart(3, "0")}` })), path.join(workspace, "contact-sheets"), deck.id)).files;
    summaries.push({ deckId: id, slides: slides.map((item) => path.relative(workspace, item).split(path.sep).join("/")), contactSheets: contactSheets.map((item) => path.relative(workspace, item).split(path.sep).join("/")) });
  }
  await writeFile(path.join(workspace, "rendered.json"), JSON.stringify({ version: 1, libraryId: catalog.id, renderedAt: new Date().toISOString(), decks: summaries }, null, 2), "utf8");
}

export async function renderLibrarySelection(selectionPath: string, options: RenderLibraryOptions): Promise<void> {
  const workspace = path.resolve(options.workspace);
  const catalog = await readJson<LibraryCatalog>(path.join(workspace, "library.json"));
  const selection = await readJson<CurationSelection>(path.resolve(selectionPath));
  validateCurationSelection(selection, catalog);
  if (process.platform !== "win32") throw new Error("Selected-slide rendering requires Windows with desktop PowerPoint.");
  const candidates = selection.layouts.flatMap((layout) => [layout.selected, ...layout.alternatives].map((candidate) => ({ layout: layout.id, candidate })));
  const byDeck = new Map<string, Set<number>>();
  candidates.forEach(({ candidate }) => {
    const indices = byDeck.get(candidate.deckId) ?? new Set<number>();
    indices.add(candidate.slideIndex);
    byDeck.set(candidate.deckId, indices);
  });
  const sheetItems: ContactSheetItem[] = [];
  for (const [deckId, indices] of byDeck) {
    const deck = catalog.decks.find((item) => item.id === deckId)!;
    const output = path.join(workspace, "selected", deckId);
    if (options.force) await rm(output, { recursive: true, force: true });
    await mkdir(output, { recursive: true });
    await runPowerPointImport(deck.source, output, { slides: [...indices].sort((a, b) => a - b), format: "PNG", width: 1920, height: 1080 });
    for (const index of indices) {
      const roles = candidates.filter((item) => item.candidate.deckId === deckId && item.candidate.slideIndex === index).map((item) => item.layout).join(", ");
      sheetItems.push({ image: path.join(output, `slide-${String(index).padStart(3, "0")}.png`), label: roles, caption: `${deck.name} · ${index}` });
    }
  }
  if (options.createSheets !== false) await createContactSheets(sheetItems, path.join(workspace, "selected"), "selected");
}
