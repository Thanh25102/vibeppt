import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPresentationProject, listTemplates, type ProjectBrief } from "./templates.js";
import { slugify } from "./model.js";
import type { ThemeName } from "./types.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_BODY_BYTES = 1024 * 1024;

type Selection = { kind: "folder" | "sources" | "logo"; paths: string[] };

interface StudioOptions {
  openBrowser?: boolean;
  idleMinutes?: number;
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

export async function startStudio(options: StudioOptions = {}): Promise<void> {
  const token = randomBytes(24).toString("base64url");
  const selections = new Map<string, Selection>();
  const projects = new Map<string, string>();
  let origin = "";
  let idleTimer: NodeJS.Timeout;
  const idleMs = Math.max(5, options.idleMinutes ?? 30) * 60_000;

  const server = createServer(async (request, response) => {
    const resetIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => server.close(), idleMs);
    };
    resetIdle();
    response.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
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
      if (request.method === "GET" && requestUrl.pathname === "/api/templates") {
        const templates = await listTemplates(packageRoot);
        sendJson(response, 200, templates.map((template) => ({
          ...template,
          preview: {
            dark: `/templates/${template.id}/previews/dark.webp`,
            light: `/templates/${template.id}/previews/light.webp`,
          },
        })));
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
        const kind = body.kind === "logo" ? "logo" : "sources";
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
