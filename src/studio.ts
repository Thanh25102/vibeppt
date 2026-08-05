import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPresentationProject, listAvailableBrands, listAvailableTemplates, type ProjectBrief } from "./templates.js";
import { formatIssues, hasErrors, readJson, slugify, validateBrand } from "./model.js";
import { renderDeckHtml } from "./html.js";
import { defaultUserDataRoot, installCustomerKit, listInstalledKits, saveLocalBrand } from "./kits.js";
import { validateCurationSelection, validateLibraryShortlist } from "./library.js";
import type { BrandProfile, CurationSelection, DeckSpec, LibraryCatalog, LibraryShortlist, ThemeName } from "./types.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_BODY_BYTES = 1024 * 1024;

type Selection = { kind: "folder" | "sources" | "logo" | "kit"; paths: string[] };

interface StudioOptions {
  openBrowser?: boolean;
  idleMinutes?: number;
  workshop?: string;
  dataRoot?: string;
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

function sendError(response: ServerResponse, status: number, error: unknown): void {
  sendJson(response, status, { error: (error as Error).message || String(error) });
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body is too large.");
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function contentType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".html": return "text/html; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".js": return "text/javascript; charset=utf-8";
    case ".webp": return "image/webp";
    case ".svg": return "image/svg+xml";
    case ".json": return "application/json; charset=utf-8";
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    default: return "application/octet-stream";
  }
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function sendFile(response: ServerResponse, filePath: string): Promise<void> {
  const info = await stat(filePath).catch(() => null);
  if (!info?.isFile()) {
    sendJson(response, 404, { error: "Not found." });
    return;
  }
  response.writeHead(200, { "Content-Type": contentType(filePath), "Cache-Control": "no-cache" });
  response.end(await readFile(filePath));
}

async function runPowerShell(scriptName: string, args: string[] = []): Promise<string> {
  if (process.platform !== "win32") throw new Error("This action requires Windows.");
  const script = path.join(packageRoot, "scripts", scriptName);
  const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, ...args], { windowsHide: true });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
  child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
  const code = await new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (value) => resolve(value ?? 1));
  });
  if (code !== 0) throw new Error(Buffer.concat(stderr).toString("utf8").trim() || `${scriptName} failed with exit code ${code}.`);
  return Buffer.concat(stdout).toString("utf8").trim();
}

function openBrowser(url: string): void {
  if (process.platform === "win32") {
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(packageRoot, "scripts", "open-url.ps1"), "-Url", url], { detached: true, stdio: "ignore", windowsHide: true });
    child.unref();
    return;
  }
  const command = process.platform === "darwin" ? "open" : "xdg-open";
  const child = spawn(command, [url], { detached: true, stdio: "ignore" });
  child.unref();
}

function selectionId(): string {
  return randomBytes(12).toString("base64url");
}

async function dataUrl(filePath: string): Promise<string> {
  const type = contentType(filePath).split(";")[0];
  return `data:${type};base64,${(await readFile(filePath)).toString("base64")}`;
}

export async function startStudio(options: StudioOptions = {}): Promise<void> {
  const token = randomBytes(24).toString("base64url");
  const dataRoot = path.resolve(options.dataRoot ?? defaultUserDataRoot());
  const workshopRoot = options.workshop ? path.resolve(options.workshop) : undefined;
  const workshopCatalog = workshopRoot ? await readJson<LibraryCatalog>(path.join(workshopRoot, "library.json")) : undefined;
  const selections = new Map<string, Selection>();
  const projects = new Map<string, string>();
  const brandPreviews = new Map<string, string>();
  const resolveBrandBase = async (brandId: unknown, templateId: unknown): Promise<string | undefined> => {
    if (typeof brandId === "string" && brandId) return (await listAvailableBrands(dataRoot)).find((item) => item.profile.id === brandId)?.directory;
    if (typeof templateId === "string" && templateId) {
      const template = (await listAvailableTemplates(packageRoot, dataRoot)).find((item) => item.profile.id === templateId);
      if (template) return path.dirname(path.resolve(template.directory, template.profile.brandProfile));
    }
    return undefined;
  };
  let origin = "";
  let idleTimer: NodeJS.Timeout;
  const idleMs = Math.max(5, options.idleMinutes ?? 30) * 60_000;

  const server = createServer(async (request, response) => {
    const resetIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => server.close(), idleMs);
    };
    resetIdle();
    response.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-src 'self'; frame-ancestors 'self'; base-uri 'none'");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    const requestUrl = new URL(request.url ?? "/", origin || "http://127.0.0.1");

    try {
      if (requestUrl.pathname.startsWith("/api/")) {
        if (request.headers["x-vibeppt-session"] !== token || (request.headers.origin && request.headers.origin !== origin)) {
          sendJson(response, 403, { error: "Invalid Studio session." });
          return;
        }
      }

      if (request.method === "GET" && requestUrl.pathname === "/") {
        await sendFile(response, path.join(packageRoot, "studio", "index.html"));
        return;
      }
      if (request.method === "GET" && requestUrl.pathname.startsWith("/assets/")) {
        const target = path.resolve(packageRoot, "studio", requestUrl.pathname.slice("/assets/".length));
        if (!isInside(path.join(packageRoot, "studio"), target)) throw new Error("Invalid asset path.");
        await sendFile(response, target);
        return;
      }
      if (request.method === "GET" && requestUrl.pathname.startsWith("/templates/")) {
        const target = path.resolve(packageRoot, requestUrl.pathname.slice(1));
        if (!isInside(path.join(packageRoot, "templates"), target)) throw new Error("Invalid template asset path.");
        await sendFile(response, target);
        return;
      }
      if (request.method === "GET" && requestUrl.pathname.startsWith("/template-assets/")) {
        const [, , id, ...parts] = requestUrl.pathname.split("/");
        const entry = (await listAvailableTemplates(packageRoot, dataRoot)).find((item) => item.profile.id === id);
        if (!entry) throw new Error("Unknown template asset.");
        const target = path.resolve(entry.directory, ...parts.map(decodeURIComponent));
        if (!isInside(entry.directory, target)) throw new Error("Invalid template asset path.");
        await sendFile(response, target);
        return;
      }
      if (request.method === "GET" && requestUrl.pathname.startsWith("/workshop-files/")) {
        if (!workshopRoot) throw new Error("Workshop is not open.");
        const target = path.resolve(workshopRoot, requestUrl.pathname.slice("/workshop-files/".length));
        if (!isInside(workshopRoot, target)) throw new Error("Invalid workshop asset path.");
        await sendFile(response, target);
        return;
      }
      if (request.method === "GET" && requestUrl.pathname.startsWith("/brand-preview/")) {
        const id = requestUrl.pathname.slice("/brand-preview/".length);
        const html = brandPreviews.get(id);
        if (!html) {
          sendJson(response, 404, { error: "Brand preview expired." });
          return;
        }
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        response.end(html);
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/api/templates") {
        const templates = await listAvailableTemplates(packageRoot, dataRoot);
        sendJson(response, 200, await Promise.all(templates.map(async (entry) => ({
          ...entry.profile,
          origin: entry.origin,
          ...(entry.kitId ? { kitId: entry.kitId, kitName: entry.kitName } : {}),
          defaultBrand: await readJson<BrandProfile>(path.join(entry.directory, entry.profile.brandProfile)),
          preview: {
            dark: `/template-assets/${entry.profile.id}/${entry.profile.preview.dark.replace(/^\.\//, "")}`,
            light: `/template-assets/${entry.profile.id}/${entry.profile.preview.light.replace(/^\.\//, "")}`,
          },
        }))));
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/api/brands") {
        const brands = await listAvailableBrands(dataRoot);
        sendJson(response, 200, brands.map((entry) => ({ ...entry.profile, origin: entry.origin, ...(entry.kitId ? { kitId: entry.kitId, kitName: entry.kitName } : {}) })));
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/api/kits") {
        sendJson(response, 200, await listInstalledKits(dataRoot));
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/api/fonts") {
        if (process.platform === "win32") sendJson(response, 200, JSON.parse(await runPowerShell("list-fonts.ps1")));
        else {
          const templates = await listAvailableTemplates(packageRoot, dataRoot);
          const fonts = [...new Set((await Promise.all(templates.map((item) => readJson<BrandProfile>(path.join(item.directory, item.profile.brandProfile))))).flatMap((brand) => [brand.fonts.display, brand.fonts.body, brand.fonts.fallback].filter((item): item is string => Boolean(item))))].sort();
          sendJson(response, 200, fonts);
        }
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/api/workshop") {
        if (!workshopRoot || !workshopCatalog) {
          sendJson(response, 200, null);
          return;
        }
        const workshopShortlist = await readJson<LibraryShortlist>(path.join(workshopRoot, "deck-shortlist.json")).catch(() => undefined);
        if (workshopShortlist) validateLibraryShortlist(workshopShortlist, workshopCatalog);
        const selection = await readJson<CurationSelection>(path.join(workshopRoot, "selection.json")).catch(() => null);
        const sanitizeImage = (value: string) => `/workshop-files/${value.split(path.sep).join("/").replace(/^\.\//, "")}`;
        sendJson(response, 200, {
          catalog: { ...workshopCatalog, decks: workshopCatalog.decks.map(({ source: _source, ...deck }) => ({ ...deck, sampleImages: deck.sampleImages.map(sanitizeImage) })) },
          shortlist: workshopShortlist?.decks,
          selection: selection ? { ...selection, layouts: selection.layouts.map((layout) => ({
            ...layout,
            selected: { ...layout.selected, image: sanitizeImage(layout.selected.image) },
            alternatives: layout.alternatives.map((candidate) => ({ ...candidate, image: sanitizeImage(candidate.image) })),
          })) } : null,
        });
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/dialog/folder") {
        const output = await runPowerShell("pick-folder.ps1");
        if (!output) {
          response.writeHead(204).end();
          return;
        }
        const id = selectionId();
        selections.set(id, { kind: "folder", paths: [output] });
        sendJson(response, 200, { id, displayPath: output });
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/dialog/files") {
        const body = await readJsonBody(request);
        const kind = body.kind === "logo" ? "logo" : body.kind === "kit" ? "kit" : "sources";
        const output = await runPowerShell("pick-files.ps1", ["-Kind", kind]);
        if (!output) {
          response.writeHead(204).end();
          return;
        }
        const paths = JSON.parse(output) as string[];
        const id = selectionId();
        selections.set(id, { kind, paths });
        sendJson(response, 200, { id, files: paths.map((item) => path.basename(item)) });
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/brand-previews") {
        const body = await readJsonBody(request);
        const brand = structuredClone(body.brand as unknown as BrandProfile);
        const issues = validateBrand(brand);
        if (hasErrors(issues)) throw new Error(formatIssues(issues));
        const templateId = String(body.templateId ?? "");
        const entry = (await listAvailableTemplates(packageRoot, dataRoot)).find((item) => item.profile.id === templateId);
        if (!entry) throw new Error(`Unknown template: ${templateId}`);
        const baseDirectory = await resolveBrandBase(body.baseBrandId, templateId);
        const assetMap = new Map<string, string>();
        const applyLogo = async (theme: ThemeName, rawSelectionId: unknown) => {
          const selected = rawSelectionId ? selections.get(String(rawSelectionId)) : undefined;
          if (selected && selected.kind !== "logo") throw new Error("Invalid logo selection.");
          if (selected?.paths[0]) {
            const reference = `preview-${theme}${path.extname(selected.paths[0]).toLowerCase()}`;
            brand.logos = { ...brand.logos, [theme]: reference };
            assetMap.set(`brand:${reference}`, await dataUrl(selected.paths[0]));
            return;
          }
          const reference = brand.logos?.[theme] ?? brand.logo;
          if (reference && baseDirectory) {
            const source = path.resolve(baseDirectory, reference);
            if (isInside(baseDirectory, source) && (await stat(source).catch(() => null))?.isFile()) assetMap.set(`brand:${reference}`, await dataUrl(source));
          }
        };
        await applyLogo("light", body.lightLogoSelectionId);
        await applyLogo("dark", body.darkLogoSelectionId);
        const deck = await readJson<DeckSpec>(path.join(entry.directory, entry.profile.sampleDeck));
        const css = await readFile(path.join(entry.directory, entry.profile.stylesheet), "utf8");
        const previewId = selectionId();
        brandPreviews.set(previewId, renderDeckHtml(deck, brand, { theme: body.theme === "light" ? "light" : "dark", assetMap, templateCss: css, templateId }));
        while (brandPreviews.size > 20) brandPreviews.delete(brandPreviews.keys().next().value!);
        sendJson(response, 201, { url: `/brand-preview/${previewId}` });
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/brands") {
        const body = await readJsonBody(request);
        const brand = structuredClone(body.brand as unknown as BrandProfile);
        let issues = validateBrand(brand);
        if (hasErrors(issues)) throw new Error(formatIssues(issues));
        const baseDirectory = await resolveBrandBase(body.baseBrandId, body.templateId);
        const temporary = path.join(dataRoot, `.brand-draft-${brand.id}-${randomBytes(5).toString("hex")}`);
        await mkdir(temporary, { recursive: true });
        try {
          const copyLogo = async (theme: ThemeName, rawSelectionId: unknown) => {
            const selected = rawSelectionId ? selections.get(String(rawSelectionId)) : undefined;
            if (selected && selected.kind !== "logo") throw new Error("Invalid logo selection.");
            if (selected?.paths[0]) {
              const filename = `logo-${theme}${path.extname(selected.paths[0]).toLowerCase()}`;
              await copyFile(selected.paths[0], path.join(temporary, filename));
              brand.logos = { ...brand.logos, [theme]: filename };
              return;
            }
            const reference = brand.logos?.[theme];
            if (reference && baseDirectory) {
              const source = path.resolve(baseDirectory, reference);
              if (!isInside(baseDirectory, source)) throw new Error("Invalid base logo path.");
              const filename = `logo-${theme}${path.extname(reference).toLowerCase()}`;
              await copyFile(source, path.join(temporary, filename));
              brand.logos = { ...brand.logos, [theme]: filename };
            }
          };
          await copyLogo("light", body.lightLogoSelectionId);
          await copyLogo("dark", body.darkLogoSelectionId);
          if (brand.logo && baseDirectory && !brand.logos?.light && !brand.logos?.dark) {
            const source = path.resolve(baseDirectory, brand.logo);
            if (!isInside(baseDirectory, source)) throw new Error("Invalid base logo path.");
            const filename = `logo${path.extname(brand.logo).toLowerCase()}`;
            await copyFile(source, path.join(temporary, filename));
            brand.logo = filename;
          }
          issues = validateBrand(brand);
          if (hasErrors(issues)) throw new Error(formatIssues(issues));
          await writeFile(path.join(temporary, "brand.json"), JSON.stringify(brand, null, 2), "utf8");
          const saved = await saveLocalBrand(temporary, brand.id, { dataRoot, force: body.force === true });
          sendJson(response, 201, { id: brand.id, path: saved });
        } finally {
          await rm(temporary, { recursive: true, force: true });
        }
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/kits/install") {
        const body = await readJsonBody(request);
        const selected = selections.get(String(body.selectionId ?? ""));
        if (selected?.kind !== "kit" || !selected.paths[0]) throw new Error("Choose a Customer Kit first.");
        const manifest = await installCustomerKit(selected.paths[0], { dataRoot, force: body.force === true });
        sendJson(response, 201, manifest);
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/workshop/selection") {
        if (!workshopRoot || !workshopCatalog) throw new Error("Workshop is not open.");
        const body = await readJsonBody(request);
        const selection = structuredClone(body.selection as unknown as CurationSelection);
        const restore = (value: string) => value.replace(/^\/workshop-files\//, "");
        selection.layouts.forEach((layout) => {
          layout.selected.image = restore(layout.selected.image);
          layout.alternatives.forEach((candidate) => { candidate.image = restore(candidate.image); });
        });
        selection.updatedAt = new Date().toISOString();
        validateCurationSelection(selection, workshopCatalog);
        await writeFile(path.join(workshopRoot, "selection.json"), JSON.stringify(selection, null, 2), "utf8");
        sendJson(response, 200, { saved: true, updatedAt: selection.updatedAt });
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/workshop/open") {
        if (!workshopRoot) throw new Error("Workshop is not open.");
        await runPowerShell("open-vscode.ps1", ["-ProjectPath", workshopRoot]);
        sendJson(response, 200, { opened: true, prompt: "Use $beautiful-ppt. Read CURATION.md and complete this customer template workshop end to end." });
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/projects") {
        const body = await readJsonBody(request);
        const folder = selections.get(String(body.folderSelectionId ?? ""));
        const sources = body.sourceSelectionId ? selections.get(String(body.sourceSelectionId)) : undefined;
        const logo = body.logoSelectionId ? selections.get(String(body.logoSelectionId)) : undefined;
        if (folder?.kind !== "folder") throw new Error("Choose a project folder first.");
        if (sources && sources.kind !== "sources") throw new Error("Invalid source selection.");
        if (logo && logo.kind !== "logo") throw new Error("Invalid logo selection.");
        const brief = body.brief as unknown as ProjectBrief;
        const target = path.join(folder.paths[0]!, slugify(brief.projectName));
        const created = await createPresentationProject({
          targetDirectory: target,
          templateId: String(body.templateId ?? ""),
          theme: body.theme === "light" ? "light" : "dark" as ThemeName,
          brief,
          ...(sources ? { sourcePaths: sources.paths } : {}),
          ...(logo?.paths[0] ? { logoPath: logo.paths[0] } : {}),
          rootDirectory: packageRoot,
          dataRoot,
          ...(typeof body.brandId === "string" && body.brandId ? { brandId: body.brandId } : {}),
        });
        const id = selectionId();
        projects.set(id, created.projectPath);
        sendJson(response, 201, { projectId: id, projectPath: created.projectPath, prompt: created.prompt });
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/projects/open") {
        const body = await readJsonBody(request);
        const projectPath = projects.get(String(body.projectId ?? ""));
        if (!projectPath) throw new Error("Unknown project. Create it again in this Studio session.");
        await runPowerShell("open-vscode.ps1", ["-ProjectPath", projectPath]);
        sendJson(response, 200, { opened: true });
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/shutdown") {
        sendJson(response, 200, { stopped: true });
        setTimeout(() => server.close(), 50);
        return;
      }
      sendJson(response, 404, { error: "Not found." });
    } catch (error) {
      sendError(response, 400, error);
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Studio could not bind to localhost.");
  origin = `http://127.0.0.1:${address.port}`;
  const studioUrl = `${origin}/#token=${token}`;
  console.log(`VibePPT Studio: ${studioUrl}`);
  idleTimer = setTimeout(() => server.close(), idleMs);
  if (options.openBrowser !== false) openBrowser(studioUrl);
  await new Promise<void>((resolve) => server.once("close", resolve));
  clearTimeout(idleTimer);
}
