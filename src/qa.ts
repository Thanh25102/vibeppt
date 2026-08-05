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
