import type {
  BrandProfile,
  BrandTheme,
  ChartSpec,
  DeckSpec,
  DiagramSpec,
  FlatSlide,
  SlideItem,
  SlideSpec,
  ThemeName,
} from "./types.js";
import { escapeHtml } from "./model.js";
import { flattenSlides } from "./types.js";

export interface HtmlRenderOptions {
  theme?: ThemeName;
  assetMap?: Map<string, string>;
  templateCss?: string;
  templateId?: string;
}

const toneClass = (tone?: SlideItem["tone"]) => `tone-${tone ?? "neutral"}`;
const clampPercent = (value: number) => Math.min(96, Math.max(2, Number.isFinite(value) ? value : 50));

function nativeText(
  tag: "h1" | "h2" | "h3" | "p" | "span" | "strong" | "small" | "b",
  id: string,
  text: unknown,
  className: string,
  valign: "top" | "middle" | "bottom" = "top",
): string {
  return `<${tag} class="${className}" data-ppt-native="text" data-ppt-id="${escapeHtml(id)}" data-ppt-valign="${valign}">${escapeHtml(text)}</${tag}>`;
}

function renderChrome(flat: FlatSlide, total: number, brand: BrandProfile, theme: ThemeName, assetMap: Map<string, string>): string {
  const reference = brand.logos?.[theme] ?? brand.logo;
  const logo = reference ? assetMap.get(`brand:${reference}`) ?? assetMap.get(reference) : undefined;
  const mark = logo
    ? `<img src="${escapeHtml(logo)}" alt="${escapeHtml(brand.name)}">`
    : `<span class="vp-wordmark">${escapeHtml(brand.name)}</span>`;
  return `<header class="vp-chrome">
    <div class="vp-brand">${mark}</div>
    <div class="vp-meta"><span>${escapeHtml(flat.sectionTitle)}</span>${flat.sectionTimeBudget ? `<em class="vp-time-budget">${escapeHtml(flat.sectionTimeBudget)}</em>` : ""}<b>${String(flat.slideIndex + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}</b></div>
  </header>`;
}

function renderEyebrow(slide: SlideSpec): string {
  return slide.eyebrow ? nativeText("p", `${slide.id}-eyebrow`, slide.eyebrow, "vp-eyebrow") : "";
}

function titleHtml(slide: SlideSpec): string {
  const accent = slide.titleAccent?.trim();
  const at = accent ? slide.title.indexOf(accent) : -1;
  if (!accent || at < 0) return escapeHtml(slide.title);
  return `${escapeHtml(slide.title.slice(0, at))}<span class="vp-title-accent">${escapeHtml(accent)}</span>${escapeHtml(slide.title.slice(at + accent.length))}`;
}

function renderTitle(slide: SlideSpec, hero = false): string {
  const tag = hero ? "h1" : "h2";
  const className = hero ? "vp-title vp-title-hero" : "vp-title";
  return `<${tag} class="${className}" data-ppt-native="text" data-ppt-id="${escapeHtml(`${slide.id}-title`)}" data-ppt-valign="top">${titleHtml(slide)}</${tag}>`;
}

function renderBody(slide: SlideSpec, className = "vp-body"): string {
  return slide.body ? nativeText("p", `${slide.id}-body`, slide.body, className) : "";
}

function renderNotes(slide: SlideSpec): string {
  if (!slide.notes && !slide.sourceRefs?.length) return "";
  const sources = slide.sourceRefs?.length
    ? `<div class="vp-note-sources"><b>Sources</b>${slide.sourceRefs.map((source) => `<span>${escapeHtml(source)}</span>`).join("")}</div>`
    : "";
  return `<aside class="vp-speaker-note"><b>Speaker notes</b><p>${escapeHtml(slide.notes ?? "")}</p>${sources}</aside>`;
}

function renderTags(slide: SlideSpec): string {
  if (!slide.tags?.length) return "";
  return `<div class="vp-tags">${slide.tags
    .map((tag, index) => nativeText("span", `${slide.id}-tag-${index}`, tag, "vp-tag", "middle"))
    .join("")}</div>`;
}

function renderCards(slide: SlideSpec, className = "vp-card-grid"): string {
  return `<div class="${className}">${(slide.items ?? [])
    .map(
      (item, index) => `<article class="vp-card ${toneClass(item.tone)}">
        ${item.label ? nativeText("span", `${slide.id}-item-${index}-label`, item.label, "vp-card-label", "middle") : ""}
        ${nativeText("h3", `${slide.id}-item-${index}-title`, item.title, "vp-card-title")}
        ${item.body ? nativeText("p", `${slide.id}-item-${index}-body`, item.body, "vp-card-body") : ""}
      </article>`,
    )
    .join("")}</div>`;
}

function renderVisual(slide: SlideSpec, assetMap: Map<string, string>, className = "vp-visual"): string {
  if (!slide.visual) {
    return `<div class="${className} vp-visual-generated" aria-label="Abstract product visual">
      <div class="vp-orbit orbit-a"></div><div class="vp-orbit orbit-b"></div>
      <div class="vp-signal-card signal-main"><span></span><b></b><i></i></div>
      <div class="vp-signal-card signal-side"><span></span><b></b></div>
    </div>`;
  }
  const src = assetMap.get(slide.visual.src) ?? slide.visual.src;
  const callouts = (slide.visual.callouts ?? [])
    .map((callout, index) => `<div class="vp-callout" style="left:${clampPercent(callout.x)}%;top:${clampPercent(callout.y)}%">
      ${callout.label ? nativeText("span", `${slide.id}-callout-${index}-label`, callout.label, "vp-callout-label", "middle") : ""}
      <div class="vp-callout-copy">
        ${nativeText("b", `${slide.id}-callout-${index}-title`, callout.title, "vp-callout-title")}
        ${callout.body ? nativeText("span", `${slide.id}-callout-${index}-body`, callout.body, "vp-callout-body") : ""}
      </div>
    </div>`)
    .join("");
  return `<figure class="${className}"><img src="${escapeHtml(src)}" alt="${escapeHtml(slide.visual.alt)}" style="object-fit:${slide.visual.fit ?? "cover"};object-position:${escapeHtml(slide.visual.position ?? "center")}">${slide.visual.caption ? `<figcaption>${escapeHtml(slide.visual.caption)}</figcaption>` : ""}${callouts}</figure>`;
}

function diagramFromItems(slide: SlideSpec): DiagramSpec {
  const nodes = (slide.items ?? []).map((item, index) => ({
    id: `step-${index + 1}`,
    label: item.title,
    ...(item.body ? { detail: item.body } : {}),
    ...(item.tone ? { tone: item.tone } : {}),
  }));
  return {
    layout: "horizontal",
    nodes,
    edges: nodes.slice(1).map((node, index) => ({ from: nodes[index]?.id ?? "", to: node.id })),
  };
}

function renderDiagram(slide: SlideSpec): string {
  const diagram = slide.diagram ?? diagramFromItems(slide);
  const native = slide.renderMode !== "flatten" && diagram.nodes.length <= 20;
  const edges = diagram.edges ?? diagram.nodes.slice(1).map((node, index) => ({ from: diagram.nodes[index]?.id ?? "", to: node.id }));
  const edgeJson = JSON.stringify(edges).replaceAll("<", "\\u003c");
  return `<div class="vp-diagram layout-${diagram.layout ?? "horizontal"}"${native ? ` data-ppt-native-block="diagram" data-ppt-id="${escapeHtml(slide.id)}-diagram"` : ""}>
    <svg class="vp-diagram-lines" aria-hidden="true"></svg>
    ${diagram.nodes
      .map(
        (node, index) => `<article class="vp-diagram-node ${toneClass(node.tone)} shape-${node.shape ?? "rounded"}" data-vp-node-id="${escapeHtml(node.id)}" data-vp-node-label="${escapeHtml(node.label)}" data-vp-node-detail="${escapeHtml(node.detail ?? "")}" data-vp-node-tone="${escapeHtml(node.tone ?? "neutral")}" data-vp-node-shape="${escapeHtml(node.shape ?? "rounded")}">
          <span>${String(index + 1).padStart(2, "0")}</span><h3>${escapeHtml(node.label)}</h3>${node.detail ? `<p>${escapeHtml(node.detail)}</p>` : ""}
        </article>`,
      )
      .join("")}
    <script type="application/json" data-vp-edges>${edgeJson}</script>
  </div>`;
}

function chartRange(chart: ChartSpec): { min: number; max: number } {
  const values = chart.series.flatMap((series) => series.values);
  return { min: Math.min(0, ...values), max: Math.max(1, ...values) };
}

function renderChartGraphic(chart: ChartSpec): string {
  const { min, max } = chartRange(chart);
  const colors = ["var(--accent)", "var(--accent2)", "var(--accent3)"];
  if (chart.type === "donut") {
    const values = chart.series[0]?.values ?? [];
    const total = values.reduce((sum, value) => sum + value, 0) || 1;
    let cursor = 0;
    const stops = values.map((value, index) => {
      const start = cursor;
      cursor += (value / total) * 360;
      return `${colors[index % colors.length]} ${start}deg ${cursor}deg`;
    });
    return `<div class="vp-donut" style="background:conic-gradient(${stops.join(",")})"><div><b>${escapeHtml(total)}</b><span>Total</span></div></div>`;
  }
  if (chart.type === "line") {
    const points = chart.series
      .map((series, seriesIndex) => {
        const coords = series.values.map((value, index) => {
          const x = chart.categories.length === 1 ? 50 : 8 + (index / (chart.categories.length - 1)) * 84;
          const y = 88 - ((value - min) / (max - min || 1)) * 72;
          return `${x},${y}`;
        });
        return `<polyline points="${coords.join(" ")}" fill="none" stroke="${colors[seriesIndex % colors.length]}" stroke-width="2.2" vector-effect="non-scaling-stroke"/>${coords.map((point) => { const [x, y] = point.split(","); return `<circle cx="${x}" cy="${y}" r="1.8" fill="${colors[seriesIndex % colors.length]}"/>`; }).join("")}`;
      })
      .join("");
    return `<svg class="vp-line-chart" viewBox="0 0 100 100" preserveAspectRatio="none">${points}</svg>`;
  }
  const primary = chart.series[0]?.values ?? [];
  return `<div class="vp-bars ${chart.type === "bar" ? "horizontal" : ""}">${primary
    .map((value, index) => {
      const size = Math.max(3, ((value - min) / (max - min || 1)) * 100);
      return `<div class="vp-bar-wrap"><i style="--bar-size:${size}%"></i><span>${escapeHtml(chart.categories[index])}</span><b>${escapeHtml(value)}${escapeHtml(chart.valueSuffix ?? "")}</b></div>`;
    })
    .join("")}</div>`;
}

function renderChart(slide: SlideSpec): string {
  if (!slide.chart) return `<div class="vp-empty-state">Chart data missing</div>`;
  const native = slide.renderMode !== "flatten";
  return `<div class="vp-chart"${native ? ` data-ppt-native-block="chart" data-ppt-id="${escapeHtml(slide.id)}-chart"` : ""}>
    ${renderChartGraphic(slide.chart)}
    <div class="vp-chart-legend">${slide.chart.series.map((series, index) => `<span><i style="background:var(--series-${(index % 3) + 1})"></i>${escapeHtml(series.name)}</span>`).join("")}</div>
  </div>`;
}

function renderTable(slide: SlideSpec): string {
  if (!slide.table) return `<div class="vp-empty-state">Table data missing</div>`;
  const native = slide.renderMode !== "flatten";
  return `<div class="vp-table-wrap"${native ? ` data-ppt-native-block="table" data-ppt-id="${escapeHtml(slide.id)}-table"` : ""}><table class="vp-table"><thead><tr>${slide.table.headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${slide.table.rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function renderSlideBody(slide: SlideSpec, assetMap: Map<string, string>): string {
  switch (slide.kind) {
    case "hero":
      return `<div class="vp-hero-copy">${renderEyebrow(slide)}${renderTitle(slide, true)}${renderBody(slide)}${renderTags(slide)}</div><div class="vp-hero-art">${renderVisual(slide, assetMap, "vp-hero-visual")}</div>`;
    case "statement":
      return `<div class="vp-statement">${renderEyebrow(slide)}<div class="vp-statement-main">${renderTitle(slide)}${renderBody(slide)}</div>${renderCards(slide, "vp-statement-items")}</div>`;
    case "section":
      return `<div class="vp-section-slide">${renderEyebrow(slide)}${renderTitle(slide, true)}${renderBody(slide)}${renderTags(slide)}</div>`;
    case "feature":
    case "screenshot":
      return `<div class="vp-feature-copy">${renderEyebrow(slide)}${renderTitle(slide)}${renderBody(slide)}${slide.items?.length ? renderCards(slide, "vp-feature-items") : ""}</div><div class="vp-feature-art">${renderVisual(slide, assetMap)}</div>`;
    case "card-grid":
      return `<div class="vp-slide-heading">${renderEyebrow(slide)}${renderTitle(slide)}${renderBody(slide)}</div>${renderCards(slide)}`;
    case "process":
    case "timeline":
      return `<div class="vp-slide-heading compact">${renderEyebrow(slide)}${renderTitle(slide)}${renderBody(slide)}</div>${renderDiagram(slide)}`;
    case "architecture":
      return `<div class="vp-slide-heading compact">${renderEyebrow(slide)}${renderTitle(slide)}${renderBody(slide)}</div>${renderDiagram(slide)}`;
    case "metrics":
      return `<div class="vp-slide-heading">${renderEyebrow(slide)}${renderTitle(slide)}${renderBody(slide)}</div><div class="vp-metrics">${(slide.items ?? []).map((item, index) => `<article class="vp-metric ${toneClass(item.tone)}">${item.label ? nativeText("span", `${slide.id}-metric-${index}-label`, item.label, "vp-metric-label") : ""}${nativeText("strong", `${slide.id}-metric-${index}-value`, item.title, "vp-metric-value")}${item.body ? nativeText("p", `${slide.id}-metric-${index}-body`, item.body, "vp-metric-body") : ""}</article>`).join("")}</div>`;
    case "chart":
      return `<div class="vp-chart-copy">${renderEyebrow(slide)}${renderTitle(slide)}${renderBody(slide)}</div>${renderChart(slide)}`;
    case "table":
      return `<div class="vp-slide-heading compact">${renderEyebrow(slide)}${renderTitle(slide)}${renderBody(slide)}</div>${renderTable(slide)}`;
    case "comparison":
    case "matrix":
      return `<div class="vp-slide-heading compact">${renderEyebrow(slide)}${renderTitle(slide)}${renderBody(slide)}</div>${renderCards(slide, "vp-comparison")}`;
    case "use-case":
    case "case-study":
      return `<div class="vp-usecase-copy">${renderEyebrow(slide)}${renderTitle(slide)}${renderBody(slide)}</div><div class="vp-usecase-track">${(slide.items ?? []).map((item, index) => `<article class="vp-usecase-step ${toneClass(item.tone)}">${item.label ? nativeText("span", `${slide.id}-case-${index}-label`, item.label, "vp-usecase-label", "middle") : ""}<div>${nativeText("h3", `${slide.id}-case-${index}-title`, item.title, "vp-usecase-title")}${item.body ? nativeText("p", `${slide.id}-case-${index}-body`, item.body, "vp-usecase-body") : ""}</div></article>`).join("")}</div>`;
    case "closing":
      return `<div class="vp-closing">${renderEyebrow(slide)}${renderTitle(slide, true)}${renderBody(slide)}${renderTags(slide)}</div>`;
  }
}

function renderSlide(flat: FlatSlide, total: number, brand: BrandProfile, theme: ThemeName, assetMap: Map<string, string>): string {
  const slide = flat.slide;
  const layout = slide.layout ? ` vp-layout-${slide.layout}` : "";
  return `<section class="vp-slide vp-kind-${slide.kind}${layout}${flat.slideIndex === 0 ? " is-active" : ""}" data-slide-index="${flat.slideIndex}" data-slide-id="${escapeHtml(slide.id)}"${slide.layout ? ` data-layout-id="${escapeHtml(slide.layout)}"` : ""} aria-label="Slide ${flat.slideIndex + 1}: ${escapeHtml(slide.title)}">
    ${renderChrome(flat, total, brand, theme, assetMap)}
    <main class="vp-content">${renderSlideBody(slide, assetMap)}</main>
    <div class="vp-accent-line"></div>
    ${renderNotes(slide)}
  </section>`;
}

function themeCss(theme: BrandTheme, brand: BrandProfile): string {
  const radius = Math.max(4, Math.min(40, brand.style?.radius ?? 20));
  return `
    --bg:${theme.bg};--bg-deep:${theme.bgDeep};--panel:${theme.panel};--panel-soft:${theme.panelSoft};
    --ink:${theme.ink};--muted:${theme.muted};--line:${theme.line};--accent:${theme.accent};
    --accent2:${theme.accent2};--accent3:${theme.accent3};--good:${theme.good};--warn:${theme.warn};
    --series-1:${theme.accent};--series-2:${theme.accent2};--series-3:${theme.accent3};
    --font-display:${JSON.stringify(brand.fonts.display)},${JSON.stringify(brand.fonts.fallback ?? "Arial")},sans-serif;
    --font-body:${JSON.stringify(brand.fonts.body)},${JSON.stringify(brand.fonts.fallback ?? "Arial")},sans-serif;
    --radius:${radius}px;`;
}

const CSS = String.raw`
*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#020205}body{font-family:var(--font-body);color:var(--ink);-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}.vp-deck{position:fixed;inset:0;overflow:hidden}.vp-slide{position:absolute;left:50%;top:50%;width:1920px;height:1080px;overflow:hidden;visibility:hidden;opacity:0;transform:translate(-50%,-50%) scale(var(--deck-scale,1));transform-origin:center;background-color:var(--bg);background-image:radial-gradient(1100px 700px at 89% -8%,color-mix(in srgb,var(--accent) 20%,transparent),transparent 66%),radial-gradient(920px 650px at -8% 112%,color-mix(in srgb,var(--accent2) 13%,transparent),transparent 70%),linear-gradient(color-mix(in srgb,var(--ink) 3%,transparent) 1px,transparent 1px),linear-gradient(90deg,color-mix(in srgb,var(--ink) 3%,transparent) 1px,transparent 1px);background-size:auto,auto,48px 48px,48px 48px}.vp-slide::after{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(90deg,color-mix(in srgb,var(--bg-deep) 28%,transparent),transparent 45%,color-mix(in srgb,var(--bg-deep) 15%,transparent))}.vp-slide.is-active{visibility:visible;opacity:1}.vp-slide>*{position:relative;z-index:1}.vp-chrome{position:absolute;z-index:8;top:48px;left:84px;right:84px;display:flex;align-items:center;justify-content:space-between;height:72px}.vp-brand img{display:block;max-width:250px;max-height:58px}.vp-wordmark{font-family:var(--font-display);font-size:24px;font-weight:800;letter-spacing:-.03em}.vp-meta{display:flex;align-items:center;gap:24px;color:var(--muted);font-size:14px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}.vp-meta b{color:var(--ink)}
.vp-time-budget{font-style:normal;padding:5px 12px;border:1px solid var(--line-strong,var(--line));border-radius:999px;color:var(--ink);font-size:13px;letter-spacing:.1em}
.vp-title-accent{color:var(--accent)}
.vp-callout{position:absolute;z-index:2;display:flex;align-items:center;gap:12px;padding:12px 18px 12px 12px;border:1px solid var(--line-strong,var(--line));border-radius:14px;background:var(--panel);box-shadow:0 18px 40px rgba(0,0,0,.34);max-width:330px}
.vp-callout-label{display:flex;align-items:center;justify-content:center;width:34px;height:34px;flex:0 0 34px;border-radius:50%;background:var(--accent);color:#fff;font-size:14px;font-weight:800}
.vp-callout-copy{display:flex;flex-direction:column;gap:3px;min-width:0}
.vp-callout-title{color:var(--ink);font-size:19px;font-weight:750;line-height:24px}
.vp-callout-body{color:var(--muted);font-size:14px;line-height:19px;min-height:38px}.vp-content{position:absolute;inset:148px 84px 70px}.vp-accent-line{position:absolute;left:84px;right:84px;bottom:43px;height:2px;background:linear-gradient(90deg,var(--accent),color-mix(in srgb,var(--accent) 10%,transparent) 32%,transparent 68%)}.vp-eyebrow{display:flex;align-items:center;gap:12px;margin:0;color:var(--accent);font-size:16px;line-height:22px;font-weight:800;letter-spacing:.16em;text-transform:uppercase}.vp-eyebrow::before{content:"";width:32px;height:2px;background:currentColor}.vp-title{max-width:1260px;margin:20px 0 0;font-family:var(--font-display);font-size:76px;line-height:.98;font-weight:680;letter-spacing:-.055em;white-space:pre-line}.vp-title-hero{font-size:118px;line-height:.88;letter-spacing:-.07em}.vp-body{max-width:700px;margin:28px 0 0;color:var(--muted);font-size:25px;line-height:1.45}.vp-tags{display:flex;gap:12px;flex-wrap:wrap;margin-top:34px}.vp-tag{display:grid;place-items:center;min-width:130px;height:42px;padding:0 18px;border:1px solid color-mix(in srgb,var(--accent) 42%,var(--line));border-radius:999px;background:color-mix(in srgb,var(--accent) 11%,transparent);color:var(--ink);font-size:14px;font-weight:750;letter-spacing:.08em;text-transform:uppercase}.vp-hero-copy{position:absolute;z-index:2;left:0;top:50%;width:58%;transform:translateY(-50%)}.vp-hero-copy .vp-body{max-width:610px}.vp-hero-art{position:absolute;right:-84px;top:-148px;width:930px;height:1080px}.vp-hero-visual{position:absolute;inset:0;overflow:hidden}.vp-hero-visual::after,.vp-visual::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,var(--bg) 0%,transparent 35%),linear-gradient(0deg,var(--bg) 0%,transparent 35%)}.vp-hero-visual img,.vp-visual img{width:100%;height:100%;display:block}.vp-visual-generated{position:relative;overflow:hidden;background:radial-gradient(circle at 55% 45%,color-mix(in srgb,var(--accent) 32%,transparent),transparent 35%),radial-gradient(circle at 72% 66%,color-mix(in srgb,var(--accent2) 28%,transparent),transparent 38%)}.vp-orbit{position:absolute;border:1px solid color-mix(in srgb,var(--ink) 16%,transparent);border-radius:50%;transform:rotate(-18deg)}.orbit-a{width:720px;height:720px;right:-80px;top:95px}.orbit-b{width:500px;height:500px;right:40px;top:200px;border-color:color-mix(in srgb,var(--accent) 40%,transparent)}.vp-signal-card{position:absolute;padding:24px;border:1px solid color-mix(in srgb,var(--ink) 16%,transparent);border-radius:22px;background:color-mix(in srgb,var(--panel) 88%,transparent);box-shadow:0 30px 80px rgba(0,0,0,.34);backdrop-filter:blur(16px);transform:rotate(-6deg)}.signal-main{right:90px;top:290px;width:520px;height:310px}.signal-side{right:420px;top:620px;width:350px;height:190px;transform:rotate(5deg)}.vp-signal-card span,.vp-signal-card b,.vp-signal-card i{display:block;border-radius:999px;background:color-mix(in srgb,var(--ink) 14%,transparent)}.vp-signal-card span{width:42%;height:18px;background:var(--accent)}.vp-signal-card b{width:82%;height:32px;margin-top:36px}.vp-signal-card i{width:64%;height:18px;margin-top:22px}.vp-statement{display:flex;height:100%;flex-direction:column}.vp-statement-main{display:grid;grid-template-columns:1.4fr .6fr;align-items:end;gap:70px;margin:auto 0}.vp-statement-main .vp-body{border-left:3px solid var(--accent);padding-left:28px;margin:0}.vp-statement-items{display:grid;grid-template-columns:repeat(3,1fr);border-top:1px solid var(--line)}.vp-statement-items .vp-card{min-height:160px;padding:28px 28px 12px;border:0;border-left:1px solid var(--line);border-radius:0;background:transparent}.vp-statement-items .vp-card:first-child{border-left:0}.vp-section-slide,.vp-closing{position:absolute;left:0;top:50%;width:100%;transform:translateY(-50%)}.vp-section-slide .vp-title,.vp-closing .vp-title{max-width:1400px}.vp-slide-heading{position:absolute;left:0;right:0;top:0}.vp-slide-heading.compact .vp-title{font-size:64px}.vp-slide-heading .vp-body{position:absolute;right:0;top:15px;width:520px;margin:0}.vp-card-grid{position:absolute;left:0;right:0;bottom:0;display:grid;grid-template-columns:repeat(4,1fr);gap:22px;height:520px}.vp-card{position:relative;display:flex;flex-direction:column;padding:30px;border:1px solid var(--line);border-top:4px solid var(--tone,var(--line));border-radius:var(--radius);background:linear-gradient(145deg,color-mix(in srgb,var(--tone,var(--panel)) 9%,var(--panel)),var(--panel-soft));overflow:hidden}.vp-card::after{content:"";position:absolute;width:220px;height:220px;right:-100px;bottom:-110px;border-radius:50%;background:color-mix(in srgb,var(--tone,var(--accent)) 12%,transparent);filter:blur(10px)}.vp-card-label{position:relative;z-index:1;color:var(--tone,var(--muted));font-size:14px;line-height:22px;font-weight:850;letter-spacing:.13em;text-transform:uppercase}.vp-card-title{position:relative;z-index:1;margin:auto 0 0;font-family:var(--font-display);font-size:34px;line-height:1.06;letter-spacing:-.035em}.vp-card-body{position:relative;z-index:1;min-height:78px;margin:20px 0 0;color:var(--muted);font-size:18px;line-height:1.45}.tone-accent{--tone:var(--accent)}.tone-blue{--tone:var(--accent2)}.tone-green{--tone:var(--good)}.tone-amber{--tone:var(--accent3)}.tone-neutral{--tone:var(--line)}.vp-feature-copy{position:absolute;left:0;top:50%;width:42%;transform:translateY(-50%)}.vp-feature-copy .vp-title{font-size:70px}.vp-feature-items{display:grid;grid-template-columns:1fr;gap:10px;margin-top:34px}.vp-feature-items .vp-card{display:grid;grid-template-columns:42px 160px 1fr;align-items:center;min-height:78px;padding:14px 18px;border-top-width:1px}.vp-feature-items .vp-card-title{margin:0;font-size:21px}.vp-feature-items .vp-card-body{min-height:0;margin:0;font-size:15px}.vp-feature-art{position:absolute;right:0;top:0;width:52%;height:100%}.vp-visual{position:absolute;inset:0;overflow:hidden;border:1px solid var(--line);border-radius:calc(var(--radius) + 6px);background:var(--panel);box-shadow:0 30px 90px rgba(0,0,0,.26)}.vp-visual::before{content:"";position:absolute;z-index:2;left:22px;top:20px;width:48px;height:12px;border-radius:999px;background:var(--accent);box-shadow:68px 0 0 color-mix(in srgb,var(--ink) 12%,transparent),136px 0 0 color-mix(in srgb,var(--ink) 12%,transparent)}.vp-diagram{position:absolute;left:0;right:0;bottom:0;height:500px;display:grid;gap:70px;align-items:center}.vp-diagram.layout-horizontal{grid-template-columns:repeat(var(--node-count,4),1fr)}.vp-diagram.layout-vertical{grid-template-columns:1fr;grid-template-rows:repeat(var(--node-count,4),1fr);gap:18px;padding:0 360px}.vp-diagram.layout-grid{grid-template-columns:repeat(3,1fr);gap:24px}.vp-diagram-node{position:relative;z-index:2;display:flex;flex-direction:column;justify-content:center;min-height:220px;padding:28px;border:1px solid color-mix(in srgb,var(--tone,var(--line)) 55%,var(--line));border-radius:var(--radius);background:linear-gradient(145deg,color-mix(in srgb,var(--tone,var(--panel)) 11%,var(--panel)),var(--panel-soft));text-align:center}.vp-diagram-node.shape-circle{aspect-ratio:1;border-radius:50%;min-height:0}.vp-diagram-node>span{color:var(--tone,var(--accent));font-size:14px;font-weight:900;letter-spacing:.13em}.vp-diagram-node h3{margin:18px 0 0;font-family:var(--font-display);font-size:28px;line-height:1.08}.vp-diagram-node p{margin:15px 0 0;color:var(--muted);font-size:16px;line-height:1.4}.vp-diagram-lines{position:absolute;z-index:1;inset:0;width:100%;height:100%;overflow:visible}.vp-metrics{position:absolute;left:0;right:0;bottom:0;display:grid;grid-template-columns:repeat(3,1fr);gap:24px;height:540px}.vp-metric{display:flex;flex-direction:column;justify-content:center;padding:42px;border:1px solid var(--line);border-radius:var(--radius);background:linear-gradient(155deg,color-mix(in srgb,var(--tone,var(--panel)) 12%,var(--panel)),var(--panel-soft))}.vp-metric-label{color:var(--tone,var(--muted));font-size:16px;line-height:24px;font-weight:850;letter-spacing:.12em;text-transform:uppercase}.vp-metric-value{margin-top:55px;font-family:var(--font-display);font-size:108px;line-height:.9;letter-spacing:-.07em}.vp-metric-body{margin:36px 0 0;color:var(--muted);font-size:20px;line-height:1.4}.vp-chart-copy{position:absolute;left:0;top:50%;width:35%;transform:translateY(-50%)}.vp-chart-copy .vp-title{font-size:64px}.vp-chart{position:absolute;right:0;top:0;width:60%;height:100%;padding:54px;border:1px solid var(--line);border-radius:var(--radius);background:linear-gradient(145deg,var(--panel),var(--panel-soft))}.vp-line-chart{width:100%;height:78%;overflow:visible}.vp-chart-legend{display:flex;gap:28px;margin-top:18px;color:var(--muted);font-size:15px}.vp-chart-legend span{display:flex;align-items:center;gap:9px}.vp-chart-legend i{width:26px;height:4px;border-radius:999px}.vp-bars{display:flex;align-items:end;gap:20px;height:78%}.vp-bar-wrap{position:relative;display:flex;flex:1;height:100%;align-items:end;justify-content:center}.vp-bar-wrap i{display:block;width:54%;height:var(--bar-size);border-radius:10px 10px 2px 2px;background:linear-gradient(var(--accent2),var(--accent))}.vp-bar-wrap span{position:absolute;bottom:-30px;color:var(--muted);font-size:13px}.vp-bar-wrap b{position:absolute;top:calc(100% - var(--bar-size) - 28px);font-size:14px}.vp-bars.horizontal{display:grid;align-items:stretch}.vp-donut{position:absolute;left:50%;top:45%;width:390px;height:390px;border-radius:50%;transform:translate(-50%,-50%)}.vp-donut>div{position:absolute;inset:86px;display:grid;place-items:center;border-radius:50%;background:var(--panel);text-align:center}.vp-donut b{font-size:62px}.vp-donut span{display:block;color:var(--muted);font-size:15px}.vp-table-wrap{position:absolute;left:0;right:0;bottom:0;height:540px;overflow:hidden;border:1px solid var(--line);border-radius:var(--radius);background:var(--panel)}.vp-table{width:100%;height:100%;border-collapse:collapse;table-layout:fixed}.vp-table th,.vp-table td{padding:20px 24px;border-right:1px solid var(--line);border-bottom:1px solid var(--line);text-align:left}.vp-table th{height:82px;color:var(--accent);font-size:15px;letter-spacing:.1em;text-transform:uppercase}.vp-table td{color:var(--ink);font-size:19px}.vp-table tr:last-child td{border-bottom:0}.vp-comparison{position:absolute;left:0;right:0;bottom:0;display:grid;grid-template-columns:repeat(2,1fr);gap:28px;height:550px}.vp-comparison .vp-card-title{font-size:44px}.vp-comparison .vp-card-body{font-size:22px}.vp-usecase-copy{position:absolute;left:0;top:50%;width:42%;transform:translateY(-50%)}.vp-usecase-copy .vp-title{font-size:64px}.vp-usecase-track{position:absolute;right:0;top:0;width:52%;height:100%;display:flex;flex-direction:column;justify-content:center;gap:14px}.vp-usecase-step{display:grid;grid-template-columns:110px 1fr;gap:22px;align-items:center;min-height:132px;padding:20px 24px;border:1px solid var(--line);border-left:5px solid var(--tone,var(--line));border-radius:var(--radius);background:linear-gradient(90deg,color-mix(in srgb,var(--tone,var(--panel)) 10%,var(--panel)),var(--panel-soft))}.vp-usecase-label{display:grid;place-items:center;width:90px;height:48px;border-radius:999px;background:color-mix(in srgb,var(--tone,var(--accent)) 14%,transparent);color:var(--tone,var(--accent));font-size:14px;font-weight:850}.vp-usecase-title{margin:0;font-size:26px;line-height:1.1}.vp-usecase-body{margin:10px 0 0;color:var(--muted);font-size:16px;line-height:1.4}.vp-empty-state{display:grid;place-items:center;height:100%;border:1px dashed var(--line);color:var(--muted)}.vp-speaker-note{display:none;position:absolute;z-index:20;right:54px;bottom:54px;width:560px;max-height:420px;overflow:auto;padding:26px;border:1px solid var(--line);border-radius:18px;background:color-mix(in srgb,var(--panel) 94%,transparent);box-shadow:0 30px 90px rgba(0,0,0,.42);backdrop-filter:blur(20px)}body.notes-on .vp-slide.is-active .vp-speaker-note{display:block}.vp-speaker-note>b{color:var(--accent);font-size:13px;letter-spacing:.13em;text-transform:uppercase}.vp-speaker-note p{margin:16px 0 0;font-size:19px;line-height:1.5}.vp-note-sources{display:grid;gap:6px;margin-top:18px;padding-top:16px;border-top:1px solid var(--line);color:var(--muted);font-size:13px}.vp-controls{position:fixed;z-index:50;right:20px;bottom:20px;display:flex;align-items:center;gap:4px;padding:6px;border:1px solid rgba(255,255,255,.15);border-radius:13px;background:rgba(5,5,8,.82);color:#fff;backdrop-filter:blur(18px)}.vp-controls button{display:grid;place-items:center;width:36px;height:36px;border:0;border-radius:9px;background:transparent;color:inherit;font:700 16px/1 sans-serif;cursor:pointer}.vp-controls button:hover{background:rgba(255,255,255,.1)}.vp-controls span{min-width:60px;text-align:center;font:700 12px/1 sans-serif;color:rgba(255,255,255,.6)}html.vp-export .vp-controls,html.vp-export .vp-speaker-note{display:none!important}html.vp-export-background [data-ppt-native="text"],html.vp-export-background [data-ppt-native="text"] *{color:transparent!important;text-shadow:none!important}html.vp-export-background [data-ppt-native="text"]::before,html.vp-export-background [data-ppt-native="text"]::after{visibility:hidden!important}html.vp-export-background [data-ppt-native-block]{visibility:hidden!important}@media(max-aspect-ratio:16/9){:root{--deck-scale:calc(100vw / 1920)}}@media(min-aspect-ratio:16/9){:root{--deck-scale:calc(100vh / 1080)}}
`;

const SCRIPT = String.raw`
(() => {
  const slides = [...document.querySelectorAll('.vp-slide')];
  let active = 0;
  const counter = document.querySelector('[data-counter]');
  function fitDeck() {
    document.documentElement.style.setProperty('--deck-scale', String(Math.min(innerWidth / 1920, innerHeight / 1080)));
  }
  function drawDiagram(slide) {
    slide.querySelectorAll('.vp-diagram').forEach((diagram) => {
      diagram.style.setProperty('--node-count', String(Math.max(1, diagram.querySelectorAll('[data-vp-node-id]').length)));
      const svg = diagram.querySelector('.vp-diagram-lines');
      const script = diagram.querySelector('[data-vp-edges]');
      if (!svg || !script) return;
      let edges = [];
      try { edges = JSON.parse(script.textContent); } catch { return; }
      const root = diagram.getBoundingClientRect();
      svg.innerHTML = edges.map((edge) => {
        const from = diagram.querySelector('[data-vp-node-id="' + CSS.escape(edge.from) + '"]');
        const to = diagram.querySelector('[data-vp-node-id="' + CSS.escape(edge.to) + '"]');
        if (!from || !to) return '';
        const a = from.getBoundingClientRect();
        const b = to.getBoundingClientRect();
        const x1 = a.right - root.left;
        const y1 = a.top + a.height / 2 - root.top;
        const x2 = b.left - root.left;
        const y2 = b.top + b.height / 2 - root.top;
        return '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="var(--line)" stroke-width="3"/><circle cx="' + x2 + '" cy="' + y2 + '" r="5" fill="var(--accent)"/>';
      }).join('');
    });
  }
  function activate(index) {
    active = Math.max(0, Math.min(slides.length - 1, Number(index) || 0));
    slides.forEach((slide, i) => slide.classList.toggle('is-active', i === active));
    if (counter) counter.textContent = String(active + 1).padStart(2, '0') + ' / ' + String(slides.length).padStart(2, '0');
    requestAnimationFrame(() => drawDiagram(slides[active]));
    return active;
  }
  function box(element, root) {
    const rect = element.getBoundingClientRect();
    return {x: rect.left-root.left, y: rect.top-root.top, w: rect.width, h: rect.height};
  }
  function textBox(element, root, align) {
    const outer = box(element, root);
    if (align !== 'left') return outer;
    const range = document.createRange();
    range.selectNodeContents(element);
    const inner = range.getBoundingClientRect();
    if (!inner.width) return outer;
    const lead = inner.left - element.getBoundingClientRect().left;
    if (!(lead > 0.5) || lead >= outer.w) return outer;
    return {x: outer.x+lead, y: outer.y, w: outer.w-lead, h: outer.h};
  }
  function rgbToHex(value) {
    const match = value.match(/[\d.]+/g);
    if (!match || match.length < 3) return '#000000';
    return '#' + match.slice(0,3).map((part) => Math.max(0,Math.min(255,Math.round(Number(part)))).toString(16).padStart(2,'0')).join('');
  }
  function textRuns(element) {
    // Only split when the element genuinely mixes colours or weights (a two-tone title);
    // a single run keeps the simpler one-colour path in the PPTX writer.
    const parts = [];
    for (const node of element.childNodes) {
      const text = node.textContent || '';
      if (!text) continue;
      const styled = node.nodeType === 1 ? node : element;
      const style = getComputedStyle(styled);
      parts.push({ text, color: rgbToHex(style.color), bold: (parseInt(style.fontWeight,10)||400) >= 600 });
    }
    if (parts.length < 2) return undefined;
    return parts.some((part) => part.color !== parts[0].color || part.bold !== parts[0].bold) ? parts : undefined;
  }
  function measure(index) {
    const slide = slides[activate(index)];
    const root = slide.getBoundingClientRect();
    const texts = [...slide.querySelectorAll('[data-ppt-native="text"]')].map((element) => {
      const style = getComputedStyle(element);
      const align = ['center','right'].includes(style.textAlign)?style.textAlign:'left';
      const runs = textRuns(element);
      return {
        kind:'text', id:element.dataset.pptId, text:element.innerText, ...(runs?{runs}:{}),
        ...textBox(element, root, align), fontFamily:style.fontFamily.split(',')[0].replaceAll('"','').trim(),
        fontSizePx:parseFloat(style.fontSize), fontWeight:parseInt(style.fontWeight,10)||400,
        color:rgbToHex(style.color), align,
        valign:element.dataset.pptValign||'top', lineHeightPx:parseFloat(style.lineHeight)||parseFloat(style.fontSize)*1.2,
        letterSpacingPx:style.letterSpacing==='normal'?0:parseFloat(style.letterSpacing)||0
      };
    });
    const blocks = [...slide.querySelectorAll('[data-ppt-native-block]')].map((element) => ({
      kind:element.dataset.pptNativeBlock,id:element.dataset.pptId,...box(element,root),
      nodes:[...element.querySelectorAll('[data-vp-node-id]')].map((node) => ({
        id:node.dataset.vpNodeId,label:node.dataset.vpNodeLabel,detail:node.dataset.vpNodeDetail,
        tone:node.dataset.vpNodeTone,shape:node.dataset.vpNodeShape,...box(node,root)
      }))
    }));
    return {id:slide.dataset.slideId,texts,blocks};
  }
  function setExportMode(mode) {
    document.documentElement.classList.toggle('vp-export', Boolean(mode));
    document.documentElement.classList.toggle('vp-export-background', mode==='background');
  }
  document.querySelector('[data-prev]').addEventListener('click',()=>activate(active-1));
  document.querySelector('[data-next]').addEventListener('click',()=>activate(active+1));
  document.querySelector('[data-notes]').addEventListener('click',()=>document.body.classList.toggle('notes-on'));
  document.querySelector('[data-fullscreen]').addEventListener('click',()=>document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen());
  addEventListener('keydown',(event)=>{
    if(['ArrowRight','PageDown',' '].includes(event.key)){event.preventDefault();activate(active+1)}
    if(['ArrowLeft','PageUp'].includes(event.key)){event.preventDefault();activate(active-1)}
    if(event.key.toLowerCase()==='n')document.body.classList.toggle('notes-on');
    if(event.key.toLowerCase()==='f')document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen();
  });
  addEventListener('resize',()=>{fitDeck();drawDiagram(slides[active])});
  window.__vibePpt={activate,measure,setExportMode,count:slides.length};
  fitDeck();
  activate(0);
})();
`;

export function renderDeckHtml(deck: DeckSpec, brand: BrandProfile, options: HtmlRenderOptions = {}): string {
  const themeName = options.theme ?? deck.theme ?? "dark";
  const theme = brand.themes[themeName];
  const slides = flattenSlides(deck);
  const assetMap = options.assetMap ?? new Map<string, string>();
  const templateId = options.templateId ?? "classic";
  return `<!doctype html>
<html lang="${escapeHtml(deck.meta.language ?? "en")}" data-template-id="${escapeHtml(templateId)}" style="${escapeHtml(themeCss(theme, brand))}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(deck.meta.title)}</title><style>${CSS}.vp-visual-generated{position:absolute}html.vp-export-background [data-ppt-native="text"]::before,html.vp-export-background [data-ppt-native="text"]::after{visibility:visible!important}html.vp-export-background .vp-eyebrow::before{background:var(--accent)!important}${options.templateCss ?? ""}</style></head>
<body class="vp-template-${escapeHtml(templateId)}"><div class="vp-deck">${slides.map((flat) => renderSlide(flat, slides.length, brand, themeName, assetMap)).join("\n")}</div>
<nav class="vp-controls" aria-label="Presentation controls"><button data-prev title="Previous">←</button><span data-counter>01 / ${String(slides.length).padStart(2, "0")}</span><button data-next title="Next">→</button><button data-notes title="Notes">▤</button><button data-fullscreen title="Fullscreen">⛶</button></nav>
<script>${SCRIPT}</script></body></html>`;
}
