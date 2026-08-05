import { cp, copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatIssues, hasErrors, readJson, validateBrand, validateTemplate } from "./model.js";
import { defaultUserDataRoot, installedBrandDirectories, installedTemplateDirectories } from "./kits.js";
import type { BrandProfile, DeckSpec, TemplateProfile, ThemeName } from "./types.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export interface ProjectBrief {
  projectName: string;
  title: string;
  goal: string;
  audience: string;
  durationMinutes: number;
  language: "vi" | "en";
}

export interface CreateProjectOptions {
  targetDirectory: string;
  templateId: string;
  theme: ThemeName;
  brief: ProjectBrief;
  logoPath?: string;
  sourcePaths?: string[];
  rootDirectory?: string;
  dataRoot?: string;
  brandId?: string;
}

export interface TemplateCatalogEntry {
  profile: TemplateProfile;
  directory: string;
  origin: "built-in" | "customer-kit";
  kitId?: string;
  kitName?: string;
}

export interface BrandCatalogEntry {
  profile: BrandProfile;
  directory: string;
  origin: "local" | "customer-kit";
  kitId?: string;
  kitName?: string;
}

export interface CreatedProject {
  projectPath: string;
  deckPath: string;
  prompt: string;
  template: TemplateProfile;
}

async function exists(filePath: string): Promise<boolean> {
  return Boolean(await stat(filePath).catch(() => null));
}

function assertTemplateId(id: string): void {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error(`Invalid template id: ${id}`);
}

function validateBrief(brief: ProjectBrief): void {
  for (const field of ["projectName", "title", "goal", "audience"] as const) {
    if (!brief[field]?.trim()) throw new Error(`${field} is required.`);
  }
  if (!Number.isInteger(brief.durationMinutes) || brief.durationMinutes < 5 || brief.durationMinutes > 120) {
    throw new Error("durationMinutes must be an integer from 5 to 120.");
  }
  if (brief.language !== "vi" && brief.language !== "en") throw new Error("Language must be vi or en.");
}

async function loadTemplateDirectory(id: string, directory: string): Promise<{ profile: TemplateProfile; directory: string }> {
  assertTemplateId(id);
  const profile = await readJson<TemplateProfile>(path.join(directory, "template.json"));
  const issues = validateTemplate(profile);
  if (profile.id !== id) issues.push({ level: "error", path: "template.id", message: `Expected template id ${id}.` });
  if (hasErrors(issues)) throw new Error(formatIssues(issues));
  for (const reference of [profile.stylesheet, profile.brandProfile, profile.sampleDeck, profile.recipe, profile.preview.dark, profile.preview.light]) {
    const resolved = path.resolve(directory, reference);
    const relative = path.relative(directory, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative) || !(await stat(resolved).catch(() => null))?.isFile()) {
      throw new Error(`Template asset not found or outside its pack: ${reference}`);
    }
  }
  return { profile, directory };
}

async function loadTemplate(id: string, rootDirectory = packageRoot, dataRoot = defaultUserDataRoot()): Promise<{ profile: TemplateProfile; directory: string }> {
  const builtIn = path.join(rootDirectory, "templates", id);
  if ((await stat(builtIn).catch(() => null))?.isDirectory()) return loadTemplateDirectory(id, builtIn);
  const matches = (await installedTemplateDirectories(dataRoot)).filter((item) => path.basename(item.directory) === id);
  if (matches.length !== 1) throw new Error(matches.length ? `Template id is ambiguous: ${id}` : `Unknown template: ${id}`);
  return loadTemplateDirectory(id, matches[0]!.directory);
}

export async function listTemplates(rootDirectory = packageRoot): Promise<TemplateProfile[]> {
  const templatesRoot = path.join(rootDirectory, "templates");
  const entries = await readdir(templatesRoot, { withFileTypes: true });
  const profiles = await Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) => loadTemplateDirectory(entry.name, path.join(templatesRoot, entry.name)).then((item) => item.profile)));
  return profiles.sort((left, right) => left.name.localeCompare(right.name));
}

export async function listAvailableTemplates(rootDirectory = packageRoot, dataRoot = defaultUserDataRoot()): Promise<TemplateCatalogEntry[]> {
  const builtInRoot = path.join(rootDirectory, "templates");
  const builtIn = await readdir(builtInRoot, { withFileTypes: true });
  const result: TemplateCatalogEntry[] = await Promise.all(builtIn.filter((entry) => entry.isDirectory()).map(async (entry) => ({
    ...(await loadTemplateDirectory(entry.name, path.join(builtInRoot, entry.name))),
    origin: "built-in" as const,
  })));
  for (const item of await installedTemplateDirectories(dataRoot)) {
    const id = path.basename(item.directory);
    if (result.some((entry) => entry.profile.id === id)) throw new Error(`Installed template conflicts with an existing id: ${id}`);
    result.push({ ...(await loadTemplateDirectory(id, item.directory)), origin: "customer-kit", kitId: item.kit.id, kitName: item.kit.name });
  }
  return result.sort((left, right) => left.profile.name.localeCompare(right.profile.name));
}

export async function listAvailableBrands(dataRoot = defaultUserDataRoot()): Promise<BrandCatalogEntry[]> {
  const result: BrandCatalogEntry[] = [];
  for (const item of await installedBrandDirectories(dataRoot)) {
    const profile = await readJson<BrandProfile>(path.join(item.directory, "brand.json"));
    const issues = validateBrand(profile);
    if (hasErrors(issues)) throw new Error(formatIssues(issues));
    if (result.some((entry) => entry.profile.id === profile.id)) throw new Error(`Installed brand conflicts with an existing id: ${profile.id}`);
    result.push({ profile, directory: item.directory, origin: item.kit ? "customer-kit" : "local", ...(item.kit ? { kitId: item.kit.id, kitName: item.kit.name } : {}) });
  }
  return result.sort((left, right) => left.profile.name.localeCompare(right.profile.name));
}

function uniqueName(name: string, used: Set<string>): string {
  const extension = path.extname(name);
  const stem = path.basename(name, extension);
  let candidate = name;
  let index = 2;
  while (used.has(candidate.toLowerCase())) candidate = `${stem}-${index++}${extension}`;
  used.add(candidate.toLowerCase());
  return candidate;
}

function briefMarkdown(brief: ProjectBrief, template: TemplateProfile, sources: string[]): string {
  const language = brief.language === "vi" ? "Tiếng Việt" : "English";
  const sourceList = sources.length ? sources.map((name) => `- \`sources/${name}\``).join("\n") : "- Chưa có; hãy hỏi người dùng nếu thiếu bằng chứng quan trọng.";
  return `# Presentation brief

- **Project:** ${brief.projectName}
- **Title:** ${brief.title}
- **Goal:** ${brief.goal}
- **Audience:** ${brief.audience}
- **Duration:** ${brief.durationMinutes} minutes
- **Language:** ${language}
- **Template:** ${template.name} (\`${template.id}\`)

## Source files

${sourceList}

## Authoring direction

Read \`template/recipe.md\` before shaping the story. Keep claims grounded in the supplied files, use the selected visual grammar, and move supporting detail into speaker notes instead of shrinking slide content.
`;
}

export function codexPrompt(): string {
  return "Use $beautiful-ppt. Read brief.md and template/recipe.md, inspect every file under sources/, then author, preview, review, and build this presentation. Keep the selected template and theme unless the brief requires otherwise.";
}

export async function createPresentationProject(options: CreateProjectOptions): Promise<CreatedProject> {
  validateBrief(options.brief);
  const target = path.resolve(options.targetDirectory);
  if (target === path.parse(target).root || target === path.resolve(homedir())) throw new Error(`Refusing to create a project at a broad path: ${target}`);
  if (await exists(target)) {
    const entries = await readdir(target);
    if (entries.length) throw new Error(`Project directory is not empty: ${target}`);
  }

  const { profile, directory: templateDirectory } = await loadTemplate(options.templateId, options.rootDirectory ?? packageRoot, options.dataRoot ?? defaultUserDataRoot());
  let brandSource = path.resolve(templateDirectory, profile.brandProfile);
  if (options.brandId) {
    const selected = (await listAvailableBrands(options.dataRoot ?? defaultUserDataRoot())).find((item) => item.profile.id === options.brandId);
    if (!selected) throw new Error(`Unknown brand profile: ${options.brandId}`);
    brandSource = path.join(selected.directory, "brand.json");
  }
  const brand = await readJson<BrandProfile>(brandSource);
  const brandIssues = validateBrand(brand);
  if (hasErrors(brandIssues)) throw new Error(formatIssues(brandIssues));

  await Promise.all([
    mkdir(path.join(target, "brand"), { recursive: true }),
    mkdir(path.join(target, "sources"), { recursive: true }),
    mkdir(path.join(target, "assets"), { recursive: true }),
    mkdir(path.join(target, "output"), { recursive: true }),
  ]);
  await cp(templateDirectory, path.join(target, "template"), { recursive: true });

  const projectBrand = structuredClone(brand);
  const brandDirectory = path.dirname(brandSource);
  const copyBrandAsset = async (reference: string, stem: string): Promise<string> => {
    const source = path.resolve(brandDirectory, reference);
    const relative = path.relative(brandDirectory, source);
    if (relative.startsWith("..") || path.isAbsolute(relative) || !(await stat(source).catch(() => null))?.isFile()) throw new Error(`Brand asset not found or outside its profile: ${reference}`);
    const filename = `${stem}${path.extname(source).toLowerCase()}`;
    await copyFile(source, path.join(target, "brand", filename));
    return filename;
  };
  if (projectBrand.logo) projectBrand.logo = await copyBrandAsset(projectBrand.logo, "logo");
  if (projectBrand.logos?.light) projectBrand.logos.light = await copyBrandAsset(projectBrand.logos.light, "logo-light");
  if (projectBrand.logos?.dark) projectBrand.logos.dark = await copyBrandAsset(projectBrand.logos.dark, "logo-dark");
  if (options.logoPath) {
    const logoInfo = await stat(options.logoPath).catch(() => null);
    if (!logoInfo?.isFile()) throw new Error(`Logo not found: ${options.logoPath}`);
    const extension = path.extname(options.logoPath).toLowerCase();
    if (![".png", ".jpg", ".jpeg", ".webp", ".svg"].includes(extension)) throw new Error("Logo must be PNG, JPEG, WebP, or SVG.");
    const filename = `logo${extension}`;
    await copyFile(options.logoPath, path.join(target, "brand", filename));
    projectBrand.logo = filename;
    delete projectBrand.logos;
  }
  await writeFile(path.join(target, "brand", "brand.json"), JSON.stringify(projectBrand, null, 2), "utf8");

  const copiedSources: string[] = [];
  const usedNames = new Set<string>();
  for (const source of options.sourcePaths ?? []) {
    const info = await stat(source).catch(() => null);
    if (!info?.isFile()) throw new Error(`Source file not found: ${source}`);
    const filename = uniqueName(path.basename(source), usedNames);
    await copyFile(source, path.join(target, "sources", filename));
    copiedSources.push(filename);
  }

  const deck: DeckSpec = {
    version: 1,
    meta: {
      title: options.brief.title,
      language: options.brief.language === "vi" ? "vi-VN" : "en-US",
      audience: options.brief.audience,
      purpose: options.brief.goal,
      durationMinutes: options.brief.durationMinutes,
    },
    brandProfile: "./brand/brand.json",
    templateProfile: "./template/template.json",
    theme: options.theme,
    outputMode: "hybrid",
    sections: [{
      id: "draft",
      title: "Draft",
      slides: [{
        id: "cover",
        kind: "hero",
        eyebrow: profile.name,
        title: options.brief.title,
        body: options.brief.goal,
        tags: [options.brief.audience, `${options.brief.durationMinutes} min`],
      }],
    }],
  };
  const prompt = codexPrompt();
  await Promise.all([
    writeFile(path.join(target, "deck.json"), JSON.stringify(deck, null, 2), "utf8"),
    writeFile(path.join(target, "brief.md"), briefMarkdown(options.brief, profile, copiedSources), "utf8"),
    writeFile(path.join(target, ".gitignore"), "output/\n", "utf8"),
    writeFile(path.join(target, "README.md"), `# ${options.brief.title}\n\nOpen this folder in VS Code, open Codex, and paste:\n\n> ${prompt}\n`, "utf8"),
  ]);
  return { projectPath: target, deckPath: path.join(target, "deck.json"), prompt, template: profile };
}
