import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { cp, lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { formatIssues, hasErrors, readJson, validateBrand, validateTemplate } from "./model.js";
import { isInside, isSlug, packageRoot, sha256 } from "./util.js";
import type { BrandProfile, CustomerKitManifest, TemplateProfile } from "./types.js";

const MAX_FILES = 2_000;
const MAX_BYTES = 250 * 1024 * 1024;
const SAFE_EXTENSIONS = new Set([".json", ".css", ".md", ".webp", ".png", ".jpg", ".jpeg", ".svg", ".pptx"]);
const SAFE_ROOTS = new Set(["templates", "brands", "demo"]);

export function defaultUserDataRoot(): string {
  return path.join(homedir(), ".vibeppt");
}

function safeArchivePath(value: string): string {
  const normalized = path.posix.normalize(value.replaceAll("\\", "/"));
  if (!normalized || normalized.startsWith("/") || normalized === ".." || normalized.startsWith("../") || /^[a-z]:/i.test(normalized)) {
    throw new Error(`Unsafe kit path: ${value}`);
  }
  return normalized;
}

function validateKitFilePath(relative: string): void {
  const normalized = safeArchivePath(relative);
  if (normalized === "kit.json" || normalized === "NOTICE.md") return;
  const root = normalized.split("/")[0] ?? "";
  if (!SAFE_ROOTS.has(root)) throw new Error(`Kit file is outside the allowed folders: ${relative}`);
  const extension = path.posix.extname(normalized).toLowerCase();
  if (!SAFE_EXTENSIONS.has(extension)) throw new Error(`Kit file type is not allowed: ${relative}`);
  if (extension === ".pptx" && root !== "demo") throw new Error(`Source PPTX files are not allowed in customer kits: ${relative}`);
}

async function walkFiles(root: string, relative = ""): Promise<string[]> {
  const directory = path.join(root, relative);
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const child = path.join(relative, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symlinks are not allowed in customer kits: ${child}`);
    if (entry.isDirectory()) files.push(...await walkFiles(root, child));
    else if (entry.isFile()) files.push(child.split(path.sep).join("/"));
  }
  return files;
}

function validateManifest(value: unknown): asserts value is CustomerKitManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("kit.json must be an object.");
  const manifest = value as Record<string, unknown>;
  if (manifest.version !== 1) throw new Error("Only Customer Kit version 1 is supported.");
  if (!isSlug(manifest.id)) throw new Error("Customer Kit id must be a lowercase slug.");
  for (const field of ["name", "customer", "createdAt", "minVibePptVersion"] as const) {
    if (typeof manifest[field] !== "string" || !manifest[field].trim()) throw new Error(`Customer Kit ${field} is required.`);
  }
  for (const field of ["templates", "brands"] as const) {
    if (!Array.isArray(manifest[field]) || manifest[field].length === 0 || manifest[field].some((item) => !isSlug(item))) {
      throw new Error(`Customer Kit ${field} must contain one or more ids.`);
    }
  }
  if (!manifest.files || typeof manifest.files !== "object" || Array.isArray(manifest.files)) throw new Error("Customer Kit file checksums are required.");
}

function validateManifestContents(manifest: CustomerKitManifest, files: string[]): void {
  const available = new Set(files);
  const expectedExtensions = { deck: ".json", pptx: ".pptx", contactSheet: ".png" } as const;
  for (const [field, extension] of Object.entries(expectedExtensions) as Array<[keyof NonNullable<CustomerKitManifest["demo"]>, string]>) {
    const reference = manifest.demo?.[field];
    if (!reference) continue;
    const normalized = safeArchivePath(reference);
    if (!normalized.startsWith("demo/") || path.posix.extname(normalized).toLowerCase() !== extension || !available.has(normalized)) {
      throw new Error(`Customer Kit demo.${field} must reference an existing ${extension} file under demo/.`);
    }
  }
  const presentations = files.filter((item) => path.posix.extname(item).toLowerCase() === ".pptx");
  if (presentations.length && (presentations.length !== 1 || presentations[0] !== manifest.demo?.pptx)) {
    throw new Error("Customer Kit may contain only the single demo PPTX declared by demo.pptx.");
  }
}

async function validateInstalledContent(root: string, manifest: CustomerKitManifest): Promise<void> {
  for (const id of manifest.templates) {
    const directory = path.join(root, "templates", id);
    const profile = await readJson<TemplateProfile>(path.join(directory, "template.json"));
    const issues = validateTemplate(profile);
    if (profile.id !== id) throw new Error(`Template folder ${id} contains profile ${profile.id}.`);
    if (hasErrors(issues)) throw new Error(formatIssues(issues));
    for (const reference of [profile.stylesheet, profile.brandProfile, profile.sampleDeck, profile.recipe, profile.preview.dark, profile.preview.light]) {
      const target = path.resolve(directory, reference);
      if (!isInside(directory, target) || !(await stat(target).catch(() => null))?.isFile()) {
        throw new Error(`Template ${id} has a missing or external asset: ${reference}`);
      }
    }
  }
  for (const id of manifest.brands) {
    const directory = path.join(root, "brands", id);
    const profile = await readJson<BrandProfile>(path.join(directory, "brand.json"));
    const issues = validateBrand(profile);
    if (profile.id !== id) throw new Error(`Brand folder ${id} contains profile ${profile.id}.`);
    if (hasErrors(issues)) throw new Error(formatIssues(issues));
    for (const reference of [profile.logo, profile.logos?.light, profile.logos?.dark].filter((item): item is string => Boolean(item))) {
      const target = path.resolve(directory, reference);
      if (!isInside(directory, target) || !(await stat(target).catch(() => null))?.isFile()) {
        throw new Error(`Brand ${id} has a missing or external logo: ${reference}`);
      }
    }
  }
}

export async function buildCustomerKit(workspace: string, outputFile: string, force = false): Promise<CustomerKitManifest> {
  const root = path.resolve(workspace);
  const source = await readJson<Omit<CustomerKitManifest, "createdAt" | "files"> & { createdAt?: string; files?: Record<string, string> }>(path.join(root, "kit.json"));
  const candidates: string[] = [];
  for (const directory of SAFE_ROOTS) {
    if ((await stat(path.join(root, directory)).catch(() => null))?.isDirectory()) candidates.push(...await walkFiles(root, directory));
  }
  if ((await stat(path.join(root, "NOTICE.md")).catch(() => null))?.isFile()) candidates.push("NOTICE.md");
  if (candidates.length > MAX_FILES) throw new Error(`Customer Kit has ${candidates.length} files; maximum is ${MAX_FILES}.`);
  const zip = new JSZip();
  const checksums: Record<string, string> = {};
  let totalBytes = 0;
  for (const relative of candidates) {
    validateKitFilePath(relative);
    const filePath = path.join(root, ...relative.split("/"));
    const info = await lstat(filePath);
    if (!info.isFile()) continue;
    const content = await readFile(filePath);
    totalBytes += content.length;
    if (totalBytes > MAX_BYTES) throw new Error("Customer Kit exceeds 250 MB uncompressed.");
    checksums[relative] = sha256(content);
    zip.file(relative, content);
  }
  const manifest: CustomerKitManifest = {
    ...source,
    version: 1,
    createdAt: new Date().toISOString(),
    minVibePptVersion: source.minVibePptVersion || "0.4.0-alpha.1",
    files: checksums,
  };
  validateManifest(manifest);
  validateManifestContents(manifest, candidates);
  await validateInstalledContent(root, manifest);
  zip.file("kit.json", JSON.stringify(manifest, null, 2));
  const target = path.resolve(outputFile);
  if ((await stat(target).catch(() => null)) && !force) throw new Error(`Customer Kit already exists: ${target}\nPass --force to replace it.`);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } }));
  return manifest;
}

export async function installCustomerKit(inputFile: string, options: { force?: boolean; dataRoot?: string } = {}): Promise<CustomerKitManifest> {
  const archive = await JSZip.loadAsync(await readFile(path.resolve(inputFile)));
  const fileEntries = Object.values(archive.files).filter((entry) => !entry.dir);
  if (fileEntries.length > MAX_FILES + 1) throw new Error(`Customer Kit has too many files; maximum is ${MAX_FILES}.`);
  const buffers = new Map<string, Buffer>();
  let totalBytes = 0;
  for (const entry of fileEntries) {
    const relative = safeArchivePath(entry.name);
    validateKitFilePath(relative);
    const content = await entry.async("nodebuffer");
    totalBytes += content.length;
    if (totalBytes > MAX_BYTES) throw new Error("Customer Kit exceeds 250 MB uncompressed.");
    buffers.set(relative, content);
  }
  const manifestContent = buffers.get("kit.json");
  if (!manifestContent) throw new Error("Customer Kit is missing kit.json.");
  const manifest = JSON.parse(manifestContent.toString("utf8")) as unknown;
  validateManifest(manifest);
  const expectedFiles = Object.keys(manifest.files).sort();
  const actualFiles = [...buffers.keys()].filter((item) => item !== "kit.json").sort();
  if (JSON.stringify(expectedFiles) !== JSON.stringify(actualFiles)) throw new Error("Customer Kit contents do not match its checksum manifest.");
  validateManifestContents(manifest, actualFiles);
  for (const [relative, expected] of Object.entries(manifest.files)) {
    const content = buffers.get(relative);
    if (!content || sha256(content) !== expected) throw new Error(`Customer Kit checksum failed: ${relative}`);
  }

  const dataRoot = path.resolve(options.dataRoot ?? defaultUserDataRoot());
  const kitsRoot = path.join(dataRoot, "kits");
  const temporary = path.join(kitsRoot, `.install-${manifest.id}-${randomBytes(6).toString("hex")}`);
  const target = path.join(kitsRoot, manifest.id);
  let backup: string | undefined;
  await mkdir(temporary, { recursive: true });
  try {
    for (const [relative, content] of buffers) {
      const output = path.join(temporary, ...relative.split("/"));
      await mkdir(path.dirname(output), { recursive: true });
      await writeFile(output, content);
    }
    await validateInstalledContent(temporary, manifest);
    const otherKits = (await listInstalledKits(dataRoot)).filter((kit) => kit.id !== manifest.id);
    const templateConflicts = otherKits.flatMap((kit) => kit.templates).filter((id) => manifest.templates.includes(id));
    const brandConflicts = otherKits.flatMap((kit) => kit.brands).filter((id) => manifest.brands.includes(id));
    if (templateConflicts.length || brandConflicts.length) throw new Error(`Customer Kit ids conflict with installed kits: ${[...templateConflicts, ...brandConflicts].join(", ")}`);
    for (const id of manifest.templates) {
      if ((await stat(path.join(packageRoot, "templates", id)).catch(() => null))?.isDirectory()) throw new Error(`Customer Kit template conflicts with a built-in template: ${id}`);
    }
    for (const id of manifest.brands) {
      if ((await stat(path.join(dataRoot, "brands", id)).catch(() => null))?.isDirectory()) throw new Error(`Customer Kit brand conflicts with a local brand: ${id}`);
    }
    if (await stat(target).catch(() => null)) {
      if (!options.force) throw new Error(`Customer Kit is already installed: ${manifest.id}\nPass --force to update it.`);
      backup = path.join(kitsRoot, `${manifest.id}.backup-${new Date().toISOString().replace(/[:.]/g, "-")}`);
      await rename(target, backup);
    }
    try {
      await rename(temporary, target);
    } catch (error) {
      if (backup) await rename(backup, target).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
  return manifest;
}

export async function listInstalledKits(dataRoot = defaultUserDataRoot()): Promise<CustomerKitManifest[]> {
  const kitsRoot = path.join(dataRoot, "kits");
  const entries = await readdir(kitsRoot, { withFileTypes: true }).catch(() => []);
  const manifests: CustomerKitManifest[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.includes(".backup-") || entry.name.startsWith(".install-")) continue;
    const manifest = await readJson<unknown>(path.join(kitsRoot, entry.name, "kit.json")).catch(() => null);
    if (!manifest) continue;
    try {
      validateManifest(manifest);
      if (manifest.id === entry.name) manifests.push(manifest);
    } catch { /* Ignore incomplete or manually corrupted kit folders. */ }
  }
  return manifests.sort((left, right) => left.name.localeCompare(right.name));
}

export async function installedTemplateDirectories(dataRoot = defaultUserDataRoot()): Promise<Array<{ kit: CustomerKitManifest; directory: string }>> {
  const kits = await listInstalledKits(dataRoot);
  return kits.flatMap((kit) => kit.templates.map((id) => ({ kit, directory: path.join(dataRoot, "kits", kit.id, "templates", id) })));
}

export async function installedBrandDirectories(dataRoot = defaultUserDataRoot()): Promise<Array<{ kit?: CustomerKitManifest; directory: string }>> {
  const result: Array<{ kit?: CustomerKitManifest; directory: string }> = [];
  for (const kit of await listInstalledKits(dataRoot)) {
    result.push(...kit.brands.map((id) => ({ kit, directory: path.join(dataRoot, "kits", kit.id, "brands", id) })));
  }
  const localRoot = path.join(dataRoot, "brands");
  for (const entry of await readdir(localRoot, { withFileTypes: true }).catch(() => [])) {
    if (entry.isDirectory() && !entry.name.startsWith(".")) result.push({ directory: path.join(localRoot, entry.name) });
  }
  return result;
}

export async function saveLocalBrand(sourceDirectory: string, id: string, options: { force?: boolean; dataRoot?: string } = {}): Promise<string> {
  if (!isSlug(id)) throw new Error("Brand id must be a lowercase slug.");
  const profile = await readJson<BrandProfile>(path.join(sourceDirectory, "brand.json"));
  const issues = validateBrand(profile);
  if (profile.id !== id) throw new Error(`Brand folder ${id} contains profile ${profile.id}.`);
  if (hasErrors(issues)) throw new Error(formatIssues(issues));
  const brandsRoot = path.join(options.dataRoot ?? defaultUserDataRoot(), "brands");
  const target = path.join(brandsRoot, id);
  const temporary = path.join(brandsRoot, `.save-${id}-${randomBytes(6).toString("hex")}`);
  const backup = path.join(brandsRoot, `.backup-${id}-${randomBytes(6).toString("hex")}`);
  await mkdir(brandsRoot, { recursive: true });
  await cp(sourceDirectory, temporary, { recursive: true });
  let moved = false;
  try {
    if (await stat(target).catch(() => null)) {
      if (!options.force) throw new Error(`Brand already exists: ${id}`);
      await rename(target, backup);
      moved = true;
    }
    try {
      await rename(temporary, target);
    } catch (error) {
      if (moved) await rename(backup, target).catch(() => undefined);
      throw error;
    }
    if (moved) await rm(backup, { recursive: true, force: true });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  return target;
}
