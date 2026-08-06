import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { launchBrowser } from "./browser.js";
import { escapeHtml } from "./model.js";

export interface ContactSheetItem {
  image: string;
  label: string;
  caption?: string;
}

export async function createContactSheets(items: ContactSheetItem[], outputDirectory: string, prefix: string, pageSize = 24): Promise<{ files: string[]; engine: string }> {
  await mkdir(outputDirectory, { recursive: true });
  const launched = await launchBrowser().catch(() => null);
  const browser = launched?.browser;
  const engine = launched?.engine ?? "HTML only";
  const files: string[] = [];
  try {
    const page = await browser?.newPage();
    for (let offset = 0; offset < items.length; offset += pageSize) {
      const batch = items.slice(offset, offset + pageSize);
      const pageNumber = Math.floor(offset / pageSize) + 1;
      const filename = `${prefix}-${String(pageNumber).padStart(3, "0")}.png`;
      const outputPath = path.join(outputDirectory, filename);
      const cards = batch.map((item) => `<figure><img src="${pathToFileURL(path.resolve(item.image)).href}" alt=""><figcaption><b>${escapeHtml(item.label)}</b>${item.caption ? `<span>${escapeHtml(item.caption)}</span>` : ""}</figcaption></figure>`).join("");
      const html = `<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;padding:28px;background:#0a0b0f;color:#f5f7fb;font:14px/1.35 Segoe UI,Arial,sans-serif}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}figure{margin:0;padding:7px;border:1px solid #2b303a;border-radius:12px;background:#151820}img{display:block;width:100%;aspect-ratio:16/9;object-fit:contain;border-radius:7px;background:#050608}figcaption{display:flex;justify-content:space-between;gap:12px;padding:9px 3px 2px;color:#aeb5c2}figcaption b{color:#fff}figcaption span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}</style><div class="grid">${cards}</div>`;
      const htmlPath = path.join(outputDirectory, `${prefix}-${String(pageNumber).padStart(3, "0")}.html`);
      await writeFile(htmlPath, html, "utf8");
      if (page) {
        await page.setViewportSize({ width: 1600, height: Math.max(360, 60 + Math.ceil(batch.length / 4) * 260) });
        await page.goto(pathToFileURL(htmlPath).href);
        await page.waitForFunction(() => [...document.images].every((image) => image.complete));
        await page.screenshot({ path: outputPath, fullPage: true, animations: "disabled" });
        files.push(outputPath);
      } else {
        files.push(htmlPath);
      }
    }
  } finally {
    await browser?.close();
  }
  return { files, engine };
}
