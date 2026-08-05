const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const storedTheme = (() => {
  try { return localStorage.getItem("vibeppt-preview-theme"); } catch { return null; }
})();
let previewTheme = new URLSearchParams(location.search).get("theme") === "light" || storedTheme === "light" ? "light" : "dark";

function applyPreviewTheme(theme) {
  previewTheme = theme;
  document.documentElement.dataset.previewTheme = theme;
  $$('[data-preview-theme]').forEach((button) => {
    const active = button.dataset.previewTheme === theme;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $$('[data-theme-image]').forEach((image) => {
    image.src = image.dataset[theme];
    image.alt = `${image.dataset.name || "Template"} · bản ${theme === "light" ? "sáng" : "tối"}`;
  });
  $$('[data-demo-frame]').forEach((frame) => { frame.src = frame.dataset[theme]; });
  $$('[data-demo-link]').forEach((link) => { link.href = link.dataset[theme]; });
  try { localStorage.setItem("vibeppt-preview-theme", theme); } catch {}
}

$$('[data-preview-theme]').forEach((button) => button.addEventListener("click", () => applyPreviewTheme(button.dataset.previewTheme)));
applyPreviewTheme(previewTheme);

const gallery = $("#template-gallery");
if (gallery) {
  const cards = $$("[data-template-card]", gallery);
  const count = $("#template-count");
  $$('[data-filter]').forEach((button) => button.addEventListener("click", () => {
    const filter = button.dataset.filter;
    $$('[data-filter]').forEach((item) => {
      const active = item === button;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-pressed", String(active));
    });
    let visible = 0;
    cards.forEach((card) => {
      const show = filter === "all" || card.dataset.categories.split(" ").includes(filter);
      card.hidden = !show;
      if (show) visible += 1;
    });
    if (count) count.textContent = `${visible} bộ mẫu`;
  }));
}

const previewDialog = $("#template-preview");
if (previewDialog) {
  $$('[data-open-preview]').forEach((button) => button.addEventListener("click", () => {
    const card = button.closest("[data-template-card]");
    const source = $("[data-theme-image]", card);
    $("#preview-image").src = source.src;
    $("#preview-image").alt = source.alt;
    $("#preview-name").textContent = $("h3", card).textContent;
    $("#preview-summary").textContent = $("[data-summary]", card).textContent;
    $("#preview-detail").href = $("[data-detail]", card).href;
    previewDialog.showModal();
  }));
  previewDialog.addEventListener("click", (event) => {
    if (event.target === previewDialog) previewDialog.close();
  });
}

$$('[data-copy]').forEach((button) => button.addEventListener("click", async () => {
  const target = document.querySelector(button.dataset.copy);
  const value = target?.textContent?.trim() || "";
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const area = document.createElement("textarea");
    area.value = value;
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  const original = button.textContent;
  button.textContent = "Đã sao chép";
  setTimeout(() => { button.textContent = original; }, 1600);
}));

$$('[data-year]').forEach((element) => { element.textContent = String(new Date().getFullYear()); });
