import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";

export interface PptxQaReport {
  generatedAt: string;
  file: string;
  bytes: number;
  ok: boolean;
  slideCount: number;
  noteCount: number;
  mediaCount: number;
  editableObjectCount: number;
  issues: Array<{ level: "error" | "warning"; message: string }>;
}

export interface PowerPointShape {
  slide: number;
  name: string;
  left: number;
  top: number;
  width: number;
  height: number;
  hasText: boolean;
  boundWidth: number;
  boundHeight: number;
  text: string;
}

export interface PowerPointRenderReport {
  generatedAt: string;
  powerPointVersion: string;
  slideCount: number;
  slideWidthPt?: number;
  slideHeightPt?: number;
  slides: string[];
  shapes?: PowerPointShape[];
}

// Calibrated against three known-good decks (northstar, product-walkthrough, yubikey):
// text that fits measured 56/59.7, 34.3/39.1 and 11.1/14.9 boundHeight-over-height, the one real
// overflow measured 19.1/12.4, no shape strayed past the slide edge at all, and the worst benign
// overlap between two stacked text boxes was 16.3% of the smaller box.
const OVERFLOW_RATIO = 0.04;
const OVERFLOW_FLOOR_PT = 1;
const OFF_SLIDE_TOLERANCE_PT = 1;
const OVERLAP_RATIO = 0.35;
const WIDTH_OVERRUN_RATIO = 0.05;

function label(shape: PowerPointShape): string {
  const name = shape.name.replace(/^VibePPT · /, "");
  const text = shape.text.trim().replace(/\s+/g, " ").slice(0, 48);
  return text ? `${name} ("${text}")` : name;
}

/**
 * Compare what PowerPoint actually laid out against the boxes the renderer measured in the DOM.
 * This is the only check that sees font substitution, rewrapping and overflow, all of which pass
 * every structural test because the XML is perfectly well formed.
 */
export function evaluatePowerPointGeometry(render: PowerPointRenderReport): PptxQaReport["issues"] {
  const issues: PptxQaReport["issues"] = [];
  const shapes = render.shapes ?? [];
  if (!shapes.length) return issues;
  const slideWidth = render.slideWidthPt ?? 960;
  const slideHeight = render.slideHeightPt ?? 540;

  for (const shape of shapes) {
    const overflow = Math.max(OVERFLOW_FLOOR_PT, shape.height * OVERFLOW_RATIO);
    if (shape.hasText && shape.boundHeight > shape.height + overflow) {
      issues.push({
        level: "error",
        message: `Slide ${shape.slide}: text overflows its box in PowerPoint — ${label(shape)} needs ${shape.boundHeight.toFixed(1)}pt but the box is ${shape.height.toFixed(1)}pt. Shorten the text or give the layout more room.`,
      });
    } else if (shape.hasText && shape.boundWidth > shape.width * (1 + WIDTH_OVERRUN_RATIO)) {
      issues.push({
        level: "warning",
        message: `Slide ${shape.slide}: text is wider than its box — ${label(shape)} measures ${shape.boundWidth.toFixed(1)}pt against ${shape.width.toFixed(1)}pt.`,
      });
    }
    const strayed = Math.max(
      -shape.left,
      -shape.top,
      shape.left + shape.width - slideWidth,
      shape.top + shape.height - slideHeight,
    );
    if (strayed > OFF_SLIDE_TOLERANCE_PT) {
      issues.push({
        level: "error",
        message: `Slide ${shape.slide}: ${label(shape)} extends ${strayed.toFixed(1)}pt past the slide edge.`,
      });
    }
  }

  const bySlide = new Map<number, PowerPointShape[]>();
  for (const shape of shapes) {
    if (!shape.hasText) continue;
    bySlide.set(shape.slide, [...(bySlide.get(shape.slide) ?? []), shape]);
  }
  for (const [slide, group] of bySlide) {
    for (let index = 0; index < group.length; index += 1) {
      for (let other = index + 1; other < group.length; other += 1) {
        const a = group[index]!;
        const b = group[other]!;
        const overlapX = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
        const overlapY = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
        if (overlapX <= 0 || overlapY <= 0) continue;
        const smallest = Math.min(a.width * a.height, b.width * b.height);
        if (smallest <= 0) continue;
        const ratio = (overlapX * overlapY) / smallest;
        if (ratio > OVERLAP_RATIO) {
          issues.push({
            level: "warning",
            message: `Slide ${slide}: ${label(a)} and ${label(b)} overlap by ${Math.round(ratio * 100)}% of the smaller box.`,
          });
        }
      }
    }
  }
  return issues;
}

function numericSlideName(name: string): number {
  return Number(name.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
}

export async function inspectPptx(filePath: string): Promise<PptxQaReport> {
  const absolutePath = path.resolve(filePath);
  const bytes = await readFile(absolutePath);
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files);
  const slideNames = names.filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((a, b) => numericSlideName(a) - numericSlideName(b));
  const noteNames = names.filter((name) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name));
  const mediaNames = names.filter((name) => name.startsWith("ppt/media/") && !zip.files[name]?.dir);
  const issues: PptxQaReport["issues"] = [];
  let editableObjectCount = 0;

  if (!zip.files["[Content_Types].xml"] || !zip.files["ppt/presentation.xml"]) {
    issues.push({ level: "error", message: "The file is missing required OOXML presentation parts." });
  }
  if (slideNames.length === 0) issues.push({ level: "error", message: "No slides were found in the presentation." });
  for (const slideName of slideNames) {
    const xml = await zip.files[slideName]?.async("string");
    if (!xml) {
      issues.push({ level: "error", message: `Cannot read ${slideName}.` });
      continue;
    }
    if (/\b(?:NaN|undefined)\b/.test(xml)) issues.push({ level: "error", message: `${slideName} contains an invalid numeric or text value.` });
    editableObjectCount += (xml.match(/<p:sp>/g) ?? []).length + (xml.match(/<p:graphicFrame>/g) ?? []).length;
    if (!/<p:(?:pic|sp|graphicFrame)>/.test(xml)) issues.push({ level: "warning", message: `${slideName} appears to have no visible objects.` });
  }
  if (mediaNames.length < slideNames.length) issues.push({ level: "warning", message: "There are fewer media assets than slides; confirm every slide has a visual background." });
  if (bytes.byteLength > 150 * 1024 * 1024) issues.push({ level: "warning", message: "Presentation exceeds 150 MB; lower --scale or split the deck into chapters." });

  return {
    generatedAt: new Date().toISOString(),
    file: absolutePath,
    bytes: bytes.byteLength,
    ok: !issues.some((issue) => issue.level === "error"),
    slideCount: slideNames.length,
    noteCount: noteNames.length,
    mediaCount: mediaNames.length,
    editableObjectCount,
    issues,
  };
}

export async function writeQaReport(report: PptxQaReport, outputPath: string): Promise<void> {
  await writeFile(outputPath, JSON.stringify(report, null, 2), "utf8");
}
