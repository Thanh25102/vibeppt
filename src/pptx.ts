import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Browser, type LaunchOptions, type Page } from "playwright";
import pptxgen from "pptxgenjs";
import { renderDeckHtml } from "./html.js";
import { copyAsset, slugify, type LoadedTemplate } from "./model.js";
import {
  flattenSlides,
  type BrandProfile,
  type BrandTheme,
  type DeckSpec,
  type DiagramEdge,
  type NativeBlockMeasurement,
  type NativeTextMeasurement,
  type SlideMeasurement,
  type SlideSpec,
  type ThemeName,
} from "./types.js";

const WIDTH_PX = 1920;
const HEIGHT_PX = 1080;
// The design canvas is 1920x1080 px mapped onto a 13.333x7.5in slide, so one px is 1/144in.
// Point sizes must be derived from PX_PER_INCH: hardcoding the 96dpi 0.75 factor renders every
// native text 1.5x too large, which only shows up as rewrapped, overflowing titles in PowerPoint.
export const PX_PER_INCH = 144;
export const PT_PER_PX = 72 / PX_PER_INCH;
const PPT_WIDTH = WIDTH_PX / PX_PER_INCH;
const PPT_HEIGHT = HEIGHT_PX / PX_PER_INCH;
// pptxgenjs 4's NodeNext declaration exposes its runtime default as a module namespace.
// Keep the workaround at this dependency boundary instead of leaking casts through the renderer.
type PptSlide = any;

interface BrowserDeckApi {
  activate(index: number): number;
  measure(index: number): SlideMeasurement;
  setExportMode(mode?: "pixel" | "background"): void;
  count: number;
}

declare global {
  interface Window {
    __vibePpt: BrowserDeckApi;
  }
}

export interface PreparedPreview {
  htmlPath: string;
  assetMap: Map<string, string>;
}

export interface BuildOptions {
  outDir: string;
  theme: ThemeName;
  scale?: number;
  outputMode?: "hybrid" | "pixel";
  template?: LoadedTemplate;
}

export interface BuildResult {
  pptxPath: string;
  htmlPath: string;
  contactSheetPath: string;
  reportPath: string;
  slideCount: number;
  assetMap: Map<string, string>;
}

function inches(value: number): number {
  return value / PX_PER_INCH;
}

function hex(value: string): string {
  return value.replace(/^#/, "").toUpperCase();
}

function toneColor(tone: string | undefined, theme: BrandTheme): string {
  switch (tone) {
    case "accent": return hex(theme.accent);
    case "blue": return hex(theme.accent2);
    case "green": return hex(theme.good);
    case "amber": return hex(theme.accent3);
    default: return hex(theme.line);
  }
}

export async function preparePreview(
  deck: DeckSpec,
  brand: BrandProfile,
  deckDir: string,
  brandPath: string,
  outDir: string,
  theme: ThemeName,
  template?: LoadedTemplate,
): Promise<PreparedPreview> {
  const previewDir = path.join(outDir, "preview");
  const assetDir = path.join(previewDir, "assets");
  const assetMap = new Map<string, string>();
  await mkdir(assetDir, { recursive: true });

  const logoReferences = new Set([brand.logo, brand.logos?.light, brand.logos?.dark].filter((value): value is string => Boolean(value)));
  for (const reference of logoReferences) {
    assetMap.set(`brand:${reference}`, await copyAsset(path.resolve(path.dirname(brandPath), reference), assetDir));
  }
  for (const { slide } of flattenSlides(deck)) {
    if (slide.visual?.src && !assetMap.has(slide.visual.src)) {
      assetMap.set(slide.visual.src, await copyAsset(path.resolve(deckDir, slide.visual.src), assetDir));
    }
  }

  const htmlPath = path.join(previewDir, "index.html");
  await writeFile(htmlPath, renderDeckHtml(deck, brand, {
    theme,
    assetMap,
    ...(template ? { templateCss: template.css, templateId: template.profile.id } : {}),
  }), "utf8");
  return { htmlPath, assetMap };
}

async function launchBrowser(): Promise<{ browser: Browser; engine: string }> {
  const attempts: Array<{ engine: string; options: LaunchOptions }> = process.platform === "win32"
    ? [
        { engine: "Microsoft Edge", options: { channel: "msedge", headless: true } },
        { engine: "Google Chrome", options: { channel: "chrome", headless: true } },
        { engine: "Playwright Chromium", options: { headless: true } },
      ]
    : [
        { engine: "Google Chrome", options: { channel: "chrome", headless: true, args: ["--no-sandbox"] } },
        { engine: "Playwright Chromium", options: { headless: true, args: ["--no-sandbox"] } },
      ];
  const failures: string[] = [];
  for (const attempt of attempts) {
    try {
      return { browser: await chromium.launch(attempt.options), engine: attempt.engine };
    } catch (error) {
      failures.push(`${attempt.engine}: ${(error as Error).message.split("\n")[0]}`);
    }
  }
  throw new Error(`No supported Chromium browser could start. Install Microsoft Edge or run npx playwright install chromium.\n${failures.join("\n")}`);
}

async function waitForDeck(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean(window.__vibePpt?.count));
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function createContactSheet(slidePaths: string[], outputPath: string, page: Page): Promise<void> {
  const cards = slidePaths.map((slidePath, index) => `<figure><img src="${pathToFileURL(slidePath).href}"><figcaption>${String(index + 1).padStart(2, "0")}</figcaption></figure>`).join("");
  const html = `<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;padding:30px;background:#0a0a0d;color:#fff;font:700 18px/1 Segoe UI,Arial,sans-serif}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:18px}figure{margin:0;padding:8px;border:1px solid #292a31;border-radius:12px;background:#15161b}img{display:block;width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:7px}figcaption{padding:9px 3px 2px;color:#a9a9b2}</style><div class="grid">${cards}</div>`;
  const contactHtml = path.join(path.dirname(outputPath), "contact-sheet.html");
  await writeFile(contactHtml, html, "utf8");
  await page.setViewportSize({ width: 1600, height: Math.max(360, 60 + Math.ceil(slidePaths.length / 4) * 290) });
  await page.goto(pathToFileURL(contactHtml).href);
  await page.waitForFunction(() => [...document.images].every((item) => item.complete));
  await page.screenshot({ path: outputPath, fullPage: true, animations: "disabled" });
}

function normalizeMeasurement(measurement: SlideMeasurement, scale: number): SlideMeasurement {
  const normalizeBox = <T extends { x: number; y: number; w: number; h: number }>(value: T): T => ({
    ...value,
    x: value.x / scale,
    y: value.y / scale,
    w: value.w / scale,
    h: value.h / scale,
  });
  return {
    ...measurement,
    texts: measurement.texts.map(normalizeBox),
    blocks: measurement.blocks.map((block) => ({
      ...normalizeBox(block),
      ...(block.nodes ? { nodes: block.nodes.map(normalizeBox) } : {}),
    })),
  };
}

async function captureDeck(
  htmlPath: string,
  outDir: string,
  slideCount: number,
  scale: number,
): Promise<{ measurements: SlideMeasurement[]; full: string[]; backgrounds: string[]; contactSheetPath: string; engine: string }> {
  const fullDir = path.join(outDir, "slides");
  const backgroundDir = path.join(outDir, "backgrounds");
  await Promise.all([mkdir(fullDir, { recursive: true }), mkdir(backgroundDir, { recursive: true })]);
  const { browser, engine } = await launchBrowser();
  const full: string[] = [];
  const backgrounds: string[] = [];
  const measurements: SlideMeasurement[] = [];
  try {
    const context = await browser.newContext({ viewport: { width: Math.round(WIDTH_PX * scale), height: Math.round(HEIGHT_PX * scale) }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.goto(pathToFileURL(htmlPath).href);
    await waitForDeck(page);
    for (let index = 0; index < slideCount; index += 1) {
      await page.evaluate((slideIndex) => window.__vibePpt.activate(slideIndex), index);
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const measurement = await page.evaluate((slideIndex) => window.__vibePpt.measure(slideIndex), index);
      measurements.push(normalizeMeasurement(measurement, scale));

      const number = String(index + 1).padStart(3, "0");
      const fullPath = path.join(fullDir, `slide-${number}.png`);
      const backgroundPath = path.join(backgroundDir, `slide-${number}.png`);
      await page.evaluate(() => window.__vibePpt.setExportMode("pixel"));
      await page.screenshot({ path: fullPath, animations: "disabled" });
      await page.evaluate(() => window.__vibePpt.setExportMode("background"));
      await page.screenshot({ path: backgroundPath, animations: "disabled" });
      await page.evaluate(() => window.__vibePpt.setExportMode());
      full.push(fullPath);
      backgrounds.push(backgroundPath);
    }
    const contactSheetPath = path.join(outDir, "contact-sheet.png");
    await createContactSheet(full, contactSheetPath, page);
    await context.close();
    return { measurements, full, backgrounds, contactSheetPath, engine };
  } finally {
    await browser.close();
  }
}

function addNativeText(slide: PptSlide, item: NativeTextMeasurement): void {
  if (!item.text.trim() || item.w < 2 || item.h < 2) return;
  // A two-tone title arrives as runs so each keeps its own colour and weight in PowerPoint.
  const body = item.runs?.length
    ? item.runs.map((run) => ({ text: run.text, options: { color: hex(run.color), bold: run.bold } }))
    : item.text;
  slide.addText(body, {
    x: inches(item.x),
    y: Math.max(0, inches(item.y) - 0.01),
    w: inches(item.w),
    h: inches(item.h) + 0.04,
    fontFace: item.fontFamily,
    fontSize: Math.max(6, item.fontSizePx * PT_PER_PX),
    bold: item.fontWeight >= 600,
    color: hex(item.color),
    align: item.align,
    valign: item.valign,
    margin: 0,
    breakLine: false,
    fit: "shrink",
    lineSpacing: Math.max(6, item.lineHeightPx * PT_PER_PX),
    charSpacing: item.letterSpacingPx * PT_PER_PX,
    objectName: `VibePPT · ${item.id}`,
  });
}

function defaultEdges(slide: SlideSpec): DiagramEdge[] {
  const ids = slide.diagram?.nodes.map((node) => node.id) ?? (slide.items ?? []).map((_, index) => `step-${index + 1}`);
  return ids.slice(1).map((id, index) => ({ from: ids[index] ?? "", to: id }));
}

function addNativeDiagram(slide: PptSlide, source: SlideSpec, block: NativeBlockMeasurement, theme: BrandTheme, brand: BrandProfile): void {
  const nodes = block.nodes ?? [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const edges = source.diagram?.edges ?? defaultEdges(source);
  for (const edge of edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) continue;
    const x1 = inches(from.x + from.w / 2);
    const y1 = inches(from.y + from.h / 2);
    const x2 = inches(to.x + to.w / 2);
    const y2 = inches(to.y + to.h / 2);
    const forward = x2 > x1 || (x2 === x1 && y2 >= y1);
    const inverted = (x2 - x1) * (y2 - y1) < 0;
    slide.addShape(inverted ? "lineInv" : "line", {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      w: Math.abs(x2 - x1),
      h: Math.abs(y2 - y1),
      line: { color: hex(theme.line), width: 1.5, ...(forward ? { endArrowType: "triangle" } : { beginArrowType: "triangle" }) },
      objectName: `VibePPT · edge ${edge.from} to ${edge.to}`,
    });
  }

  nodes.forEach((node, index) => {
    const x = inches(node.x);
    const y = inches(node.y);
    const w = inches(node.w);
    const h = inches(node.h);
    const tone = toneColor(node.tone, theme);
    slide.addShape(node.shape === "circle" ? "ellipse" : "roundRect", {
      x, y, w, h,
      fill: { color: hex(theme.panel) },
      line: { color: tone, width: 1.25, transparency: 20 },
      objectName: `VibePPT · ${node.id}`,
    });
    slide.addText(String(index + 1).padStart(2, "0"), {
      x: x + 0.14, y: y + 0.13, w: w - 0.28, h: 0.22,
      fontFace: brand.fonts.body, fontSize: 8, bold: true, color: tone, align: "center", margin: 0,
    });
    slide.addText(node.label, {
      x: x + 0.14, y: y + h * 0.34, w: w - 0.28, h: Math.max(0.26, h * 0.27),
      fontFace: brand.fonts.display, fontSize: 14, bold: true, color: hex(theme.ink), align: "center", valign: "middle", margin: 0, fit: "shrink",
    });
    if (node.detail) {
      slide.addText(node.detail, {
        x: x + 0.14, y: y + h * 0.65, w: w - 0.28, h: Math.max(0.2, h * 0.2),
        fontFace: brand.fonts.body, fontSize: 8.5, color: hex(theme.muted), align: "center", valign: "top", margin: 0, fit: "shrink",
      });
    }
  });
}

function addNativeChart(slide: PptSlide, source: SlideSpec, block: NativeBlockMeasurement, theme: BrandTheme, brand: BrandProfile): void {
  if (!source.chart) return;
  const chart = source.chart;
  const chartType = chart.type === "donut" ? "doughnut" : chart.type === "line" ? "line" : "bar";
  const data = chart.series.map((series) => ({ name: series.name, labels: chart.categories, values: series.values }));
  const options: any = {
    x: inches(block.x), y: inches(block.y), w: inches(block.w), h: inches(block.h),
    fontFace: brand.fonts.body,
    chartColors: [hex(theme.accent), hex(theme.accent2), hex(theme.accent3), hex(theme.good)],
    color: hex(theme.ink),
    showLegend: chart.series.length > 1 || chart.type === "donut",
    legendPos: "b",
    legendColor: hex(theme.muted),
    legendFontFace: brand.fonts.body,
    legendFontSize: 9,
    showTitle: false,
    showValue: chart.type === "donut",
    dataLabelColor: hex(theme.ink),
    dataLabelPosition: chart.type === "donut" ? "bestFit" : "outEnd",
    catAxisLabelColor: hex(theme.muted),
    catAxisLabelFontFace: brand.fonts.body,
    catAxisLabelFontSize: 9,
    catAxisLineColor: hex(theme.line),
    valAxisLabelColor: hex(theme.muted),
    valAxisLabelFontFace: brand.fonts.body,
    valAxisLabelFontSize: 8,
    valAxisLineColor: hex(theme.line),
    valGridLine: { color: hex(theme.line), size: 0.5, style: "solid" },
    chartArea: { fill: { color: hex(theme.panel) }, border: { color: hex(theme.line), pt: 0.7 }, roundedCorners: true },
    plotArea: { fill: { color: hex(theme.panel) }, border: { color: hex(theme.panel), pt: 0 } },
    showCatName: chart.type === "donut",
    holeSize: 64,
    lineSize: 3,
    ...(chart.type === "bar" ? { barDir: "bar" } : {}),
    ...(chart.type === "column" ? { barDir: "col" } : {}),
  };
  slide.addChart(chartType, data, options);
}

function addNativeTable(slide: PptSlide, source: SlideSpec, block: NativeBlockMeasurement, theme: BrandTheme, brand: BrandProfile): void {
  if (!source.table) return;
  const rows: any[] = [
    source.table.headers.map((header) => ({ text: header, options: { bold: true, color: hex(theme.accent), fill: { color: hex(theme.panelSoft) } } })),
    ...source.table.rows.map((row) => row.map((cell) => ({ text: String(cell), options: { color: hex(theme.ink), fill: { color: hex(theme.panel) } } }))),
  ];
  const rowCount = Math.max(1, rows.length);
  slide.addTable(rows, {
    x: inches(block.x), y: inches(block.y), w: inches(block.w), h: inches(block.h),
    rowH: inches(block.h) / rowCount,
    border: { type: "solid", color: hex(theme.line), pt: 0.7 },
    fontFace: brand.fonts.body,
    fontSize: source.table.headers.length > 6 ? 10 : 12,
    color: hex(theme.ink),
    fill: { color: hex(theme.panel) },
    margin: 7,
    valign: "middle",
    autoPage: false,
    objectName: `VibePPT · ${source.id}-table`,
  });
}

function addNativeBlock(slide: PptSlide, source: SlideSpec, block: NativeBlockMeasurement, theme: BrandTheme, brand: BrandProfile): void {
  if (block.kind === "diagram") addNativeDiagram(slide, source, block, theme, brand);
  if (block.kind === "chart") addNativeChart(slide, source, block, theme, brand);
  if (block.kind === "table") addNativeTable(slide, source, block, theme, brand);
}

async function writePowerPoint(
  deck: DeckSpec,
  brand: BrandProfile,
  themeName: ThemeName,
  outputMode: "hybrid" | "pixel",
  full: string[],
  backgrounds: string[],
  measurements: SlideMeasurement[],
  outputPath: string,
): Promise<void> {
  const PptxConstructor = pptxgen as unknown as new () => any;
  const pptx = new PptxConstructor();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = deck.meta.author ?? "VibePPT";
  pptx.company = deck.meta.company ?? "";
  pptx.subject = deck.meta.purpose ?? deck.meta.audience ?? "";
  pptx.title = deck.meta.title;
  pptx.lang = deck.meta.language ?? "en-US";
  pptx.theme = { headFontFace: brand.fonts.display, bodyFontFace: brand.fonts.body };
  pptx.revision = "1";
  const theme = brand.themes[themeName];
  const flat = flattenSlides(deck);
  const addedSections = new Set<string>();

  flat.forEach((entry, index) => {
    if (!addedSections.has(entry.sectionTitle)) {
      pptx.addSection({ title: entry.sectionTitle });
      addedSections.add(entry.sectionTitle);
    }
    const slide = pptx.addSlide({ sectionTitle: entry.sectionTitle });
    const usePixel = outputMode === "pixel";
    slide.addImage({
      path: usePixel ? full[index] : backgrounds[index],
      x: 0, y: 0, w: PPT_WIDTH, h: PPT_HEIGHT,
      altText: `Visual background for ${entry.slide.title}`,
      objectName: "VibePPT · visual layer",
    });
    if (!usePixel) {
      const measurement = measurements[index];
      measurement?.blocks.forEach((block) => addNativeBlock(slide, entry.slide, block, theme, brand));
      measurement?.texts.forEach((text) => addNativeText(slide, text));
    }
    const notes = [entry.slide.notes, entry.slide.sourceRefs?.length ? `Sources:\n${entry.slide.sourceRefs.join("\n")}` : undefined].filter(Boolean).join("\n\n");
    if (notes) slide.addNotes(notes);
  });
  await pptx.writeFile({ fileName: outputPath, compression: true });
}

export async function buildDeck(
  deck: DeckSpec,
  brand: BrandProfile,
  deckDir: string,
  brandPath: string,
  options: BuildOptions,
): Promise<BuildResult> {
  const slideCount = flattenSlides(deck).length;
  const scale = Math.max(1, Math.min(3, options.scale ?? 2));
  const outputMode = options.outputMode ?? deck.outputMode ?? "hybrid";
  await mkdir(options.outDir, { recursive: true });
  const { htmlPath, assetMap } = await preparePreview(deck, brand, deckDir, brandPath, options.outDir, options.theme, options.template);
  const capture = await captureDeck(htmlPath, options.outDir, slideCount, scale);
  const pptxPath = path.join(options.outDir, `${slugify(deck.meta.title)}.pptx`);
  await writePowerPoint(deck, brand, options.theme, outputMode, capture.full, capture.backgrounds, capture.measurements, pptxPath);

  const reportPath = path.join(options.outDir, "qa.json");
  const nativeTexts = capture.measurements.reduce((sum, item) => sum + item.texts.length, 0);
  const nativeBlocks = capture.measurements.reduce((sum, item) => sum + item.blocks.length, 0);
  await writeFile(reportPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    deck: deck.meta.title,
    slideCount,
    outputMode,
    theme: options.theme,
    template: options.template?.profile.id ?? "classic",
    screenshotScale: scale,
    browser: capture.engine,
    nativeTexts: outputMode === "hybrid" ? nativeTexts : 0,
    nativeBlocks: outputMode === "hybrid" ? nativeBlocks : 0,
    artifacts: {
      pptx: path.basename(pptxPath),
      preview: path.relative(options.outDir, htmlPath),
      contactSheet: path.basename(capture.contactSheetPath),
    },
  }, null, 2), "utf8");
  return { pptxPath, htmlPath, contactSheetPath: capture.contactSheetPath, reportPath, slideCount, assetMap };
}
