import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { renderDeckHtml } from "../dist/html.js";
import { loadProject } from "../dist/model.js";

const root = path.resolve(import.meta.dirname, "..");
const templateRoot = path.join(root, "templates");
const ids = (await readdir(templateRoot, { withFileTypes: true })).filter((item) => item.isDirectory()).map((item) => item.name).sort();
const launch = process.platform === "win32" ? { channel: "msedge", headless: true } : { channel: "chrome", headless: true, args: ["--no-sandbox"] };
const browser = await chromium.launch(launch);
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });

async function pngToWebp(buffer) {
  const base64 = buffer.toString("base64");
  const dataUrl = await page.evaluate(async (png) => {
    const image = new Image();
    image.src = `data:image/png;base64,${png}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext("2d").drawImage(image, 0, 0);
    return canvas.toDataURL("image/webp", 0.84);
  }, base64);
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

try {
  for (const id of ids) {
    const directory = path.join(templateRoot, id);
    const project = await loadProject(path.join(directory, "sample-deck.json"));
    if (!project.template) throw new Error(`Template did not load: ${id}`);
    for (const theme of ["dark", "light"]) {
      await page.setViewportSize({ width: 960, height: 540 });
      await page.setContent(renderDeckHtml(project.deck, project.brand, {
        theme,
        templateCss: project.template.css,
        templateId: project.template.profile.id,
      }), { waitUntil: "load" });
      await page.waitForFunction(() => Boolean(window.__vibePpt?.count));
      const images = [];
      for (let index = 0; index < project.deck.sections.flatMap((section) => section.slides).length; index += 1) {
        await page.evaluate((slideIndex) => window.__vibePpt.activate(slideIndex), index);
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        images.push((await page.screenshot({ type: "png", animations: "disabled" })).toString("base64"));
      }
      await page.setViewportSize({ width: 1280, height: 760 });
      await page.setContent(`<!doctype html><style>*{box-sizing:border-box}body{margin:0;padding:26px;background:#08090c;font:700 15px Segoe UI,Arial;color:#c8ccd5}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:17px}figure{margin:0;padding:7px;border:1px solid #30343f;border-radius:12px;background:#15171c;box-shadow:0 12px 28px #0008}img{display:block;width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:7px}figcaption{padding:8px 2px 1px}</style><div class="grid">${images.map((image, index) => `<figure><img src="data:image/png;base64,${image}"><figcaption>${String(index + 1).padStart(2, "0")}</figcaption></figure>`).join("")}</div>`, { waitUntil: "load" });
      await page.waitForFunction(() => [...document.images].every((image) => image.complete));
      const png = await page.screenshot({ type: "png", animations: "disabled" });
      const previewDir = path.join(directory, "previews");
      await mkdir(previewDir, { recursive: true });
      await writeFile(path.join(previewDir, `${theme}.webp`), await pngToWebp(png));
      console.log(`${id}/${theme}`);
    }
  }
} finally {
  await browser.close();
}
