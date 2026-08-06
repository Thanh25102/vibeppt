import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Repo root, resolved from dist/ at runtime. Scripts, templates and presets hang off this. */
export const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Ids across decks, brands, templates, kits and layouts are all the same lowercase slug. */
export function isSlug(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]*$/.test(value);
}

export function isInside(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function sha256(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Forward slashes, always. Deck ids hash this string, so a Windows backslash here would give
 * the same file a different id than Linux and silently invalidate a workspace selection.
 */
export function portableRelative(root: string, target: string): string {
  return path.relative(root, target).split(path.sep).join("/");
}

/**
 * The single way this project talks to Windows. `inherit` streams straight to the terminal for
 * long PowerPoint runs; otherwise stdout is returned and stderr becomes the error message.
 */
export async function runPowerShell(scriptName: string, args: string[] = [], options: { inherit?: boolean } = {}): Promise<string> {
  if (process.platform !== "win32") throw new Error(`${scriptName} requires Windows.`);
  const script = path.join(packageRoot, "scripts", scriptName);
  const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, ...args], {
    windowsHide: true,
    stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout?.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
  child.stderr?.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
  const code = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (value) => resolve(value ?? 1));
  });
  if (code !== 0) throw new Error(Buffer.concat(stderr).toString("utf8").trim() || `${scriptName} failed with exit code ${code}.`);
  return Buffer.concat(stdout).toString("utf8").trim();
}
