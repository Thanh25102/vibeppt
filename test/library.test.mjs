import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import pptxgen from "pptxgenjs";
import { indexLibrary, validateCurationSelection } from "../dist/library.js";
import { createContactSheets } from "../dist/contact-sheet.js";

const score = { hierarchy: 90, flexibility: 85, brandability: 88, editability: 80, themeCompatibility: 75, total: 85 };

test("library index reads PPTX structure without PowerPoint and preserves a stable catalog", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "vibeppt-library-test-"));
  try {
    const sources = path.join(temporary, "sources");
    const workspace = path.join(temporary, "workspace");
    await mkdir(sources);
    const lightSources = path.join(sources, "Light");
    await mkdir(lightSources);
    const PptxConstructor = pptxgen;
    const pptx = new PptxConstructor();
    for (let index = 1; index <= 3; index += 1) {
      const slide = pptx.addSlide();
      slide.addText(`Slide ${index}`, { x: 1, y: 1, w: 4, h: 1 });
    }
    await pptx.writeFile({ fileName: path.join(lightSources, "Business_Light_v1.pptx") });
    const first = await indexLibrary({ sourceRoot: sources, outDir: workspace, structuralOnly: true, createSheets: false });
    assert.equal(first.decks.length, 1);
    assert.equal(first.decks[0].status, "ready");
    assert.equal(first.decks[0].slideCount, 3);
    assert.equal(first.decks[0].category, "Business");
    assert.equal(first.decks[0].themeHint, "light");
    assert.ok(first.decks[0].sourceHash.length === 64);
    const portableHash = createHash("sha256").update("Light/Business_Light_v1.pptx").digest("hex").slice(0, 8);
    assert.equal(first.decks[0].id, `business-light-v1-${portableHash}`);
    const second = await indexLibrary({ sourceRoot: sources, outDir: workspace, structuralOnly: true, createSheets: false });
    assert.equal(second.createdAt, first.createdAt);
    assert.equal(second.decks[0].id, first.decks[0].id);

    const candidate = { deckId: first.decks[0].id, slideIndex: 1, image: `decks/${first.decks[0].id}/slides/slide-001.jpg`, score, rationale: "Clear and reusable." };
    const selection = {
      version: 1, libraryId: first.id, updatedAt: new Date().toISOString(),
      pack: { id: "customer-core", name: "Customer Core", summary: "Core layouts" }, visualDirection: "Clean business",
      layouts: [{ id: "cover", name: "Cover", kind: "hero", purpose: "Open", selected: candidate, alternatives: [{ ...candidate, slideIndex: 2 }, { ...candidate, slideIndex: 3 }] }],
    };
    assert.doesNotThrow(() => validateCurationSelection(selection, first));
    selection.layouts[0].alternatives.pop();
    assert.throws(() => validateCurationSelection(selection, first), /exactly two alternatives/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("contact sheets keep a browser-viewable HTML fallback", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "vibeppt-contact-sheet-test-"));
  try {
    const image = path.join(temporary, "pixel.png");
    await writeFile(image, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lWvEiQAAAABJRU5ErkJggg==", "base64"));
    const output = path.join(temporary, "sheets");
    await createContactSheets([{ image, label: "Cover", caption: "Slide 1" }], output, "deck");
    assert.ok((await stat(path.join(output, "deck-001.html"))).isFile());
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
