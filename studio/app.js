const token = new URLSearchParams(location.hash.slice(1)).get("token");
if (!token) {
  document.body.innerHTML = '<main class="screen"><h1>Studio session đã hết hạn.</h1><p>Hãy mở lại VibePPT Studio từ Start Menu.</p></main>';
  throw new Error("Missing Studio session token.");
}

const THEME_KEYS = ["bg", "bgDeep", "panel", "panelSoft", "ink", "muted", "line", "accent", "accent2", "accent3", "good", "warn"];
const state = {
  templates: [], brands: [], fonts: [], workshop: null,
  filter: "all", theme: "dark", selected: null,
  folderSelectionId: null, sourceSelectionId: null, logoSelectionId: null,
  projectId: null, prompt: "",
  brand: { profile: null, templateId: null, baseBrandId: null, lightLogoSelectionId: null, darkLogoSelectionId: null, previewTimer: null },
};

const $ = (selector) => document.querySelector(selector);
const h = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const clone = (value) => structuredClone(value);
const api = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", "X-VibePPT-Session": token, ...(options.headers || {}) },
  });
  if (response.status === 204) return null;
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Studio request failed.");
  return body;
};

let toastTimer;
function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove("is-visible"), 3600);
}

function categoryLabel(value) {
  const labels = {
    all: "Tất cả", "product-launch": "Launch", "product-demo": "Product demo", pitch: "Pitch",
    campaign: "Campaign", "go-to-market": "Go-to-market", "brand-story": "Brand story",
    "company-profile": "Company profile", "case-study": "Case study", "customer-proof": "Customer proof",
    growth: "Growth", traction: "Traction", "marketing-report": "Report", "sales-proposal": "Proposal",
    solution: "Solution", commercial: "Commercial", "executive-pitch": "Executive", strategy: "Strategy",
    proposal: "Proposal", saas: "SaaS", sales: "Sales", launch: "Launch", "thought-leadership": "Thought leadership",
  };
  return labels[value] || value.replaceAll("-", " ");
}

function renderFilters() {
  const preferred = ["all", "product-launch", "product-demo", "campaign", "brand-story", "case-study", "growth", "sales-proposal", "executive-pitch"];
  const available = new Set(state.templates.flatMap((template) => template.categories));
  const categories = preferred.filter((category) => category === "all" || available.has(category));
  $("#filters").innerHTML = categories.map((category) => `<button type="button" data-filter="${h(category)}" class="${state.filter === category ? "is-active" : ""}">${h(categoryLabel(category))}</button>`).join("");
}

function renderGallery() {
  const templates = state.filter === "all" ? state.templates : state.templates.filter((template) => template.categories.includes(state.filter));
  $("#templateGrid").innerHTML = templates.map((template, index) => `
    <article class="template-card" tabindex="0" role="button" data-template="${h(template.id)}" aria-label="Xem ${h(template.name)}">
      <div class="template-visual"><span class="template-index">${String(index + 1).padStart(2, "0")}</span><img src="${h(template.preview[state.theme])}" alt="Preview ${h(template.name)} ${state.theme}" loading="lazy"></div>
      <div class="template-body">${template.origin === "customer-kit" ? `<span class="origin-badge">${h(template.kitName || "Customer Kit")}</span>` : ""}<h3>${h(template.name)}</h3><p>${h(template.summary)}</p><div class="tags">${template.moods.map((mood) => `<span>${h(mood)}</span>`).join("")}</div></div>
    </article>`).join("");
}

function renderBrandSelect() {
  const selected = $("#brandSelect").value;
  $("#brandSelect").innerHTML = `<option value="">Mặc định của template</option>${state.brands.map((brand) => `<option value="${h(brand.id)}">${h(brand.name)}${brand.kitName ? ` · ${h(brand.kitName)}` : ""}</option>`).join("")}`;
  if (state.brands.some((brand) => brand.id === selected)) $("#brandSelect").value = selected;
}

function openPreview(template) {
  state.selected = template;
  $("#dialogImage").src = template.preview[state.theme];
  $("#dialogImage").alt = `Preview ${template.name}`;
  $("#dialogEyebrow").textContent = template.categories.map(categoryLabel).join(" · ");
  $("#dialogTitle").textContent = template.name;
  $("#dialogSummary").textContent = template.summary;
  $("#storyFlow").innerHTML = template.storyRecipe.map((step, index) => `<div class="story-step"><b>${String(index + 1).padStart(2, "0")}</b><span>${h(step.purpose)}</span></div>`).join("");
  if (!$("#previewDialog").open) $("#previewDialog").showModal();
}

function selectTemplate() {
  const template = state.selected;
  if (!template) return;
  $("#previewDialog").close();
  $("#selectedTemplate").innerHTML = `<img src="${h(template.preview[state.theme])}" alt="${h(template.name)}"><div><p class="eyebrow">Template đã chọn</p><h3>${h(template.name)}</h3><p>${h(template.summary)}</p></div>`;
  $("#galleryScreen").classList.add("is-hidden");
  $("#briefScreen").classList.remove("is-hidden");
  scrollTo({ top: 0, behavior: "smooth" });
}

async function pick(kind) {
  const endpoint = kind === "folder" ? "/api/dialog/folder" : "/api/dialog/files";
  const result = await api(endpoint, { method: "POST", body: kind === "folder" ? "{}" : JSON.stringify({ kind }) });
  if (!result) return null;
  if (kind === "folder") {
    state.folderSelectionId = result.id;
    $("#folderLabel").textContent = result.displayPath;
  } else if (kind === "sources") {
    state.sourceSelectionId = result.id;
    $("#sourcesLabel").textContent = result.files.join(", ");
  } else if (kind === "logo") {
    state.logoSelectionId = result.id;
    $("#logoLabel").textContent = result.files.join(", ");
  }
  return result;
}

async function createProject(event) {
  event.preventDefault();
  if (!state.folderSelectionId) return toast("Hãy chọn thư mục chứa project.");
  const button = event.submitter;
  button.disabled = true;
  button.firstChild.textContent = "Đang tạo project ";
  try {
    const data = new FormData(event.currentTarget);
    const result = await api("/api/projects", {
      method: "POST",
      body: JSON.stringify({
        folderSelectionId: state.folderSelectionId,
        sourceSelectionId: state.sourceSelectionId,
        logoSelectionId: state.logoSelectionId,
        templateId: state.selected.id,
        brandId: data.get("brandId"),
        theme: state.theme,
        brief: {
          projectName: data.get("projectName"), title: data.get("title"), goal: data.get("goal"), audience: data.get("audience"),
          durationMinutes: Number(data.get("durationMinutes")), language: data.get("language"),
        },
      }),
    });
    state.projectId = result.projectId;
    state.prompt = result.prompt;
    $("#projectPath").textContent = result.projectPath;
    $("#promptText").textContent = result.prompt;
    $("#briefScreen").classList.add("is-hidden");
    $("#successScreen").classList.remove("is-hidden");
    scrollTo({ top: 0, behavior: "smooth" });
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
    button.firstChild.textContent = "Tạo project ";
  }
}

async function copyText(value) {
  try { await navigator.clipboard.writeText(value); }
  catch {
    const area = document.createElement("textarea"); area.value = value; document.body.append(area); area.select(); document.execCommand("copy"); area.remove();
  }
}

async function openProject() {
  try {
    await copyText(state.prompt);
    await api("/api/projects/open", { method: "POST", body: JSON.stringify({ projectId: state.projectId }) });
    toast("Đã mở VS Code và copy prompt. Mở Codex rồi nhấn Ctrl+V.");
  } catch (error) { toast(error.message); }
}

function reset() {
  state.selected = null;
  state.folderSelectionId = state.sourceSelectionId = state.logoSelectionId = state.projectId = null;
  $("#briefForm").reset();
  renderBrandSelect();
  $("#folderLabel").textContent = "Chưa chọn thư mục";
  $("#sourcesLabel").textContent = "Có thể chọn PPTX, PDF, Word, Excel và hình ảnh";
  $("#logoLabel").textContent = "Tùy chọn · dùng một logo cho cả hai theme";
  $("#successScreen").classList.add("is-hidden");
  $("#galleryScreen").classList.remove("is-hidden");
  scrollTo({ top: 0, behavior: "smooth" });
}

function candidateCard(candidate, label) {
  return `<button type="button" data-candidate="${h(label)}"><img src="${h(candidate.image)}" alt=""><span>${h(candidate.deckId)} · ${candidate.slideIndex}</span></button>`;
}

function renderWorkshop() {
  if (!state.workshop) return;
  $("#galleryScreen").classList.add("is-hidden");
  $("#workshopScreen").classList.remove("is-hidden");
  const { catalog, selection } = state.workshop;
  const shortlist = state.workshop.shortlist?.length ? new Set(state.workshop.shortlist) : null;
  const visibleDecks = catalog.decks.filter((deck) => deck.status === "ready" && (!shortlist || shortlist.has(deck.id)));
  $("#workshopTitle").textContent = selection?.pack?.name || catalog.name;
  $("#openWorkshop").innerHTML = selection ? "Mở Codex để dựng pack <span>↗</span>" : "Mở Codex để tự tuyển <span>↗</span>";
  $("#workshopSummary").textContent = selection
    ? `${selection.layouts.length} layout đã được Codex tuyển. Có thể thay bằng hai phương án dự phòng trước khi dựng lại.`
    : shortlist
      ? `${visibleDecks.length}/${catalog.decks.length} deck đã vào shortlist. Mở Codex để chọn visual grammar và 12 layout cốt lõi.`
      : `${visibleDecks.length}/${catalog.decks.length} deck đã index. Mở Codex để chọn visual grammar và 12 layout cốt lõi.`;
  $("#saveSelection").classList.toggle("is-hidden", !selection);
  if (!selection) {
    $("#workshopGrid").innerHTML = visibleDecks.map((deck) => `<article class="workshop-card"><img src="${h(deck.sampleImages[0] || "")}" alt=""><div class="workshop-card-body"><span class="origin-badge">${h(deck.themeHint || "reference")}</span><h3>${h(deck.category)}</h3><p>${h(deck.name)} · ${deck.slideCount} slides</p><div class="workshop-score"><span>${deck.stats.shapes} shapes</span><span>${deck.stats.charts} charts</span></div></div></article>`).join("");
    return;
  }
  $("#workshopGrid").innerHTML = selection.layouts.map((layout, layoutIndex) => `<article class="workshop-card" data-layout-index="${layoutIndex}"><img src="${h(layout.selected.image)}" alt=""><div class="workshop-card-body"><span class="origin-badge">${h(layout.kind)}</span><h3>${h(layout.name)}</h3><p>${h(layout.selected.rationale)}</p><div class="workshop-score"><span>${h(layout.selected.deckId)} · ${layout.selected.slideIndex}</span><strong>${layout.selected.score.total}/100</strong></div><div class="alternative-strip">${layout.alternatives.map((candidate, candidateIndex) => candidateCard(candidate, `${layoutIndex}:${candidateIndex}`)).join("")}</div></div></article>`).join("");
}

function overrideCandidate(raw) {
  const [layoutIndex, alternativeIndex] = raw.split(":").map(Number);
  const layout = state.workshop?.selection?.layouts?.[layoutIndex];
  const alternative = layout?.alternatives?.[alternativeIndex];
  if (!layout || !alternative) return;
  layout.alternatives[alternativeIndex] = layout.selected;
  layout.selected = alternative;
  renderWorkshop();
}

async function saveWorkshopSelection() {
  try {
    await api("/api/workshop/selection", { method: "POST", body: JSON.stringify({ selection: state.workshop.selection }) });
    toast("Đã lưu lựa chọn. Có thể mở Codex để dựng lại pack.");
  } catch (error) { toast(error.message); }
}

async function openWorkshop() {
  try {
    const result = await api("/api/workshop/open", { method: "POST", body: "{}" });
    await copyText(result.prompt);
    toast("Đã mở Workshop trong VS Code và copy prompt cho Codex.");
  } catch (error) { toast(error.message); }
}

function brandFromTemplate(template) {
  const profile = clone(template.defaultBrand);
  profile.id = "customer-brand";
  profile.name = "Customer Brand";
  state.brand.profile = profile;
  state.brand.templateId = template.id;
  state.brand.baseBrandId = null;
  state.brand.lightLogoSelectionId = state.brand.darkLogoSelectionId = null;
  renderBrandFields();
}

function renderAdvancedTokens() {
  const profile = state.brand.profile;
  $("#advancedTokens").innerHTML = `<div class="token-grid">${["light", "dark"].map((theme) => `<section class="token-group"><h4>${theme}</h4>${THEME_KEYS.map((key) => `<label class="token-input"><span>${h(key)}</span><input type="color" data-brand-theme="${theme}" data-brand-token="${key}" value="${h(profile.themes[theme][key])}"></label>`).join("")}</section>`).join("")}</div>`;
}

function renderBrandFields() {
  const profile = state.brand.profile;
  if (!profile) return;
  $("#brandProfileId").value = profile.id;
  $("#brandName").value = profile.name;
  $("#brandDisplayFont").value = profile.fonts.display;
  $("#brandBodyFont").value = profile.fonts.body;
  $("#brandFallbackFont").value = profile.fonts.fallback || "Arial";
  $("#brandRadius").value = profile.style?.radius ?? 20;
  $("#brandAccent").value = profile.themes[$("#brandTheme").value].accent;
  $("#brandAccent2").value = profile.themes[$("#brandTheme").value].accent2;
  $("#brandAccent3").value = profile.themes[$("#brandTheme").value].accent3;
  $("#brandVisualDirection").value = profile.style?.visualDirection || "";
  $("#brandImagePrompt").value = profile.style?.imagePromptPrefix || "";
  $("#brandLogoLightLabel").textContent = state.brand.lightLogoSelectionId ? "Đã chọn logo mới" : profile.logos?.light || profile.logo || "Chưa chọn";
  $("#brandLogoDarkLabel").textContent = state.brand.darkLogoSelectionId ? "Đã chọn logo mới" : profile.logos?.dark || profile.logo || "Chưa chọn";
  renderAdvancedTokens();
  scheduleBrandPreview();
}

function readBrandFields() {
  const profile = state.brand.profile;
  profile.id = $("#brandProfileId").value.trim();
  profile.name = $("#brandName").value.trim();
  profile.fonts = { display: $("#brandDisplayFont").value.trim(), body: $("#brandBodyFont").value.trim(), fallback: $("#brandFallbackFont").value.trim() || "Arial" };
  profile.style = { ...(profile.style || {}), radius: Number($("#brandRadius").value), visualDirection: $("#brandVisualDirection").value.trim(), imagePromptPrefix: $("#brandImagePrompt").value.trim() };
  return profile;
}

function scheduleBrandPreview() {
  clearTimeout(state.brand.previewTimer);
  state.brand.previewTimer = setTimeout(async () => {
    try {
      const result = await api("/api/brand-previews", { method: "POST", body: JSON.stringify({
        brand: readBrandFields(), templateId: state.brand.templateId, baseBrandId: state.brand.baseBrandId,
        theme: $("#brandTheme").value, lightLogoSelectionId: state.brand.lightLogoSelectionId, darkLogoSelectionId: state.brand.darkLogoSelectionId,
      }) });
      $("#brandPreview").src = result.url;
    } catch (error) { toast(error.message); }
  }, 240);
}

function openBrandEditor() {
  const template = state.selected || state.templates[0];
  if (!template) return toast("Chưa có template để preview brand.");
  $("#brandTemplate").innerHTML = state.templates.map((item) => `<option value="${h(item.id)}">${h(item.name)}</option>`).join("");
  $("#brandTemplate").value = template.id;
  brandFromTemplate(template);
  if (!$("#brandDialog").open) $("#brandDialog").showModal();
}

async function pickBrandLogo(theme) {
  const result = await api("/api/dialog/files", { method: "POST", body: JSON.stringify({ kind: "logo" }) });
  if (!result) return;
  state.brand[theme === "light" ? "lightLogoSelectionId" : "darkLogoSelectionId"] = result.id;
  $(theme === "light" ? "#brandLogoLightLabel" : "#brandLogoDarkLabel").textContent = result.files.join(", ");
  scheduleBrandPreview();
}

async function saveBrand(event) {
  event.preventDefault();
  try {
    const result = await api("/api/brands", { method: "POST", body: JSON.stringify({
      brand: readBrandFields(), templateId: state.brand.templateId, baseBrandId: state.brand.baseBrandId,
      lightLogoSelectionId: state.brand.lightLogoSelectionId, darkLogoSelectionId: state.brand.darkLogoSelectionId,
      force: $("#brandForce").checked,
    }) });
    state.brands = await api("/api/brands");
    renderBrandSelect();
    $("#brandSelect").value = result.id;
    toast(`Đã lưu brand profile ${result.id}.`);
  } catch (error) { toast(error.message); }
}

async function installKit() {
  try {
    const picked = await api("/api/dialog/files", { method: "POST", body: JSON.stringify({ kind: "kit" }) });
    if (!picked) return;
    let kit;
    try {
      kit = await api("/api/kits/install", { method: "POST", body: JSON.stringify({ selectionId: picked.id }) });
    } catch (error) {
      if (!error.message.includes("already installed") || !confirm("Customer Kit này đã có. Cập nhật bằng file vừa chọn?")) throw error;
      kit = await api("/api/kits/install", { method: "POST", body: JSON.stringify({ selectionId: picked.id, force: true }) });
    }
    [state.templates, state.brands] = await Promise.all([api("/api/templates"), api("/api/brands")]);
    renderFilters(); renderGallery(); renderBrandSelect();
    toast(`Đã cài Customer Kit: ${kit.name}.`);
  } catch (error) { toast(error.message); }
}

$("#filters").addEventListener("click", (event) => { const button = event.target.closest("[data-filter]"); if (!button) return; state.filter = button.dataset.filter; renderFilters(); renderGallery(); });
$(".theme-switch").addEventListener("click", (event) => { const button = event.target.closest("[data-theme]"); if (!button) return; state.theme = button.dataset.theme; document.querySelectorAll("[data-theme]").forEach((item) => item.classList.toggle("is-active", item === button)); renderGallery(); if (state.selected && $("#previewDialog").open) openPreview(state.selected); });
$("#templateGrid").addEventListener("click", (event) => { const card = event.target.closest("[data-template]"); if (card) openPreview(state.templates.find((item) => item.id === card.dataset.template)); });
$("#templateGrid").addEventListener("keydown", (event) => { if (!["Enter", " "].includes(event.key)) return; const card = event.target.closest("[data-template]"); if (card) { event.preventDefault(); openPreview(state.templates.find((item) => item.id === card.dataset.template)); } });
$("#closePreview").addEventListener("click", () => $("#previewDialog").close());
$("#useTemplate").addEventListener("click", selectTemplate);
$("#backToGallery").addEventListener("click", () => { $("#briefScreen").classList.add("is-hidden"); $("#galleryScreen").classList.remove("is-hidden"); });
$("#pickFolder").addEventListener("click", () => pick("folder").catch((error) => toast(error.message)));
$("#pickSources").addEventListener("click", () => pick("sources").catch((error) => toast(error.message)));
$("#pickLogo").addEventListener("click", () => pick("logo").catch((error) => toast(error.message)));
$("#briefForm").addEventListener("submit", createProject);
$("#openProject").addEventListener("click", openProject);
$("#newProject").addEventListener("click", reset);
$("#openWorkshop").addEventListener("click", openWorkshop);
$("#saveSelection").addEventListener("click", saveWorkshopSelection);
$("#workshopGrid").addEventListener("click", (event) => { const button = event.target.closest("[data-candidate]"); if (button) overrideCandidate(button.dataset.candidate); });
$("#brandButton").addEventListener("click", openBrandEditor);
$("#closeBrand").addEventListener("click", () => $("#brandDialog").close());
$("#installKitButton").addEventListener("click", installKit);
$("#brandTemplate").addEventListener("change", () => brandFromTemplate(state.templates.find((template) => template.id === $("#brandTemplate").value)));
$("#brandTheme").addEventListener("change", renderBrandFields);
$("#pickBrandLogoLight").addEventListener("click", () => pickBrandLogo("light"));
$("#pickBrandLogoDark").addEventListener("click", () => pickBrandLogo("dark"));
$("#brandForm").addEventListener("submit", saveBrand);
$("#brandForm").addEventListener("input", (event) => {
  if (!state.brand.profile) return;
  const tokenInput = event.target.closest("[data-brand-token]");
  if (tokenInput) state.brand.profile.themes[tokenInput.dataset.brandTheme][tokenInput.dataset.brandToken] = tokenInput.value;
  if (["brandAccent", "brandAccent2", "brandAccent3"].includes(event.target.id)) {
    const key = event.target.id.replace("brandA", "a");
    state.brand.profile.themes.light[key] = event.target.value;
    state.brand.profile.themes.dark[key] = event.target.value;
    renderAdvancedTokens();
  }
  scheduleBrandPreview();
});
$("#quitButton").addEventListener("click", async () => { await api("/api/shutdown", { method: "POST", body: "{}" }).catch(() => {}); window.close(); });

try {
  [state.templates, state.brands, state.fonts, state.workshop] = await Promise.all([api("/api/templates"), api("/api/brands"), api("/api/fonts"), api("/api/workshop")]);
  $("#fontList").innerHTML = state.fonts.map((font) => `<option value="${h(font)}"></option>`).join("");
  renderFilters(); renderGallery(); renderBrandSelect();
  if (state.workshop) renderWorkshop();
} catch (error) { toast(error.message); }
