const token = new URLSearchParams(location.hash.slice(1)).get("token");
if (!token) {
  document.body.innerHTML = '<main class="screen"><h1>Studio session đã hết hạn.</h1><p>Hãy mở lại VibePPT Studio từ Start Menu.</p></main>';
  throw new Error("Missing Studio session token.");
}

const state = {
  templates: [], filter: "all", theme: "dark", selected: null,
  folderSelectionId: null, sourceSelectionId: null, logoSelectionId: null,
  projectId: null, prompt: "",
};

const $ = (selector) => document.querySelector(selector);
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
  toastTimer = setTimeout(() => element.classList.remove("is-visible"), 3200);
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
  const categories = ["all", "product-launch", "product-demo", "campaign", "brand-story", "case-study", "growth", "sales-proposal", "executive-pitch"];
  $("#filters").innerHTML = categories.map((category) => `<button type="button" data-filter="${category}" class="${state.filter === category ? "is-active" : ""}">${categoryLabel(category)}</button>`).join("");
}

function renderGallery() {
  const templates = state.filter === "all" ? state.templates : state.templates.filter((template) => template.categories.includes(state.filter));
  $("#templateGrid").innerHTML = templates.map((template, index) => `
    <article class="template-card" tabindex="0" role="button" data-template="${template.id}" aria-label="Xem ${template.name}">
      <div class="template-visual"><span class="template-index">${String(index + 1).padStart(2, "0")}</span><img src="${template.preview[state.theme]}" alt="Preview ${template.name} ${state.theme}" loading="lazy"></div>
      <div class="template-body"><h3>${template.name}</h3><p>${template.summary}</p><div class="tags">${template.moods.map((mood) => `<span>${mood}</span>`).join("")}</div></div>
    </article>`).join("");
}

function openPreview(template) {
  state.selected = template;
  $("#dialogImage").src = template.preview[state.theme];
  $("#dialogImage").alt = `Preview ${template.name}`;
  $("#dialogEyebrow").textContent = template.categories.map(categoryLabel).join(" · ");
  $("#dialogTitle").textContent = template.name;
  $("#dialogSummary").textContent = template.summary;
  $("#storyFlow").innerHTML = template.storyRecipe.map((step, index) => `<div class="story-step"><b>${String(index + 1).padStart(2, "0")}</b><span>${step.purpose}</span></div>`).join("");
  if (!$("#previewDialog").open) $("#previewDialog").showModal();
}

function selectTemplate() {
  const template = state.selected;
  if (!template) return;
  $("#previewDialog").close();
  $("#selectedTemplate").innerHTML = `<img src="${template.preview[state.theme]}" alt="${template.name}"><div><p class="eyebrow">Template đã chọn</p><h3>${template.name}</h3><p>${template.summary}</p></div>`;
  $("#galleryScreen").classList.add("is-hidden");
  $("#briefScreen").classList.remove("is-hidden");
  scrollTo({ top: 0, behavior: "smooth" });
}

async function pick(kind) {
  const endpoint = kind === "folder" ? "/api/dialog/folder" : "/api/dialog/files";
  const result = await api(endpoint, { method: "POST", body: kind === "folder" ? "{}" : JSON.stringify({ kind }) });
  if (!result) return;
  if (kind === "folder") {
    state.folderSelectionId = result.id;
    $("#folderLabel").textContent = result.displayPath;
  } else if (kind === "sources") {
    state.sourceSelectionId = result.id;
    $("#sourcesLabel").textContent = result.files.join(", ");
  } else {
    state.logoSelectionId = result.id;
    $("#logoLabel").textContent = result.files.join(", ");
  }
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

async function copyPrompt() {
  try {
    await navigator.clipboard.writeText(state.prompt);
  } catch {
    const area = document.createElement("textarea");
    area.value = state.prompt;
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
}

async function openProject() {
  try {
    await copyPrompt();
    await api("/api/projects/open", { method: "POST", body: JSON.stringify({ projectId: state.projectId }) });
    toast("Đã mở VS Code và copy prompt. Mở Codex rồi nhấn Ctrl+V.");
  } catch (error) { toast(error.message); }
}

function reset() {
  state.selected = null;
  state.folderSelectionId = state.sourceSelectionId = state.logoSelectionId = state.projectId = null;
  $("#briefForm").reset();
  $("#folderLabel").textContent = "Chưa chọn thư mục";
  $("#sourcesLabel").textContent = "Có thể chọn PPTX, PDF, Word, Excel và hình ảnh";
  $("#logoLabel").textContent = "Tùy chọn · giữ palette của template";
  $("#successScreen").classList.add("is-hidden");
  $("#galleryScreen").classList.remove("is-hidden");
  scrollTo({ top: 0, behavior: "smooth" });
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
$("#quitButton").addEventListener("click", async () => { await api("/api/shutdown", { method: "POST", body: "{}" }).catch(() => {}); window.close(); });

try {
  state.templates = await api("/api/templates");
  renderFilters();
  renderGallery();
} catch (error) { toast(error.message); }
