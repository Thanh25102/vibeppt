#!/usr/bin/env node
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildDeck, preparePreview } from "./pptx.js";
import { formatIssues, hasErrors, loadProject, readJson, validateBrand, type LoadedTemplate } from "./model.js";
import { evaluatePowerPointGeometry, inspectPptx, writeQaReport, type PowerPointRenderReport } from "./qa.js";
import { startStudio } from "./studio.js";
import { createPresentationProject } from "./templates.js";
import { indexLibrary, renderLibrarySelection, renderLibraryShortlist } from "./library.js";
import { buildCustomerKit, installCustomerKit, listInstalledKits } from "./kits.js";
import type { BrandProfile, DeckSpec, ThemeName } from "./types.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

interface ParsedArgs {
  positionals: string[];
  flags: Map<string, string | boolean>;
}

function parseArgs(args: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string | boolean>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const [name, inline] = arg.slice(2).split("=", 2);
    if (!name) continue;
    if (inline !== undefined) {
      flags.set(name, inline);
      continue;
    }
    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      flags.set(name, next);
      index += 1;
    } else {
      flags.set(name, true);
    }
  }
  return { positionals, flags };
}

function flag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags.get(name);
  return typeof value === "string" ? value : undefined;
}

function required(value: string | undefined, message: string): string {
  if (!value) throw new Error(message);
  return value;
}

function themeFrom(args: ParsedArgs, fallback: ThemeName = "dark"): ThemeName {
  const value = flag(args, "theme") ?? fallback;
  if (value !== "dark" && value !== "light") throw new Error("--theme must be dark or light.");
  return value;
}

function modeFrom(args: ParsedArgs, fallback: "hybrid" | "pixel" = "hybrid"): "hybrid" | "pixel" {
  const value = flag(args, "mode") ?? fallback;
  if (value !== "hybrid" && value !== "pixel") throw new Error("--mode must be hybrid or pixel.");
  return value;
}

async function exists(filePath: string): Promise<boolean> {
  return Boolean(await stat(filePath).catch(() => null));
}

function assertSafeReplaceTarget(target: string): void {
  const resolved = path.resolve(target);
  if ([path.parse(resolved).root, path.resolve(process.cwd()), path.resolve(homedir()), path.resolve(tmpdir())].includes(resolved)) {
    throw new Error(`Refusing to replace a broad directory: ${resolved}`);
  }
}

async function prepareOutput(target: string, force: boolean): Promise<string> {
  const resolved = path.resolve(target);
  if (await exists(resolved)) {
    const entries = await readdir(resolved);
    if (entries.length && !force) throw new Error(`Output directory is not empty: ${resolved}\nPass --force to replace that exact directory.`);
    if (entries.length) {
      assertSafeReplaceTarget(resolved);
      await rm(resolved, { recursive: true, force: true });
    }
  }
  await mkdir(resolved, { recursive: true });
  return resolved;
}

function selectSections(deck: DeckSpec, raw: string | undefined): DeckSpec {
  if (!raw) return deck;
  const requested = new Set(raw.split(",").map((value) => value.trim()).filter(Boolean));
  const sections = deck.sections.filter((section) => requested.has(section.id));
  const missing = [...requested].filter((id) => !sections.some((section) => section.id === id));
  if (missing.length) throw new Error(`Unknown section id: ${missing.join(", ")}`);
  return { ...deck, sections };
}

async function sourceBundle(deck: DeckSpec, brand: BrandProfile, outDir: string, assetMap: Map<string, string>, template?: LoadedTemplate): Promise<void> {
  const sourceDir = path.join(outDir, "source");
  const sourceAssetDir = path.join(sourceDir, "assets");
  await mkdir(sourceAssetDir, { recursive: true });
  const bundledDeck = structuredClone(deck);
  for (const section of bundledDeck.sections) {
    for (const slide of section.slides) {
      if (slide.visual?.src) {
        const mapped = assetMap.get(slide.visual.src);
        if (mapped) slide.visual.src = `./${mapped}`;
      }
    }
  }
  const bundledBrand = structuredClone(brand);
  if (bundledBrand.logo) {
    const mapped = assetMap.get(`brand:${bundledBrand.logo}`) ?? assetMap.get(bundledBrand.logo);
    if (mapped) bundledBrand.logo = `./${mapped}`;
  }
  if (bundledBrand.logos) {
    for (const theme of ["light", "dark"] as const) {
      const reference = bundledBrand.logos[theme];
      if (!reference) continue;
      const mapped = assetMap.get(`brand:${reference}`) ?? assetMap.get(reference);
      if (mapped) bundledBrand.logos[theme] = `./${mapped}`;
    }
  }
  const previewAssets = path.join(outDir, "preview", "assets");
  if (await exists(previewAssets)) await cp(previewAssets, sourceAssetDir, { recursive: true });
  if (template) {
    await cp(path.dirname(template.profilePath), path.join(sourceDir, "template"), { recursive: true });
    bundledDeck.templateProfile = "./template/template.json";
  } else {
    delete bundledDeck.templateProfile;
  }
  await writeFile(path.join(sourceDir, "deck.json"), JSON.stringify({ ...bundledDeck, brandProfile: "./brand.json" }, null, 2), "utf8");
  await writeFile(path.join(sourceDir, "brand.json"), JSON.stringify(bundledBrand, null, 2), "utf8");
}

function printIssues(issues: Awaited<ReturnType<typeof loadProject>>["issues"]): void {
  console.log(formatIssues(issues));
}

async function loadValidProject(deckPath: string, args: ParsedArgs) {
  const project = await loadProject(deckPath, flag(args, "brand"));
  printIssues(project.issues);
  if (hasErrors(project.issues)) throw new Error("Deck validation failed.");
  return project;
}

async function commandLint(args: ParsedArgs): Promise<void> {
  const deckPath = required(args.positionals[1], "Usage: vibeppt lint <deck.json>");
  const project = await loadProject(deckPath, flag(args, "brand"));
  printIssues(project.issues);
  if (hasErrors(project.issues)) process.exitCode = 1;
}

async function commandPreview(args: ParsedArgs): Promise<void> {
  const deckPath = required(args.positionals[1], "Usage: vibeppt preview <deck.json> [--out output/preview] [--force]");
  const project = await loadValidProject(deckPath, args);
  const deck = selectSections(project.deck, flag(args, "section") ?? flag(args, "chapter"));
  const theme = themeFrom(args, deck.theme ?? "dark");
  const outDir = await prepareOutput(flag(args, "out") ?? "output/preview", args.flags.has("force"));
  const preview = await preparePreview(deck, project.brand, project.deckDir, project.brandPath, outDir, theme, project.template);
  await sourceBundle(deck, project.brand, outDir, preview.assetMap, project.template);
  console.log(`Preview: ${pathToFileURL(preview.htmlPath).href}`);
}

async function commandBuild(args: ParsedArgs): Promise<void> {
  const deckPath = required(args.positionals[1], "Usage: vibeppt build <deck.json> [--out output/build] [--force]");
  const project = await loadValidProject(deckPath, args);
  const deck = selectSections(project.deck, flag(args, "section") ?? flag(args, "chapter"));
  const theme = themeFrom(args, deck.theme ?? "dark");
  const mode = modeFrom(args, deck.outputMode ?? "hybrid");
  const scale = Number(flag(args, "scale") ?? 2);
  if (!Number.isFinite(scale) || scale < 1 || scale > 3) throw new Error("--scale must be a number from 1 to 3.");
  const outDir = await prepareOutput(flag(args, "out") ?? "output/build", args.flags.has("force"));
  const result = await buildDeck(deck, project.brand, project.deckDir, project.brandPath, {
    outDir, theme, outputMode: mode, scale,
    ...(project.template ? { template: project.template } : {}),
  });
  await sourceBundle(deck, project.brand, outDir, result.assetMap, project.template);
  const renderReport = await readJson<Record<string, unknown>>(result.reportPath);
  const structure = await inspectPptx(result.pptxPath);
  await writeFile(result.reportPath, JSON.stringify({ ...renderReport, structure }, null, 2), "utf8");
  console.log(`PPTX: ${result.pptxPath}`);
  console.log(`Preview: ${result.htmlPath}`);
  console.log(`Contact sheet: ${result.contactSheetPath}`);
  console.log(`QA: ${result.reportPath}`);
}

async function commandInit(args: ParsedArgs): Promise<void> {
  const target = path.resolve(required(args.positionals[1], "Usage: vibeppt init <directory> [--template launch-signal]"));
  const templateId = flag(args, "template");
  if (templateId) {
    const title = flag(args, "title") ?? path.basename(target);
    const created = await createPresentationProject({
      targetDirectory: target,
      templateId,
      theme: themeFrom(args),
      brief: {
        projectName: path.basename(target),
        title,
        goal: flag(args, "goal") ?? "Create a clear, persuasive presentation.",
        audience: flag(args, "audience") ?? "Business stakeholders",
        durationMinutes: Number(flag(args, "duration") ?? 25),
        language: flag(args, "language") === "en" ? "en" : "vi",
      },
    });
    console.log(`Created: ${created.projectPath}`);
    return;
  }
  const preset = flag(args, "preset") ?? "cinematic";
  const presetPath = path.join(packageRoot, "presets", preset, "brand.json");
  if (!(await exists(presetPath))) throw new Error(`Unknown preset: ${preset}`);
  await prepareOutput(target, args.flags.has("force"));
  await Promise.all([
    mkdir(path.join(target, "brands", "default"), { recursive: true }),
    mkdir(path.join(target, "assets"), { recursive: true }),
    mkdir(path.join(target, "sources"), { recursive: true }),
  ]);
  await cp(presetPath, path.join(target, "brands", "default", "brand.json"));
  const sample = await readJson<DeckSpec>(path.join(packageRoot, "examples", "northstar", "deck.json"));
  await writeFile(path.join(target, "deck.json"), JSON.stringify({ ...sample, brandProfile: "./brands/default/brand.json" }, null, 2), "utf8");
  await writeFile(path.join(target, ".gitignore"), "output/\n", "utf8");
  await writeFile(path.join(target, "README.md"), "# Presentation project\n\nEdit `deck.json`, add source files under `sources/`, then run `vibeppt preview deck.json --out output/preview --force`.\n", "utf8");
  console.log(`Created: ${target}`);
}

async function commandBrand(args: ParsedArgs): Promise<void> {
  if (args.positionals[1] !== "add") throw new Error("Usage: vibeppt brand add <id> --from <directory> [--project .]");
  const id = required(args.positionals[2], "Brand id is required.");
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(id)) throw new Error("Brand id may contain letters, numbers and hyphens only.");
  const source = path.resolve(required(flag(args, "from"), "--from <directory> is required."));
  const profilePath = path.join(source, "brand.json");
  const profile = await readJson<BrandProfile>(profilePath);
  const issues = validateBrand(profile);
  if (hasErrors(issues)) throw new Error(formatIssues(issues));
  const target = path.resolve(flag(args, "project") ?? ".", "brands", id);
  if (await exists(target)) {
    if (!args.flags.has("force")) throw new Error(`Brand already exists: ${target}\nPass --force to replace it.`);
    assertSafeReplaceTarget(target);
    await rm(target, { recursive: true, force: true });
  }
  await cp(source, target, { recursive: true });
  console.log(`Brand installed: ${target}`);
}

async function runPowerShell(scriptName: string, scriptArgs: string[]): Promise<void> {
  if (process.platform !== "win32") throw new Error(`${scriptName} requires Windows with desktop Microsoft PowerPoint installed.`);
  const executable = "powershell.exe";
  const child = spawn(executable, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(packageRoot, "scripts", scriptName), ...scriptArgs], { stdio: "inherit" });
  const code = await new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (value) => resolve(value ?? 1));
  });
  if (code !== 0) throw new Error(`${scriptName} failed with exit code ${code}.`);
}

async function commandImport(args: ParsedArgs): Promise<void> {
  const input = path.resolve(required(args.positionals[1], "Usage: vibeppt import-pptx <reference.pptx> --out sources/reference"));
  const outDir = path.resolve(required(flag(args, "out"), "--out <directory> is required."));
  if (process.platform !== "win32") throw new Error("PPTX import requires Windows with desktop Microsoft PowerPoint installed.");
  if (!(await exists(input))) throw new Error(`Reference PPTX not found: ${input}`);
  await prepareOutput(outDir, args.flags.has("force"));
  await runPowerShell("powerpoint-import.ps1", ["-InputPptx", input, "-OutputDir", outDir]);
  console.log(`Reference extracted: ${outDir}`);
}

async function commandQa(args: ParsedArgs): Promise<void> {
  const input = path.resolve(required(args.positionals[1], "Usage: vibeppt qa <deck.pptx> [--out qa.json] [--powerpoint]"));
  const outputPath = path.resolve(flag(args, "out") ?? path.join(path.dirname(input), "qa-structure.json"));
  const report = await inspectPptx(input);
  await mkdir(path.dirname(outputPath), { recursive: true });
  if ((process.platform === "win32" && !args.flags.has("structural-only")) || args.flags.has("powerpoint")) {
    const renderDir = path.join(path.dirname(outputPath), "powerpoint-render");
    await prepareOutput(renderDir, true);
    await runPowerShell("powerpoint-export.ps1", ["-InputPptx", input, "-OutputDir", renderDir]);
    // A quality gate that silently no-ops is worse than no gate, so surface the failure.
    const render = await readJson<PowerPointRenderReport>(path.join(renderDir, "powerpoint-render.json"))
      .catch((error: Error) => error);
    if (render instanceof Error) {
      report.issues.push({ level: "warning", message: `Could not read the PowerPoint geometry report, so the text-fit checks were skipped: ${render.message}` });
    } else if (!render.shapes?.length) {
      report.issues.push({ level: "warning", message: "The PowerPoint geometry report contains no shapes, so the text-fit checks were skipped." });
    } else {
      report.issues.push(...evaluatePowerPointGeometry(render));
    }
    report.ok = !report.issues.some((issue) => issue.level === "error");
    console.log(`PowerPoint render: ${renderDir}`);
  }
  await writeQaReport(report, outputPath);
  console.log(`${report.ok ? "PASS" : "FAIL"}: ${report.slideCount} slides, ${report.editableObjectCount} editable objects`);
  for (const issue of report.issues) console.log(`  ${issue.level === "error" ? "ERROR" : "WARN "} ${issue.message}`);
  console.log(`Report: ${outputPath}`);
  if (!report.ok) process.exitCode = 1;
}

async function commandLibrary(args: ParsedArgs): Promise<void> {
  const action = args.positionals[1];
  if (action === "index") {
    const sourceRoot = path.resolve(required(args.positionals[2], "Usage: vibeppt library index <pptx-folder> --out <workspace>"));
    const outDir = path.resolve(required(flag(args, "out"), "--out <workspace> is required."));
    const id = flag(args, "id");
    const name = flag(args, "name");
    const catalog = await indexLibrary({
      sourceRoot,
      outDir,
      ...(id ? { id } : {}),
      ...(name ? { name } : {}),
      force: args.flags.has("force"),
      structuralOnly: args.flags.has("structural-only"),
    });
    console.log(`Library: ${catalog.decks.filter((deck) => deck.status === "ready").length}/${catalog.decks.length} decks ready`);
    console.log(`Workspace: ${outDir}`);
    return;
  }
  if (action === "render") {
    const workspace = path.resolve(required(args.positionals[2], "Usage: vibeppt library render <workspace> --shortlist <json> | --selection <json>"));
    const shortlist = flag(args, "shortlist");
    const selection = flag(args, "selection");
    if (Boolean(shortlist) === Boolean(selection)) throw new Error("Pass exactly one of --shortlist <json> or --selection <json>.");
    const options = { workspace, force: args.flags.has("force") };
    if (shortlist) await renderLibraryShortlist(path.resolve(shortlist), options);
    else await renderLibrarySelection(path.resolve(selection!), options);
    console.log(`Library render complete: ${workspace}`);
    return;
  }
  throw new Error("Usage: vibeppt library index <pptx-folder> --out <workspace> | vibeppt library render <workspace> --shortlist <json> | --selection <json>");
}

async function commandKit(args: ParsedArgs): Promise<void> {
  const action = args.positionals[1];
  if (action === "build") {
    const workspace = path.resolve(required(args.positionals[2], "Usage: vibeppt kit build <workspace> --out <customer.vibeppt-kit>"));
    const output = path.resolve(required(flag(args, "out"), "--out <customer.vibeppt-kit> is required."));
    const manifest = await buildCustomerKit(workspace, output, args.flags.has("force"));
    console.log(`Customer Kit: ${manifest.name} (${manifest.id})`);
    console.log(`File: ${output}`);
    return;
  }
  if (action === "install") {
    const input = path.resolve(required(args.positionals[2], "Usage: vibeppt kit install <customer.vibeppt-kit>"));
    const manifest = await installCustomerKit(input, { force: args.flags.has("force") });
    console.log(`Installed Customer Kit: ${manifest.name} (${manifest.id})`);
    return;
  }
  if (action === "list") {
    const kits = await listInstalledKits();
    if (!kits.length) console.log("No Customer Kits installed.");
    else kits.forEach((kit) => console.log(`${kit.id}\t${kit.name}\t${kit.customer}`));
    return;
  }
  throw new Error("Usage: vibeppt kit build <workspace> --out <file> | vibeppt kit install <file> | vibeppt kit list");
}

async function commandStudio(args: ParsedArgs): Promise<void> {
  await startStudio({ openBrowser: !args.flags.has("no-open"), ...(flag(args, "workshop") ? { workshop: path.resolve(flag(args, "workshop")!) } : {}) });
}

function help(): void {
  console.log(`VibePPT — local-first, hybrid PowerPoint generation

Commands:
  vibeppt studio
  vibeppt init <dir> [--template id] [--preset cinematic|editorial|corporate]
  vibeppt brand add <id> --from <dir> [--project .]
  vibeppt import-pptx <file.pptx> --out <dir>
  vibeppt library index <pptx-folder> --out <workspace>
  vibeppt library render <workspace> --shortlist <json> | --selection <json>
  vibeppt kit build <workspace> --out <customer.vibeppt-kit>
  vibeppt kit install <customer.vibeppt-kit>
  vibeppt kit list
  vibeppt lint <deck.json>
  vibeppt preview <deck.json> [--theme dark|light] [--section id] [--out dir]
  vibeppt build <deck.json> [--mode hybrid|pixel] [--scale 1..3] [--out dir]
  vibeppt qa <deck.pptx> [--powerpoint] [--out report.json]

Use --force only when you want to replace the exact output directory.`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  switch (args.positionals[0]) {
    case "studio": await commandStudio(args); break;
    case "init": await commandInit(args); break;
    case "brand": await commandBrand(args); break;
    case "import-pptx": await commandImport(args); break;
    case "library": await commandLibrary(args); break;
    case "kit": await commandKit(args); break;
    case "lint": await commandLint(args); break;
    case "preview": await commandPreview(args); break;
    case "build": await commandBuild(args); break;
    case "qa": await commandQa(args); break;
    case "help":
    case undefined: help(); break;
    default: throw new Error(`Unknown command: ${args.positionals[0]}\nRun vibeppt help.`);
  }
}

main().catch((error) => {
  console.error(`ERROR: ${(error as Error).message}`);
  process.exitCode = 1;
});
