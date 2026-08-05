#!/usr/bin/env node
import { createServer } from "node:http";
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderDeckHtml } from "../dist/html.js";
import { formatIssues, hasErrors, loadProject } from "../dist/model.js";
import { listTemplates } from "../dist/templates.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "site");
const categoryLabels = {
  "product-launch": "Ra mắt", "product-demo": "Demo sản phẩm", campaign: "Chiến dịch", "brand-story": "Câu chuyện thương hiệu",
  "case-study": "Tình huống thực tế", growth: "Tăng trưởng", "sales-proposal": "Đề xuất bán hàng", "executive-pitch": "Điều hành",
  "go-to-market": "Tiếp cận thị trường", launch: "Ra mắt", "company-profile": "Hồ sơ công ty", "thought-leadership": "Góc nhìn chuyên gia",
  strategy: "Chiến lược", proposal: "Đề xuất", pitch: "Thuyết trình", traction: "Đà tăng trưởng", "marketing-report": "Báo cáo tiếp thị",
  "customer-proof": "Bằng chứng khách hàng", sales: "Bán hàng", solution: "Giải pháp", commercial: "Thương mại", saas: "SaaS",
};
const filterCategories = ["product-launch", "product-demo", "campaign", "brand-story", "case-study", "growth", "sales-proposal", "executive-pitch"];
const moodLabels = {
  bold: "đậm nét", playful: "sống động", energetic: "giàu năng lượng", editorial: "biên tập", human: "gần gũi", crafted: "chỉn chu",
  minimal: "tối giản", premium: "cao cấp", calm: "điềm tĩnh", cinematic: "điện ảnh", data: "dữ liệu", confident: "tự tin",
  forward: "hướng tới trước", credible: "đáng tin", "evidence-led": "theo bằng chứng", structured: "có cấu trúc",
  professional: "chuyên nghiệp", precise: "chính xác", clean: "thoáng", modern: "hiện đại", trustworthy: "đáng tin cậy",
};
const templateCopy = {
  "bold-campaign": "Bố cục chiến dịch giàu năng lượng, ưu tiên một thông điệp lớn và cách triển khai qua nhiều điểm chạm.",
  "editorial-brand-story": "Nhịp kể biên tập dành cho câu chuyện thương hiệu, hồ sơ công ty và nội dung tư duy dẫn dắt.",
  "executive-minimal": "Deck điều hành tối giản, tập trung vào quyết định, bằng chứng và bước tiếp theo.",
  "launch-signal": "Phong cách ra mắt điện ảnh với hook rõ, khoảnh khắc sản phẩm lớn và đoạn kết dứt khoát.",
  "momentum-growth": "Hệ bố cục cho tăng trưởng, funnel và traction với dữ liệu là trung tâm của câu chuyện.",
  "proof-case-study": "Case study dựa trên bối cảnh, can thiệp và bằng chứng thay vì lời chứng thực chung chung.",
  "proposal-grid": "Đề xuất bán hàng có cấu trúc rõ giữa mục tiêu, giải pháp, phạm vi và cách bàn giao.",
  "saas-clarity": "Bộ slide SaaS sáng rõ, đi từ quy trình thực tế tới sản phẩm, mức độ phù hợp và hành động tiếp theo.",
};
const storyCopy = {
  "campaign-line": ["Thông điệp trung tâm", "Mở đầu bằng câu duy nhất thị trường cần nhớ."],
  "audience-tension": ["Sức căng người xem", "Nêu hành vi hoặc mâu thuẫn khách hàng đang gặp."],
  "big-idea": ["Ý tưởng lớn", "Đưa ý tưởng chiến dịch vào một khung hình rõ ràng."],
  channels: ["Điểm chạm", "Cho thấy ý tưởng thích nghi qua từng kênh."],
  flight: ["Nhịp chiến dịch", "Sắp xếp giai đoạn gợi mở, ra mắt và duy trì."],
  measure: ["Đo lường", "Chỉ rõ tín hiệu nào quyết định thành công."],
  thesis: ["Luận điểm", "Mở bằng niềm tin định nghĩa thương hiệu."],
  origin: ["Khởi nguồn", "Giải thích vấn đề đã tạo ra công ty hoặc sản phẩm."],
  people: ["Con người", "Cho thấy hành vi thật phía sau câu chuyện thương hiệu."],
  principles: ["Nguyên tắc", "Biến giá trị thành các lựa chọn có thể quan sát."],
  proof: ["Bằng chứng", "Chứng minh luận điểm bằng tình huống và nguồn cụ thể."],
  future: ["Chương tiếp theo", "Mời người xem bước vào hướng phát triển kế tiếp."],
  decision: ["Quyết định", "Nêu chính xác quyết định cần được đưa ra."],
  context: ["Bối cảnh", "Nén bối cảnh thành một nhận định chi phối toàn bài."],
  options: ["Phương án", "Làm rõ các lựa chọn và đánh đổi thật sự."],
  evidence: ["Dữ liệu", "Chỉ dùng những con số thực sự ảnh hưởng quyết định."],
  path: ["Lộ trình", "Làm rõ trình tự, trách nhiệm và điểm kiểm tra."],
  ask: ["Đề nghị", "Kết bằng phê duyệt hoặc hành động cụ thể cần có."],
  hook: ["Hook", "Gọi tên thay đổi bằng một câu dễ nhớ."],
  tension: ["Vấn đề", "Cho thấy vì sao cách hiện tại không còn đủ."],
  "product-moment": ["Khoảnh khắc sản phẩm", "Demo đúng thao tác làm thay đổi quy trình."],
  value: ["Giá trị", "Chuyển khả năng sản phẩm thành lợi ích của người xem."],
  "next-step": ["Bước tiếp theo", "Kết thúc bằng một hành động rõ ràng."],
  "growth-thesis": ["Luận điểm tăng trưởng", "Nêu động lực đang tạo ra đà tăng trưởng."],
  baseline: ["Đường cơ sở", "Cho thấy xu hướng cùng khoảng thời gian đo."],
  drivers: ["Động lực", "Tách tín hiệu dẫn dắt khỏi kết quả đến sau."],
  funnel: ["Funnel", "Giải thích cách nhu cầu trở thành giá trị được giữ lại."],
  economics: ["Hiệu quả thương mại", "Tập trung vào vài tỷ lệ kinh tế quan trọng."],
  bets: ["Cược tăng trưởng", "Nêu thử nghiệm tiếp theo và điều kiện đi tiếp."],
  result: ["Kết quả", "Mở bằng kết quả có nguồn và bối cảnh khách hàng."],
  constraints: ["Ràng buộc", "Làm rõ môi trường và giới hạn thực tế."],
  intervention: ["Can thiệp", "Giải thích điều gì đã thay đổi và điều gì không."],
  transfer: ["Khả năng áp dụng", "Nêu điều một khách hàng khác có thể thử tiếp."],
  "customer-goal": ["Mục tiêu khách hàng", "Mở bằng thay đổi khách hàng muốn đạt được."],
  "current-state": ["Hiện trạng", "Phản ánh đúng vấn đề và ràng buộc đã hiểu."],
  solution: ["Giải pháp", "Cho thấy các thành phần phối hợp với nhau thế nào."],
  scope: ["Phạm vi", "Tách rõ phần bao gồm, giả định và loại trừ."],
  delivery: ["Bàn giao", "Định nghĩa giai đoạn, người chịu trách nhiệm và tiêu chí nhận."],
  promise: ["Kết quả sản phẩm", "Nói kết quả bằng ngôn ngữ đơn giản."],
  workflow: ["Quy trình", "Đặt cách làm hiện tại cạnh cách làm sau thay đổi."],
  product: ["Sản phẩm thật", "Neo câu chuyện vào giao diện và thao tác thật."],
  capability: ["Khả năng", "Nhóm tính năng theo công việc của khách hàng."],
  fit: ["Mức phù hợp", "Làm rõ khả năng áp dụng và tích hợp."],
  action: ["Hành động", "Đề xuất walkthrough hoặc pilot có trọng tâm."],
};

const e = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const titleCase = (value) => value.replaceAll("-", " ").replace(/\b\w/g, (char) => char.toUpperCase());
const flag = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};

function siteUrl() {
  const value = process.env.VIBEPPT_SITE_URL?.trim().replace(/\/$/, "");
  if (!value) return "";
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol) || url.pathname !== "/") throw new Error("VIBEPPT_SITE_URL must be an http(s) origin without a path.");
  return value;
}

function header() {
  return `<a class="skip-link" href="#main">Bỏ qua điều hướng</a>
  <header class="site-header">
    <a class="brand" href="/" aria-label="VibePPT · Trang chủ"><span class="brand-mark">V</span><span class="brand-copy"><b>VibePPT</b><small>Hệ thống trình chiếu</small></span></a>
    <nav class="site-nav" aria-label="Điều hướng chính"><a href="/#templates">Bộ mẫu</a><a href="/#workflow">Cách hoạt động</a><a href="/docs/">Hướng dẫn</a><a class="nav-cta" href="https://github.com/Thanh25102/vibeppt">GitHub ↗</a></nav>
  </header>`;
}

function footer() {
  return `<footer class="site-footer"><div class="footer-copy"><a class="brand" href="/"><span class="brand-mark">V</span><span class="brand-copy"><b>VibePPT</b><small>Chạy tại máy</small></span></a><p>Công khai mã nguồn theo PolyForm Shield 1.0.0 · Bản quyền © <span data-year>2026</span> Bùi Mạnh Thành. Không có tài liệu nào được tải lên qua website giới thiệu này.</p></div><nav class="footer-links" aria-label="Điều hướng cuối trang"><a href="/docs/">Hướng dẫn</a><a href="/privacy/">Quyền riêng tư</a><a href="https://github.com/Thanh25102/vibeppt/releases">Bản phát hành</a><a href="https://github.com/Thanh25102/vibeppt">Mã nguồn</a></nav></footer>`;
}

function page({ title, description, body, canonical = "", image = "/previews/launch-signal/dark.webp", pageClass = "" }) {
  const origin = siteUrl();
  const canonicalTag = origin && canonical ? `<link rel="canonical" href="${e(origin + canonical)}">` : "";
  const imageTag = origin ? `<meta property="og:image" content="${e(origin + image)}">` : "";
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#08090c"><title>${e(title)}</title><meta name="description" content="${e(description)}">${canonicalTag}<meta property="og:type" content="website"><meta property="og:title" content="${e(title)}"><meta property="og:description" content="${e(description)}">${imageTag}<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/assets/styles.css"><script src="/assets/app.js" defer></script></head><body class="${e(pageClass)}">${header()}<main id="main">${body}</main>${footer()}</body></html>`;
}

function previewImage(profile, className = "") {
  return `<img class="${className}" data-theme-image data-name="${e(profile.name)}" data-dark="/previews/${e(profile.id)}/dark.webp" data-light="/previews/${e(profile.id)}/light.webp" src="/previews/${e(profile.id)}/dark.webp" alt="${e(profile.name)} · bản tối">`;
}

function themeSwitch() {
  return `<div class="theme-switch" role="group" aria-label="Giao diện của bộ mẫu"><button type="button" data-preview-theme="light" aria-pressed="false">Sáng</button><button class="is-active" type="button" data-preview-theme="dark" aria-pressed="true">Tối</button></div>`;
}

function templateCard(profile, index) {
  const summary = templateCopy[profile.id] ?? profile.summary;
  return `<article class="template-card reveal" data-template-card data-categories="${e(profile.categories.join(" "))}">
    <button class="template-visual" type="button" data-open-preview aria-label="Xem nhanh ${e(profile.name)}"><span class="template-index">${String(index + 1).padStart(2, "0")}</span>${previewImage(profile)}</button>
    <div class="template-body"><h3>${e(profile.name)}</h3><p data-summary>${e(summary)}</p><div class="tag-row">${profile.moods.map((mood) => `<span class="tag">${e(moodLabels[mood] ?? mood)}</span>`).join("")}</div><div class="template-footer"><span class="template-count">8 slide · sáng/tối</span><a data-detail href="/templates/${e(profile.id)}/">Xem chi tiết →</a></div></div>
  </article>`;
}

function homePage(profiles) {
  const filters = [["all", "Tất cả"], ...filterCategories.map((category) => [category, categoryLabels[category]])];
  const [launch, editorial, proposal] = ["launch-signal", "editorial-brand-story", "proposal-grid"].map((id) => profiles.find((item) => item.id === id));
  const body = `<section class="shell hero"><div class="hero-copy"><p class="eyebrow">Dành cho Codex · HTML + PPTX + QA</p><h1 class="display">Xem slide trước.<br><em>Tin lời giới thiệu sau.</em></h1><p class="lede">Đây là đầu ra thật từ VibePPT. Mỗi bộ mẫu bên dưới có tám slide, hai giao diện và chế độ trình chiếu trực tiếp—không phải ảnh dàn dựng.</p><div class="hero-actions"><a class="button primary" href="#templates">Xem 8 bộ mẫu <span>↓</span></a><a class="button" href="/docs/">Cách cài đặt</a></div></div><div class="hero-proof" aria-label="Ba bảng xem tổng thể thật từ VibePPT"><figure class="hero-sheet one">${previewImage(launch)}</figure><figure class="hero-sheet two">${previewImage(editorial)}</figure><figure class="hero-sheet three">${previewImage(proposal)}</figure><div class="proof-chip"><i></i> Kết xuất thật · không phải ảnh dựng</div></div></section>
  <section class="shell"><div class="fact-strip" aria-label="Thông tin đã kiểm chứng"><div class="fact"><b>8</b><span>hệ thống bộ mẫu nguyên bản</span></div><div class="fact"><b>16</b><span>bản xem trước sáng và tối</span></div><div class="fact"><b>4</b><span>loại đầu ra: HTML, PPTX, PNG, QA</span></div><div class="fact"><b>0</b><span>tệp được tải lên website</span></div></div></section>
  <section class="section" id="templates"><div class="shell"><div class="section-head reveal"><div><p class="eyebrow">01 · Hệ thống bộ mẫu</p><h2 class="section-title">Không chỉ đổi màu.<br>Mỗi bộ có một nhịp kể.</h2></div><p class="lede">Chọn theo kiểu câu chuyện cần kể. Nhấn vào bảng tổng thể để xem lớn hoặc mở trang chi tiết để chạy trình chiếu thật.</p></div><div class="gallery-toolbar"><div class="filter-row" role="group" aria-label="Lọc bộ mẫu">${filters.map(([id, label], index) => `<button class="${index === 0 ? "is-active" : ""}" type="button" data-filter="${e(id)}" aria-pressed="${index === 0}">${e(label)}</button>`).join("")}</div><div><span class="template-count" id="template-count">8 bộ mẫu</span> ${themeSwitch()}</div></div><div class="template-grid" id="template-gallery">${profiles.map(templateCard).join("")}</div></div></section>
  <section class="section" id="workflow"><div class="shell"><div class="section-head reveal"><div><p class="eyebrow">02 · Quy trình thật</p><h2 class="section-title">Codex viết nội dung.<br>VibePPT giữ chất lượng.</h2></div><p class="lede">VibePPT không thay Codex. Nó cung cấp ngôn ngữ hình ảnh, cấu trúc dữ liệu, bản xem trước và kiểm tra đầu ra để Codex không bắt đầu từ một slide trắng.</p></div><div class="workflow"><article class="reveal"><h3>Chọn bộ mẫu</h3><p>Nhìn toàn bộ nhịp kể bằng bảng xem tổng thể sáng hoặc tối.</p></article><article class="reveal"><h3>Đưa ngữ cảnh</h3><p>Studio trên máy đóng gói yêu cầu, logo và tài liệu nguồn vào một dự án rõ ràng.</p></article><article class="reveal"><h3>Codex soạn nội dung</h3><p>Kỹ năng đọc nguồn, viết DeckSpec và tạo hình ảnh khi thật sự cần.</p></article><article class="reveal"><h3>Dựng và kiểm tra</h3><p>Một nguồn sinh bản xem trước HTML, PPTX kết hợp, PNG và báo cáo cấu trúc.</p></article></div></div></section>
  <section class="section"><div class="shell output-layout"><div class="output-sheet reveal">${previewImage(launch)}</div><div class="reveal"><p class="eyebrow">03 · Đầu ra có thể kiểm tra</p><h2 class="section-title">Một bộ slide.<br>Bốn cách kiểm chứng.</h2><div class="artifact-list"><div class="artifact"><b>HTML</b><div><strong>Trình chiếu trong trình duyệt</strong><span>Dùng để xem nhanh và chia sẻ nội bộ.</span></div></div><div class="artifact"><b>PPTX</b><div><strong>PowerPoint kết hợp</strong><span>Giữ văn bản, biểu đồ, bảng và sơ đồ ở dạng chỉnh sửa được khi phù hợp.</span></div></div><div class="artifact"><b>PNG</b><div><strong>Ảnh từng slide</strong><span>Dùng để kiểm tra hình ảnh và tạo bảng xem tổng thể.</span></div></div><div class="artifact"><b>QA</b><div><strong>Báo cáo cấu trúc</strong><span>Đếm slide, ghi chú, tệp đa phương tiện và đối tượng chỉnh sửa được.</span></div></div></div><a class="button" href="https://github.com/Thanh25102/vibeppt/releases">Tải PPTX mẫu từ bản phát hành ↗</a></div></div></section>
  <section class="section" id="install"><div class="shell"><div class="install-panel reveal"><div><p class="eyebrow">04 · Chạy trên máy của bạn</p><h2 class="section-title">Clone.<br>Cài. Mở Studio.</h2><p class="lede">Dành cho Windows 10/11 có Node.js 22+, VS Code/Codex, Chrome hoặc Edge và Microsoft PowerPoint để QA cuối.</p></div><div><div class="code-wrap"><pre class="code-block" id="install-code">git clone https://github.com/Thanh25102/vibeppt.git
cd vibeppt
powershell -ExecutionPolicy Bypass -File .\\scripts\\install.ps1</pre><button class="copy-button" type="button" data-copy="#install-code">Sao chép</button></div><div class="requirements"><span>Windows 10/11</span><span>Node.js 22+</span><span>VS Code + Codex</span><span>PowerPoint trên máy</span></div><div class="inline-actions" style="margin-top:20px"><a class="button primary" href="/docs/">Mở hướng dẫn đầy đủ</a><a class="button" href="https://github.com/Thanh25102/vibeppt">Xem mã nguồn ↗</a></div></div></div></div></section>
  <section class="section"><div class="shell"><div class="section-head"><div><p class="eyebrow">05 · Nói rõ giới hạn</p><h2 class="section-title">Không hứa điều<br>sản phẩm chưa làm.</h2></div><p class="lede">Website này là trang giới thiệu tĩnh. Tạo dự án và đọc tệp diễn ra trong Studio trên máy; Codex đảm nhiệm soạn nội dung; PowerPoint trên máy vẫn là bước kiểm tra cuối.</p></div><div class="faq-list"><details><summary>Website có nhận tài liệu hoặc tạo PPT trực tuyến không?</summary><p>Không. Website không có tải lên, tài khoản hay dịch vụ máy chủ tạo PPT. Tài liệu của bạn chỉ được chọn trong Studio chạy trên máy.</p></details><details><summary>Slide có chỉnh sửa được trong PowerPoint không?</summary><p>Chế độ kết hợp giữ văn bản, biểu đồ, bảng và sơ đồ dưới dạng đối tượng chỉnh sửa được khi phù hợp. Những hình ảnh quá phức tạp có thể được chuyển thành ảnh để giữ đúng thiết kế.</p></details><details><summary>VibePPT có thay Codex không?</summary><p>Không. Codex chịu trách nhiệm đọc nguồn và soạn nội dung. VibePPT cung cấp quy ước bộ mẫu, bộ kết xuất, xem trước, xuất tệp và QA.</p></details><details><summary>Kho mã công khai có phải mã nguồn mở không?</summary><p>Không theo định nghĩa OSI. Mã nguồn được công khai theo PolyForm Shield 1.0.0, cho phép sử dụng và sửa đổi nhưng hạn chế sản phẩm cạnh tranh.</p></details></div></div></section>
  <dialog id="template-preview" aria-labelledby="preview-name"><form method="dialog"><button class="dialog-close" aria-label="Đóng bản xem trước">×</button></form><div class="dialog-grid"><div class="dialog-image"><img id="preview-image" alt="Bản xem trước của bộ mẫu được chọn"></div><div class="dialog-copy"><p class="eyebrow">Bảng xem tổng thể thật</p><h2 id="preview-name"></h2><p id="preview-summary"></p><a class="button primary" id="preview-detail" href="/templates/">Xem trình chiếu và nhịp kể →</a></div></div></dialog>`;
  return page({ title: "VibePPT · Slide đẹp cho Codex, có bản xem trước và PowerPoint QA", description: "Xem trực tiếp tám hệ thống bộ mẫu VibePPT, giao diện sáng tối và quy trình tạo PowerPoint bằng Codex trên máy.", canonical: "/", body });
}

function templatePage(profile) {
  const summary = templateCopy[profile.id] ?? profile.summary;
  const steps = profile.storyRecipe.map((step, index) => {
    const [name, purpose] = storyCopy[step.intent] ?? [titleCase(step.intent), step.purpose];
    return `<article class="story-step reveal"><b>${String(index + 1).padStart(2, "0")} · ${e(step.kind)}</b><h3>${e(name)}</h3><p>${e(purpose)}</p></article>`;
  }).join("");
  const body = `<section class="shell detail-hero"><div class="detail-copy"><p class="eyebrow">Bộ mẫu · giao diện ${profile.defaultTheme === "light" ? "sáng" : "tối"}</p><h1>${e(profile.name)}</h1><p class="lede">${e(summary)}</p><div class="tag-row">${profile.categories.map((category) => `<span class="tag">${e(categoryLabels[category] ?? titleCase(category))}</span>`).join("")}</div><div class="inline-actions" style="margin-top:26px"><a class="button primary" href="#demo">Xem trình chiếu ↓</a><a class="button" href="/#templates">← Tất cả bộ mẫu</a></div></div><div class="detail-visual">${previewImage(profile)}</div></section>
  <section class="section"><div class="shell"><div class="section-head"><div><p class="eyebrow">Nhịp kể đề xuất</p><h2 class="section-title">Sáu nhịp để<br>giữ câu chuyện.</h2></div><p class="lede">Đây là gợi ý về trình tự tư duy, không phải nội dung mẫu bắt buộc. Codex vẫn phải bám yêu cầu và bằng chứng của dự án.</p></div><div class="story-grid">${steps}</div></div></section>
  <section class="section" id="demo"><div class="shell"><div class="demo-toolbar"><div><p class="eyebrow">Trình chiếu HTML trực tiếp</p><h2 class="section-title">Tự bấm qua từng slide.</h2></div><div class="inline-actions">${themeSwitch()}<a class="button small" data-demo-link data-dark="/demo/${e(profile.id)}/dark/" data-light="/demo/${e(profile.id)}/light/" href="/demo/${e(profile.id)}/dark/" target="_blank" rel="noopener">Mở toàn màn hình ↗</a></div></div><div class="demo-shell"><iframe title="Trình chiếu ${e(profile.name)}" data-demo-frame data-dark="/demo/${e(profile.id)}/dark/" data-light="/demo/${e(profile.id)}/light/" src="/demo/${e(profile.id)}/dark/" allowfullscreen loading="lazy"></iframe></div></div></section>
  <section class="section"><div class="shell install-panel"><div><p class="eyebrow">Dùng ngôn ngữ hình ảnh này</p><h2 class="section-title">Tạo dự án<br>${e(profile.name)}.</h2></div><div><div class="code-wrap"><pre class="code-block" id="template-code">vibeppt init .\\customer-deck --template ${e(profile.id)}
cd .\\customer-deck
code .</pre><button class="copy-button" type="button" data-copy="#template-code">Sao chép</button></div><p class="lede">Hoặc mở VibePPT Studio, chọn bộ mẫu này bằng bảng xem tổng thể rồi bàn giao dự án sang Codex.</p><a class="button primary" href="/docs/">Xem hướng dẫn cài đặt →</a></div></div></section>`;
  return page({ title: `${profile.name} · VibePPT Template`, description: summary, canonical: `/templates/${profile.id}/`, image: `/previews/${profile.id}/dark.webp`, body, pageClass: "template-detail" });
}

function docsPage() {
  const install = `git clone https://github.com/Thanh25102/vibeppt.git\ncd vibeppt\npowershell -ExecutionPolicy Bypass -File .\\scripts\\install.ps1`;
  const commands = `vibeppt init .\\customer-deck --template launch-signal\ncd .\\customer-deck\nvibeppt preview .\\deck.json --out .\\output\\preview --force\nvibeppt build .\\deck.json --mode hybrid --out .\\output\\final --force`;
  const body = `<div class="shell"><section class="page-hero"><div><p class="eyebrow">Hướng dẫn</p><h1 class="section-title">Từ kho mã tới<br>slide đầu tiên.</h1><p class="lede">Quy trình dành cho người đã có VS Code/Codex và muốn giữ toàn bộ mã nguồn, tài liệu cùng đầu ra trên máy.</p></div><aside class="page-kicker"><b>Yêu cầu</b><span>Windows 10/11 · Node.js 22+ · Chrome hoặc Edge · Microsoft PowerPoint cho bước kiểm tra cuối.</span></aside></section><div class="doc-layout"><nav class="doc-nav" aria-label="Mục lục"><a href="#install">Cài đặt</a><a href="#studio">Studio</a><a href="#cli">CLI</a><a href="#output">Đầu ra</a><a href="#limits">Giới hạn</a><a href="#license">Giấy phép</a></nav><article class="doc-content"><section class="doc-section" id="install"><h2>1. Cài đặt trên Windows</h2><p>Sao chép kho mã rồi chạy bộ cài trong PowerShell. Bộ cài dựng CLI, cài kỹ năng <code>$beautiful-ppt</code> và tạo lối tắt VibePPT Studio.</p><div class="code-wrap"><pre class="code-block" id="docs-install">${e(install)}</pre><button class="copy-button" type="button" data-copy="#docs-install">Sao chép</button></div></section><section class="doc-section" id="studio"><h2>2. Chọn bộ mẫu bằng Studio</h2><ol><li>Mở VibePPT Studio từ menu Start.</li><li>Xem bảng tổng thể sáng/tối và chọn hướng thị giác.</li><li>Nhập yêu cầu, chọn thư mục, tài liệu nguồn và logo nếu có.</li><li>Tạo dự án, mở VS Code và dán lời nhắc đã sao chép vào Codex.</li></ol><div class="callout">Studio chạy trên <code>127.0.0.1</code>. Bộ chọn tệp và thao tác mở VS Code không tồn tại trên website giới thiệu công khai.</div></section><section class="doc-section" id="cli"><h2>3. Dựng bằng CLI</h2><div class="code-wrap"><pre class="code-block" id="docs-cli">${e(commands)}</pre><button class="copy-button" type="button" data-copy="#docs-cli">Sao chép</button></div><p>Codex thường chạy các lệnh này thông qua kỹ năng sau khi đã soạn <code>deck.json</code>.</p></section><section class="doc-section" id="output"><h2>4. Đọc đầu ra</h2><ul><li><code>preview/index.html</code>: trình chiếu và xem nhanh trong trình duyệt.</li><li><code>*.pptx</code>: PowerPoint kết hợp.</li><li><code>slides/</code> và <code>contact-sheet.png</code>: kiểm tra hình ảnh.</li><li><code>qa.json</code>: cấu trúc slide, ghi chú, tệp đa phương tiện và đối tượng chỉnh sửa được.</li><li><code>source/</code>: DeckSpec, thương hiệu và bộ mẫu đã đóng gói.</li></ul></section><section class="doc-section" id="limits"><h2>5. Giới hạn hiện tại</h2><p>VibePPT tạo bộ slide mới từ mã nguồn thay vì sửa tùy ý mọi PPTX cũ. Hoạt ảnh, khứ hồi SmartArt, trình sửa kéo-thả, cộng tác và tạo trên đám mây chưa nằm trong sản phẩm. Bước kiểm tra cuối vẫn cần PowerPoint trên Windows.</p></section><section class="doc-section" id="license"><h2>6. Giấy phép công khai mã nguồn</h2><p>Mã nguồn được công khai theo PolyForm Shield 1.0.0, Bản quyền 2026 Bùi Mạnh Thành. Giấy phép cho phép xem, dùng và sửa theo các điều khoản của nó, đồng thời giới hạn sản phẩm cạnh tranh. Đây không phải giấy phép mã nguồn mở được OSI công nhận.</p><a class="button" href="https://github.com/Thanh25102/vibeppt/blob/main/LICENSE.md">Đọc giấy phép đầy đủ ↗</a></section></article></div></div>`;
  return page({ title: "Hướng dẫn cài đặt · VibePPT", description: "Cài VibePPT trên Windows, chọn bộ mẫu trong Studio và tạo bản xem trước HTML cùng PowerPoint bằng Codex.", canonical: "/docs/", body });
}

function privacyPage() {
  const body = `<div class="shell"><section class="page-hero"><div><p class="eyebrow">Quyền riêng tư</p><h1 class="section-title">Website không cần<br>tài liệu của bạn.</h1><p class="lede">Trang giới thiệu công khai này chỉ phục vụ tệp HTML, CSS, JavaScript và bản xem trước đã dựng sẵn.</p></div><aside class="page-kicker"><b>Không có</b><span>Tài khoản · tải lên · cookie quảng cáo · phân tích hành vi · API tạo PPT.</span></aside></section><article class="doc-content" style="max-width:900px;padding-bottom:110px"><section class="doc-section"><h2>Dữ liệu website</h2><p>Website không có biểu mẫu và không gửi yêu cầu, logo hoặc tài liệu nguồn tới máy chủ. Nginx có thể ghi nhật ký truy cập vận hành tiêu chuẩn như địa chỉ IP, thời gian, URL và thông tin trình duyệt.</p></section><section class="doc-section"><h2>Dữ liệu trong Studio</h2><p>Studio là tiến trình trên máy chạy ở <code>127.0.0.1</code>. Tệp bạn chọn được sao chép vào dự án trên máy và không được chuyển tới website này.</p></section><section class="doc-section"><h2>Dịch vụ bên ngoài</h2><p>Các liên kết GitHub và GitHub Releases đưa bạn sang GitHub, nơi áp dụng chính sách riêng của GitHub. Website không nhúng công cụ theo dõi hoặc nội dung bên thứ ba.</p></section><section class="doc-section"><h2>Cập nhật</h2><p>Nếu sau này bổ sung phân tích hành vi, tài khoản hoặc tải lên, trang này phải được cập nhật trước khi tính năng được bật.</p></section></article></div>`;
  return page({ title: "Quyền riêng tư · VibePPT", description: "Website VibePPT không tải lên tài liệu, không phân tích hành vi và không có tài khoản.", canonical: "/privacy/", body });
}

async function writePage(out, relative, content) {
  const target = path.join(out, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

async function buildSite(out) {
  const resolved = path.resolve(out);
  if ([path.parse(resolved).root, root, path.resolve(homedir()), path.resolve(tmpdir()), path.resolve(process.cwd())].includes(resolved)) throw new Error(`Refusing broad output directory: ${resolved}`);
  await rm(resolved, { recursive: true, force: true });
  await mkdir(path.join(resolved, "assets"), { recursive: true });
  await Promise.all([cp(path.join(source, "styles.css"), path.join(resolved, "assets", "styles.css")), cp(path.join(source, "app.js"), path.join(resolved, "assets", "app.js"))]);
  const profiles = await listTemplates(root);
  const catalog = [];
  for (const profile of profiles) {
    const templateDir = path.join(root, "templates", profile.id);
    const project = await loadProject(path.join(templateDir, profile.sampleDeck));
    if (hasErrors(project.issues)) throw new Error(formatIssues(project.issues));
    const previewDir = path.join(resolved, "previews", profile.id);
    await mkdir(previewDir, { recursive: true });
    await Promise.all([cp(path.join(templateDir, profile.preview.dark), path.join(previewDir, "dark.webp")), cp(path.join(templateDir, profile.preview.light), path.join(previewDir, "light.webp"))]);
    for (const theme of ["dark", "light"]) {
      await writePage(resolved, `demo/${profile.id}/${theme}/index.html`, renderDeckHtml(project.deck, project.brand, { theme, templateCss: project.template.css, templateId: profile.id }));
    }
    await writePage(resolved, `templates/${profile.id}/index.html`, templatePage(profile));
    catalog.push({ id: profile.id, name: profile.name, summary: templateCopy[profile.id] ?? profile.summary, categories: profile.categories, moods: profile.moods, defaultTheme: profile.defaultTheme, preview: { dark: `/previews/${profile.id}/dark.webp`, light: `/previews/${profile.id}/light.webp` }, detailUrl: `/templates/${profile.id}/`, demo: { dark: `/demo/${profile.id}/dark/`, light: `/demo/${profile.id}/light/` }, storyRecipe: profile.storyRecipe.map((step) => ({ ...step, label: storyCopy[step.intent]?.[0] ?? titleCase(step.intent), purposeVi: storyCopy[step.intent]?.[1] ?? step.purpose })) });
  }
  await Promise.all([
    writePage(resolved, "index.html", homePage(profiles)),
    writePage(resolved, "docs/index.html", docsPage()),
    writePage(resolved, "privacy/index.html", privacyPage()),
    writePage(resolved, "catalog.json", JSON.stringify({ version: 1, templates: catalog }, null, 2)),
    writePage(resolved, "healthz", "ok\n"),
    writePage(resolved, "favicon.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g"><stop stop-color="#ff4f75"/><stop offset="1" stop-color="#9a63ff"/></linearGradient></defs><rect width="64" height="64" rx="18" fill="url(#g)"/><path d="M17 17h10l5 23 5-23h10L38 48H26z" fill="white"/></svg>`),
    writePage(resolved, "404.html", page({ title: "Không tìm thấy · VibePPT", description: "Trang không tồn tại.", body: `<section class="shell page-hero"><div><p class="eyebrow">404</p><h1 class="section-title">Không có slide này.</h1><p class="lede">Đường dẫn không tồn tại hoặc đã được thay đổi.</p><a class="button primary" href="/">Về trang chủ</a></div></section>` })),
  ]);
  const origin = siteUrl();
  const routes = ["/", "/docs/", "/privacy/", ...profiles.map((profile) => `/templates/${profile.id}/`)];
  await writePage(resolved, "robots.txt", `User-agent: *\nAllow: /\n${origin ? `Sitemap: ${origin}/sitemap.xml\n` : ""}`);
  if (origin) await writePage(resolved, "sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${routes.map((route) => `<url><loc>${e(origin + route)}</loc></url>`).join("")}</urlset>`);
  console.log(`Built VibePPT site: ${resolved} (${profiles.length} templates, ${profiles.length * 2} demos)`);
}

function type(filePath) {
  return ({ ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".webp": "image/webp", ".xml": "application/xml; charset=utf-8", ".txt": "text/plain; charset=utf-8" })[path.extname(filePath)] ?? "application/octet-stream";
}

async function serveSite(directory, port) {
  const base = path.resolve(directory);
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      let target = path.resolve(base, `.${decodeURIComponent(url.pathname)}`);
      const relative = path.relative(base, target);
      if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Invalid path.");
      const info = await stat(target).catch(() => null);
      if (info?.isDirectory()) target = path.join(target, "index.html");
      const file = await readFile(target).catch(() => null);
      if (!file) {
        response.writeHead(404, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        response.end(await readFile(path.join(base, "404.html")));
        return;
      }
      response.writeHead(200, { "Content-Type": type(target), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
      response.end(file);
    } catch (error) {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(error.message);
    }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  const address = server.address();
  console.log(`VibePPT site: http://127.0.0.1:${address.port}`);
  const stop = () => server.close();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  await new Promise((resolve) => server.once("close", resolve));
}

const command = process.argv[2];
if (command === "build") await buildSite(flag("--out", path.join(root, "site-dist")));
else if (command === "serve") await serveSite(flag("--dir", path.join(root, "site-dist")), Number(flag("--port", "4173")));
else throw new Error("Usage: node scripts/site.mjs <build|serve> [--out dir] [--dir dir] [--port number]");
