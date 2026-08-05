import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  SLIDE_KINDS,
  type BrandProfile,
  type DeckSpec,
  type LintIssue,
  type SlideSpec,
  type TemplateProfile,
} from "./types.js";

export interface LoadedTemplate {
  profile: TemplateProfile;
  profilePath: string;
  cssPath: string;
  css: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHex(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function isSlug(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]*$/.test(value);
}

function isLocalReference(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim()) && !/^(?:https?:)?\/\//i.test(value);
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function readJson<T>(filePath: string): Promise<T> {
  const content = await readFile(filePath, "utf8");
  try {
    return JSON.parse(content) as T;
  } catch (error) {
    throw new Error(`Invalid JSON in ${filePath}: ${(error as Error).message}`);
  }
}

export async function loadProject(deckPath: string, brandOverride?: string) {
  const absoluteDeckPath = path.resolve(deckPath);
  const deckDir = path.dirname(absoluteDeckPath);
  const deck = await readJson<DeckSpec>(absoluteDeckPath);
  const deckIssues = validateDeck(deck);
  const brandReference = brandOverride ?? (typeof deck.brandProfile === "string" ? deck.brandProfile : "");
  if (!brandReference) throw new Error(formatIssues(deckIssues));
  const brandPath = path.resolve(deckDir, brandReference);
  const brand = await readJson<BrandProfile>(brandPath);
  const brandIssues = validateBrand(brand);
  const fileIssues: LintIssue[] = [];
  let template: LoadedTemplate | undefined;
  if (deck.templateProfile) {
    const profilePath = path.resolve(deckDir, deck.templateProfile);
    if (!isInside(deckDir, profilePath)) throw new Error("Template profile must stay inside the presentation project.");
    const profile = await readJson<TemplateProfile>(profilePath);
    fileIssues.push(...validateTemplate(profile));
    const templateDir = path.dirname(profilePath);
    for (const reference of [profile.brandProfile, profile.sampleDeck, profile.recipe, profile.preview?.dark, profile.preview?.light]) {
      if (!isLocalReference(reference)) continue;
      const resolved = path.resolve(templateDir, reference);
      if (!isInside(templateDir, resolved) || !(await stat(resolved).catch(() => null))?.isFile()) {
        fileIssues.push({ level: "error", path: "template", message: `Asset not found or outside template directory: ${reference}` });
      }
    }
    const cssPath = path.resolve(templateDir, profile.stylesheet ?? "");
    if (!isInside(templateDir, cssPath)) {
      fileIssues.push({ level: "error", path: "template.stylesheet", message: "Stylesheet must stay inside the template directory." });
    } else {
      const css = await readFile(cssPath, "utf8").catch(() => "");
      if (!css) fileIssues.push({ level: "error", path: "template.stylesheet", message: `Asset not found: ${profile.stylesheet}` });
      else if (/<\/style\b|@import\b|url\s*\(\s*["']?(?:https?:|\/\/)/i.test(css)) {
        fileIssues.push({ level: "error", path: "template.stylesheet", message: "Style tags, remote imports, and remote URLs are not allowed." });
      } else {
        template = { profile, profilePath, cssPath, css };
      }
    }
  }
  const brandLogos = [
    isObject(brand) && typeof brand.logo === "string" ? { pathName: "brand.logo", value: brand.logo } : undefined,
    isObject(brand) && isObject(brand.logos) && typeof brand.logos.light === "string" ? { pathName: "brand.logos.light", value: brand.logos.light } : undefined,
    isObject(brand) && isObject(brand.logos) && typeof brand.logos.dark === "string" ? { pathName: "brand.logos.dark", value: brand.logos.dark } : undefined,
  ].filter((item): item is { pathName: string; value: string } => Boolean(item));
  for (const item of brandLogos) {
    const brandDirectory = path.dirname(brandPath);
    const target = path.resolve(brandDirectory, item.value);
    if (!isInside(brandDirectory, target) || !(await stat(target).catch(() => null))?.isFile()) {
      fileIssues.push({ level: "error", path: item.pathName, message: `Asset not found or outside brand directory: ${item.value}` });
    }
  }
  for (const [sectionIndex, section] of (Array.isArray(deck.sections) ? deck.sections : []).entries()) {
    if (!isObject(section) || !Array.isArray(section.slides)) continue;
    for (const [slideIndex, slide] of section.slides.entries()) {
      if (!isObject(slide)) continue;
      if (template && typeof slide.layout === "string") {
        const declared = template.profile.layouts?.find((layout) => layout.id === slide.layout);
        if (!declared) fileIssues.push({ level: "error", path: `sections[${sectionIndex}].slides[${slideIndex}].layout`, message: `Layout is not declared by template: ${slide.layout}` });
        else if (declared.kind !== slide.kind) fileIssues.push({ level: "error", path: `sections[${sectionIndex}].slides[${slideIndex}].layout`, message: `Layout ${slide.layout} requires slide kind ${declared.kind}.` });
      }
      if (!isObject(slide.visual) || typeof slide.visual.src !== "string") continue;
      if (!/^https?:\/\//i.test(slide.visual.src) && !(await stat(path.resolve(deckDir, slide.visual.src)).catch(() => null))?.isFile()) {
        fileIssues.push({ level: "error", path: `sections[${sectionIndex}].slides[${slideIndex}].visual.src`, message: `Asset not found: ${slide.visual.src}` });
      }
    }
  }
  const issues = [...deckIssues, ...brandIssues, ...fileIssues];
  return { absoluteDeckPath, deckDir, deck, brandPath, brand, template, issues };
}

export function validateDeck(value: unknown): LintIssue[] {
  const issues: LintIssue[] = [];
  const error = (pathName: string, message: string) =>
    issues.push({ level: "error", path: pathName, message });
  const warning = (pathName: string, message: string) =>
    issues.push({ level: "warning", path: pathName, message });

  if (!isObject(value)) {
    return [{ level: "error", path: "$", message: "Deck must be a JSON object." }];
  }
  if (value.version !== 1) error("version", "Only DeckSpec version 1 is supported.");
  if (!isObject(value.meta) || typeof value.meta.title !== "string" || !value.meta.title.trim()) {
    error("meta.title", "A non-empty deck title is required.");
  }
  if (typeof value.brandProfile !== "string" || !value.brandProfile.trim()) {
    error("brandProfile", "A brand profile path is required.");
  }
  if (value.templateProfile !== undefined && !isLocalReference(value.templateProfile)) {
    error("templateProfile", "Template profile must be a local file path.");
  }
  if (value.theme !== undefined && value.theme !== "dark" && value.theme !== "light") error("theme", "Theme must be dark or light.");
  if (value.outputMode !== undefined && value.outputMode !== "hybrid" && value.outputMode !== "pixel") error("outputMode", "Output mode must be hybrid or pixel.");
  if (!Array.isArray(value.sections) || value.sections.length === 0) {
    error("sections", "At least one section is required.");
    return issues;
  }

  const ids = new Set<string>();
  let slideCount = 0;
  value.sections.forEach((section, sectionIndex) => {
    const sectionPath = `sections[${sectionIndex}]`;
    if (!isObject(section)) {
      error(sectionPath, "Section must be an object.");
      return;
    }
    if (typeof section.id !== "string" || !section.id.trim()) error(`${sectionPath}.id`, "Section id is required.");
    if (typeof section.title !== "string" || !section.title.trim()) error(`${sectionPath}.title`, "Section title is required.");
    if (section.timeBudget !== undefined && (typeof section.timeBudget !== "string" || section.timeBudget.length > 24)) error(`${sectionPath}.timeBudget`, "Time budget must be a short text label.");
    if (!Array.isArray(section.slides) || section.slides.length === 0) {
      error(`${sectionPath}.slides`, "Section must contain at least one slide.");
      return;
    }
    section.slides.forEach((rawSlide, slideIndex) => {
      slideCount += 1;
      const slidePath = `${sectionPath}.slides[${slideIndex}]`;
      if (!isObject(rawSlide)) {
        error(slidePath, "Slide must be an object.");
        return;
      }
      const slide = rawSlide as unknown as SlideSpec;
      if (typeof slide.id !== "string" || !slide.id.trim()) error(`${slidePath}.id`, "Slide id is required.");
      else if (ids.has(slide.id)) error(`${slidePath}.id`, `Duplicate slide id: ${slide.id}`);
      else ids.add(slide.id);
      if (!SLIDE_KINDS.includes(slide.kind)) error(`${slidePath}.kind`, `Unsupported slide kind: ${String(slide.kind)}`);
      if (slide.layout !== undefined && !isSlug(slide.layout)) error(`${slidePath}.layout`, "Layout must be a lowercase slug containing letters, numbers, and hyphens.");
      if (slide.renderMode !== undefined && !["auto", "native", "flatten"].includes(slide.renderMode)) error(`${slidePath}.renderMode`, "Render mode must be auto, native, or flatten.");
      if (typeof slide.title !== "string" || !slide.title.trim()) error(`${slidePath}.title`, "Slide title is required.");
      else if (slide.title.length > 96) warning(`${slidePath}.title`, "Title is longer than 96 characters; split or shorten it.");
      if (slide.body !== undefined && typeof slide.body !== "string") error(`${slidePath}.body`, "Body must be text.");
      else if (slide.body && slide.body.length > 520) warning(`${slidePath}.body`, "Body is longer than 520 characters; move detail to notes or another slide.");
      if (slide.tags !== undefined && (!Array.isArray(slide.tags) || slide.tags.some((tag) => typeof tag !== "string"))) error(`${slidePath}.tags`, "Tags must be an array of text values.");
      if (slide.items !== undefined) {
        if (!Array.isArray(slide.items)) error(`${slidePath}.items`, "Items must be an array.");
        else {
          if (slide.items.length > 8) warning(`${slidePath}.items`, "More than eight items usually needs pagination.");
          slide.items.forEach((item, itemIndex) => {
            if (!isObject(item) || typeof item.title !== "string" || !item.title.trim()) error(`${slidePath}.items[${itemIndex}].title`, "Item title is required.");
          });
        }
      }
      if (slide.visual !== undefined) {
        if (!isObject(slide.visual) || typeof slide.visual.src !== "string" || typeof slide.visual.alt !== "string") error(`${slidePath}.visual`, "Visual requires local src and alt text.");
        else {
          if (/^https?:\/\//i.test(slide.visual.src)) error(`${slidePath}.visual.src`, "Remote URLs are not allowed; download the asset into the project first.");
          if (slide.visual.fit !== undefined && slide.visual.fit !== "cover" && slide.visual.fit !== "contain") error(`${slidePath}.visual.fit`, "Visual fit must be cover or contain.");
          if (slide.visual.position !== undefined && (typeof slide.visual.position !== "string" || !/^(?:(?:left|center|right|top|bottom)|(?:\d{1,3}(?:\.\d+)?%))(?:\s+(?:(?:left|center|right|top|bottom)|(?:\d{1,3}(?:\.\d+)?%)))?$/.test(slide.visual.position))) error(`${slidePath}.visual.position`, "Visual position must use keywords or percentages.");
          if (slide.visual.callouts !== undefined) {
            if (!Array.isArray(slide.visual.callouts)) error(`${slidePath}.visual.callouts`, "Callouts must be an array.");
            else {
              if (slide.visual.callouts.length > 6) warning(`${slidePath}.visual.callouts`, "More than six callouts crowd the visual.");
              slide.visual.callouts.forEach((callout, calloutIndex) => {
                const calloutPath = `${slidePath}.visual.callouts[${calloutIndex}]`;
                if (!isObject(callout) || typeof callout.title !== "string" || !callout.title.trim()) error(`${calloutPath}.title`, "Callout title is required.");
                for (const axis of ["x", "y"] as const) {
                  const value = isObject(callout) ? callout[axis] : undefined;
                  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) error(`${calloutPath}.${axis}`, "Callout x and y must be percentages from 0 to 100.");
                }
              });
            }
          }
        }
      }
      if (slide.titleAccent !== undefined) {
        if (typeof slide.titleAccent !== "string" || !slide.titleAccent.trim()) error(`${slidePath}.titleAccent`, "Title accent must be text.");
        else if (typeof slide.title === "string" && !slide.title.includes(slide.titleAccent)) error(`${slidePath}.titleAccent`, `Title accent must be a substring of the title: ${slide.titleAccent}`);
      }
      if (slide.chart !== undefined) {
        if (!isObject(slide.chart)) error(`${slidePath}.chart`, "Chart must be an object.");
        else {
          if (!["bar", "column", "line", "donut"].includes(String(slide.chart.type))) error(`${slidePath}.chart.type`, "Chart type must be bar, column, line, or donut.");
          const categories = slide.chart.categories;
          const series = slide.chart.series;
          if (!Array.isArray(categories) || categories.some((category) => typeof category !== "string")) error(`${slidePath}.chart.categories`, "Chart categories must be an array of text values.");
          else {
            if (categories.length === 0) error(`${slidePath}.chart.categories`, "Chart categories cannot be empty.");
            if (categories.length > 12) warning(`${slidePath}.chart.categories`, "More than 12 categories will be difficult to read.");
          }
          if (!Array.isArray(series)) error(`${slidePath}.chart.series`, "Chart series must be an array.");
          else series.forEach((rawSeries, seriesIndex) => {
            if (!isObject(rawSeries) || typeof rawSeries.name !== "string" || !Array.isArray(rawSeries.values) || rawSeries.values.some((item) => typeof item !== "number" || !Number.isFinite(item))) {
              error(`${slidePath}.chart.series[${seriesIndex}]`, "Each series needs a name and finite numeric values.");
            } else if (Array.isArray(categories) && rawSeries.values.length !== categories.length) {
              error(`${slidePath}.chart.series[${seriesIndex}]`, "Series values must match category count.");
            }
          });
        }
      }
      if (slide.table !== undefined) {
        if (!isObject(slide.table) || !Array.isArray(slide.table.headers) || !Array.isArray(slide.table.rows)) error(`${slidePath}.table`, "Table requires headers and rows arrays.");
        else {
          if (slide.table.headers.length > 8) warning(`${slidePath}.table.headers`, "More than eight columns should be split across slides.");
          slide.table.rows.forEach((row, rowIndex) => {
            if (!Array.isArray(row) || row.length !== slide.table?.headers.length) error(`${slidePath}.table.rows[${rowIndex}]`, "Row width must match header width.");
          });
        }
      }
      if (slide.diagram !== undefined) {
        if (!isObject(slide.diagram) || !Array.isArray(slide.diagram.nodes)) error(`${slidePath}.diagram`, "Diagram requires a nodes array.");
        else {
          const nodeIds = new Set<string>();
          slide.diagram.nodes.forEach((node, nodeIndex) => {
            if (!isObject(node) || typeof node.id !== "string" || typeof node.label !== "string") error(`${slidePath}.diagram.nodes[${nodeIndex}]`, "Diagram nodes require id and label text.");
            else if (nodeIds.has(node.id)) error(`${slidePath}.diagram.nodes[${nodeIndex}].id`, `Duplicate diagram node id: ${node.id}`);
            else nodeIds.add(node.id);
          });
          if (slide.diagram.nodes.length > 20) warning(`${slidePath}.diagram.nodes`, "Dense diagrams should use renderMode=flatten or be split.");
          if (slide.diagram.edges !== undefined) {
            if (!Array.isArray(slide.diagram.edges)) error(`${slidePath}.diagram.edges`, "Diagram edges must be an array.");
            else slide.diagram.edges.forEach((edge, edgeIndex) => {
              if (!isObject(edge) || typeof edge.from !== "string" || typeof edge.to !== "string" || !nodeIds.has(edge.from) || !nodeIds.has(edge.to)) error(`${slidePath}.diagram.edges[${edgeIndex}]`, "Diagram edge references an unknown node.");
            });
          }
        }
      }
    });
  });
  if (slideCount > 40) warning("sections", "Large deck detected; build and review it section by section before the final merge.");
  return issues;
}

export function validateBrand(value: unknown): LintIssue[] {
  const issues: LintIssue[] = [];
  const error = (pathName: string, message: string) => issues.push({ level: "error" as const, path: `brand.${pathName}`, message });
  if (!isObject(value)) return [{ level: "error", path: "brand", message: "Brand profile must be a JSON object." }];
  if (value.version !== 1) error("version", "Only BrandProfile version 1 is supported.");
  if (typeof value.id !== "string" || !value.id.trim()) error("id", "Brand id is required.");
  if (typeof value.name !== "string" || !value.name.trim()) error("name", "Brand name is required.");
  if (value.logo !== undefined && typeof value.logo !== "string") error("logo", "Logo must be a local file path.");
  if (value.logos !== undefined) {
    if (!isObject(value.logos)) error("logos", "Theme logos must be an object.");
    else for (const themeName of ["dark", "light"] as const) {
      if (value.logos[themeName] !== undefined && !isLocalReference(value.logos[themeName])) error(`logos.${themeName}`, "Theme logo must be a local file path.");
    }
  }
  if (!isObject(value.fonts) || typeof value.fonts.display !== "string" || typeof value.fonts.body !== "string") error("fonts", "Display and body fonts are required.");
  if (!isObject(value.themes)) {
    error("themes", "Both light and dark themes are required.");
    return issues;
  }
  for (const themeName of ["dark", "light"] as const) {
    const theme = value.themes[themeName];
    if (!isObject(theme)) {
      error(`themes.${themeName}`, `${themeName} theme is required.`);
      continue;
    }
    for (const key of ["bg", "bgDeep", "panel", "panelSoft", "ink", "muted", "line", "accent", "accent2", "accent3", "good", "warn"]) {
      if (!isHex(theme[key])) error(`themes.${themeName}.${key}`, "Expected a six-digit hex color such as #112233.");
    }
  }
  return issues;
}

export function validateTemplate(value: unknown): LintIssue[] {
  const issues: LintIssue[] = [];
  const error = (pathName: string, message: string) => issues.push({ level: "error" as const, path: `template.${pathName}`, message });
  if (!isObject(value)) return [{ level: "error", path: "template", message: "Template profile must be a JSON object." }];
  if (value.version !== 1) error("version", "Only TemplateProfile version 1 is supported.");
  for (const field of ["id", "name", "summary"] as const) {
    if (typeof value[field] !== "string" || !value[field].trim()) error(field, `${field} is required.`);
  }
  for (const field of ["categories", "moods"] as const) {
    if (!Array.isArray(value[field]) || value[field].length === 0 || value[field].some((item) => typeof item !== "string" || !item.trim())) {
      error(field, `${field} must contain text values.`);
    }
  }
  if (value.defaultTheme !== "dark" && value.defaultTheme !== "light") error("defaultTheme", "Default theme must be dark or light.");
  for (const field of ["stylesheet", "brandProfile", "sampleDeck", "recipe"] as const) {
    if (!isLocalReference(value[field])) error(field, `${field} must be a local file path.`);
  }
  if (!isObject(value.preview) || !isLocalReference(value.preview.dark) || !isLocalReference(value.preview.light)) {
    error("preview", "Both local dark and light preview paths are required.");
  }
  if (!Array.isArray(value.storyRecipe) || value.storyRecipe.length === 0) {
    error("storyRecipe", "At least one story step is required.");
  } else {
    value.storyRecipe.forEach((step, index) => {
      if (!isObject(step) || typeof step.intent !== "string" || typeof step.purpose !== "string" || !SLIDE_KINDS.includes(step.kind as SlideSpec["kind"])) {
        error(`storyRecipe[${index}]`, "Each story step needs intent, purpose, and a supported slide kind.");
      }
    });
  }
  if (value.layouts !== undefined) {
    if (!Array.isArray(value.layouts)) error("layouts", "Layouts must be an array.");
    else {
      const ids = new Set<string>();
      value.layouts.forEach((layout, index) => {
        if (!isObject(layout)) {
          error(`layouts[${index}]`, "Layout must be an object.");
          return;
        }
        if (!isSlug(layout.id)) error(`layouts[${index}].id`, "Layout id must be a lowercase slug.");
        else if (ids.has(layout.id)) error(`layouts[${index}].id`, `Duplicate layout id: ${layout.id}`);
        else ids.add(layout.id);
        if (typeof layout.name !== "string" || !layout.name.trim()) error(`layouts[${index}].name`, "Layout name is required.");
        if (!SLIDE_KINDS.includes(layout.kind as SlideSpec["kind"])) error(`layouts[${index}].kind`, "Layout kind is not supported.");
        if (typeof layout.purpose !== "string" || !layout.purpose.trim()) error(`layouts[${index}].purpose`, "Layout purpose is required.");
      });
    }
  }
  return issues;
}

export function formatIssues(issues: LintIssue[]): string {
  if (issues.length === 0) return "No issues.";
  return issues.map((issue) => `${issue.level === "error" ? "ERROR" : "WARN "} ${issue.path}: ${issue.message}`).join("\n");
}

export function hasErrors(issues: LintIssue[]): boolean {
  return issues.some((issue) => issue.level === "error");
}

export function slugify(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || "deck";
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export async function copyAsset(source: string, assetDir: string): Promise<string> {
  const absoluteSource = path.resolve(source);
  const info = await stat(absoluteSource).catch(() => null);
  if (!info?.isFile()) throw new Error(`Asset not found: ${absoluteSource}`);
  const extension = path.extname(absoluteSource).toLowerCase() || ".bin";
  const digest = createHash("sha256").update(await readFile(absoluteSource)).digest("hex").slice(0, 10);
  const filename = `${slugify(path.basename(absoluteSource, extension))}-${digest}${extension}`;
  await mkdir(assetDir, { recursive: true });
  await copyFile(absoluteSource, path.join(assetDir, filename));
  return `assets/${filename}`;
}
