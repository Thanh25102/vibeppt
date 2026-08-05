export const SLIDE_KINDS = [
  "hero",
  "statement",
  "section",
  "feature",
  "screenshot",
  "card-grid",
  "process",
  "timeline",
  "comparison",
  "matrix",
  "architecture",
  "metrics",
  "chart",
  "table",
  "use-case",
  "case-study",
  "closing",
] as const;

export type SlideKind = (typeof SLIDE_KINDS)[number];
export type ThemeName = "dark" | "light";
export type RenderMode = "auto" | "native" | "flatten";

export interface DeckMeta {
  title: string;
  language?: string;
  audience?: string;
  purpose?: string;
  durationMinutes?: number;
  author?: string;
  company?: string;
}

export interface SlideItem {
  label?: string;
  title: string;
  body?: string;
  value?: string;
  tone?: "accent" | "blue" | "green" | "amber" | "neutral";
}

export interface VisualSpec {
  src: string;
  alt: string;
  fit?: "cover" | "contain";
  position?: string;
  caption?: string;
}

export interface ChartSeries {
  name: string;
  values: number[];
}

export interface ChartSpec {
  type: "bar" | "column" | "line" | "donut";
  categories: string[];
  series: ChartSeries[];
  valueSuffix?: string;
}

export interface TableSpec {
  headers: string[];
  rows: Array<Array<string | number>>;
}

export interface DiagramNode {
  id: string;
  label: string;
  detail?: string;
  tone?: SlideItem["tone"];
  shape?: "rounded" | "circle";
}

export interface DiagramEdge {
  from: string;
  to: string;
  label?: string;
}

export interface DiagramSpec {
  layout?: "horizontal" | "vertical" | "grid";
  nodes: DiagramNode[];
  edges?: DiagramEdge[];
}

export interface SlideSpec {
  id: string;
  kind: SlideKind;
  title: string;
  eyebrow?: string;
  subtitle?: string;
  body?: string;
  quote?: string;
  tags?: string[];
  items?: SlideItem[];
  visual?: VisualSpec;
  chart?: ChartSpec;
  table?: TableSpec;
  diagram?: DiagramSpec;
  renderMode?: RenderMode;
  notes?: string;
  sourceRefs?: string[];
}

export interface DeckSection {
  id: string;
  title: string;
  slides: SlideSpec[];
}

export interface DeckSpec {
  version: 1;
  meta: DeckMeta;
  brandProfile: string;
  theme?: ThemeName;
  outputMode?: "hybrid" | "pixel";
  sections: DeckSection[];
}

export interface BrandTheme {
  bg: string;
  bgDeep: string;
  panel: string;
  panelSoft: string;
  ink: string;
  muted: string;
  line: string;
  accent: string;
  accent2: string;
  accent3: string;
  good: string;
  warn: string;
}

export interface BrandProfile {
  version: 1;
  id: string;
  name: string;
  logo?: string;
  fonts: {
    display: string;
    body: string;
    fallback?: string;
  };
  themes: Record<ThemeName, BrandTheme>;
  style?: {
    radius?: number;
    visualDirection?: string;
    imagePromptPrefix?: string;
  };
}

export interface LintIssue {
  level: "error" | "warning";
  path: string;
  message: string;
}

export interface FlatSlide {
  sectionId: string;
  sectionTitle: string;
  sectionIndex: number;
  slideIndex: number;
  slide: SlideSpec;
}

export interface NativeTextMeasurement {
  kind: "text";
  id: string;
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fontFamily: string;
  fontSizePx: number;
  fontWeight: number;
  color: string;
  align: "left" | "center" | "right";
  valign: "top" | "middle" | "bottom";
  lineHeightPx: number;
  letterSpacingPx: number;
}

export interface NativeBlockMeasurement {
  kind: "diagram" | "chart" | "table";
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  nodes?: Array<{
    id: string;
    label: string;
    detail?: string;
    tone?: SlideItem["tone"];
    shape?: DiagramNode["shape"];
    x: number;
    y: number;
    w: number;
    h: number;
  }>;
}

export interface SlideMeasurement {
  id: string;
  texts: NativeTextMeasurement[];
  blocks: NativeBlockMeasurement[];
}

export function flattenSlides(deck: DeckSpec): FlatSlide[] {
  const result: FlatSlide[] = [];
  let slideIndex = 0;
  deck.sections.forEach((section, sectionIndex) => {
    section.slides.forEach((slide) => {
      result.push({
        sectionId: section.id,
        sectionTitle: section.title,
        sectionIndex,
        slideIndex,
        slide,
      });
      slideIndex += 1;
    });
  });
  return result;
}
