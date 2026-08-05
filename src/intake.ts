import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export interface IntakeFinding {
  level: "error" | "warning" | "ok";
  area: string;
  message: string;
}

export interface IntakeReport {
  version: 1;
  root: string;
  generatedAt: string;
  ready: boolean;
  screenshots: Array<{ file: string; width: number | null; height: number | null }>;
  findings: IntakeFinding[];
}

// A screenshot placed on a 1920px-wide slide needs at least this much detail to survive being
// scaled up; below it the deck looks soft no matter how good the layout is.
const MIN_SCREENSHOT_WIDTH = 1600;

async function isDirectory(target: string): Promise<boolean> {
  return Boolean((await stat(target).catch(() => null))?.isDirectory());
}

async function isFile(target: string): Promise<boolean> {
  return Boolean((await stat(target).catch(() => null))?.isFile());
}

/** PNG keeps width and height in the IHDR chunk, so no image dependency is needed. */
function pngSize(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 24) return null;
  if (buffer.toString("ascii", 1, 4) !== "PNG") return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

export async function inspectIntake(root: string): Promise<IntakeReport> {
  const resolved = path.resolve(root);
  const findings: IntakeFinding[] = [];
  const screenshots: IntakeReport["screenshots"] = [];

  const briefPath = path.join(resolved, "brief.md");
  if (!(await isFile(briefPath))) {
    findings.push({ level: "error", area: "brief", message: "brief.md is missing. Without the audience, the decision and the duration the deck is guesswork." });
  } else {
    const brief = (await readFile(briefPath, "utf8")).toLowerCase();
    const missing = ([
      ["audience", ["audience", "khán giả", "người nghe"]],
      ["decision", ["decision", "quyết định", "next step"]],
      ["duration", ["minute", "duration", "phút", "thời lượng"]],
    ] as const).filter(([, keys]) => !keys.some((key) => brief.includes(key))).map(([name]) => name);
    if (missing.length) findings.push({ level: "warning", area: "brief", message: `brief.md does not mention: ${missing.join(", ")}.` });
    else findings.push({ level: "ok", area: "brief", message: "brief.md covers audience, decision and duration." });
  }

  const shotsDir = path.join(resolved, "screenshots");
  if (!(await isDirectory(shotsDir))) {
    findings.push({ level: "warning", area: "screenshots", message: "No screenshots/ folder. Real product screens are the single biggest driver of how good the deck looks." });
  } else {
    const entries = (await readdir(shotsDir)).filter((name) => /\.(png|jpe?g|svg|webp)$/i.test(name));
    if (!entries.length) {
      findings.push({ level: "warning", area: "screenshots", message: "screenshots/ is empty." });
    }
    for (const name of entries) {
      const size = name.toLowerCase().endsWith(".png") ? pngSize(await readFile(path.join(shotsDir, name))) : null;
      screenshots.push({ file: name, width: size?.width ?? null, height: size?.height ?? null });
      if (size && size.width < MIN_SCREENSHOT_WIDTH) {
        findings.push({ level: "warning", area: "screenshots", message: `${name} is only ${size.width}px wide; export at ${MIN_SCREENSHOT_WIDTH}px or wider, or supply SVG.` });
      }
    }
    if (entries.length && !findings.some((item) => item.area === "screenshots" && item.level !== "ok")) {
      findings.push({ level: "ok", area: "screenshots", message: `${entries.length} screenshot(s), all large enough.` });
    }
  }

  const factsPath = path.join(resolved, "facts.md");
  if (!(await isFile(factsPath))) {
    findings.push({ level: "error", area: "facts", message: "facts.md is missing. Every number on a slide needs a source, otherwise it cannot be used." });
  } else {
    const lines = (await readFile(factsPath, "utf8")).split(/\r?\n/).filter((line) => /\d/.test(line) && line.trim().length > 3);
    const unsourced = lines.filter((line) => !/https?:\/\/|\bsource\b|\bnguồn\b/i.test(line));
    if (!lines.length) findings.push({ level: "warning", area: "facts", message: "facts.md contains no numbers." });
    else if (unsourced.length) findings.push({ level: "warning", area: "facts", message: `${unsourced.length} of ${lines.length} fact line(s) have no source: ${unsourced.slice(0, 2).map((line) => line.trim().slice(0, 60)).join(" | ")}` });
    else findings.push({ level: "ok", area: "facts", message: `${lines.length} fact line(s), all sourced.` });
  }

  const brandDir = path.join(resolved, "brand");
  if (!(await isDirectory(brandDir))) {
    findings.push({ level: "warning", area: "brand", message: "No brand/ folder. The deck will fall back to the template's own palette and wordmark." });
  } else {
    const entries = await readdir(brandDir);
    const logos = entries.filter((name) => /logo/i.test(name));
    const hasLight = logos.some((name) => /light/i.test(name));
    const hasDark = logos.some((name) => /dark/i.test(name));
    if (!logos.length) findings.push({ level: "warning", area: "brand", message: "brand/ has no logo file." });
    else if (!hasLight || !hasDark) findings.push({ level: "warning", area: "brand", message: "Supply a logo for each theme, named so light and dark are distinguishable." });
    else findings.push({ level: "ok", area: "brand", message: "Light and dark logos supplied." });
  }

  return {
    version: 1,
    root: resolved,
    generatedAt: new Date().toISOString(),
    ready: !findings.some((finding) => finding.level === "error"),
    screenshots,
    findings,
  };
}

export function formatIntake(report: IntakeReport): string {
  const order = { error: 0, warning: 1, ok: 2 } as const;
  const rows = [...report.findings].sort((left, right) => order[left.level] - order[right.level]);
  const lines = rows.map((finding) => `${finding.level === "ok" ? "OK   " : finding.level === "error" ? "ERROR" : "WARN "} ${finding.area}: ${finding.message}`);
  return [...lines, "", report.ready ? "Intake is usable. Warnings above are what will limit how good the deck can look." : "Intake is not usable yet. Fix the errors before authoring."].join("\n");
}
