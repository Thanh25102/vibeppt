import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { renderDeckHtml } from "../dist/html.js";
import { validateBrand, validateDeck } from "../dist/model.js";
import { PT_PER_PX, PX_PER_INCH } from "../dist/pptx.js";

const root = path.resolve(import.meta.dirname, "..");

test("native text point sizes stay consistent with the px-per-inch canvas", () => {
  assert.equal(PX_PER_INCH * PT_PER_PX, 72);
  assert.equal(1920 * PT_PER_PX, 960);
  assert.equal(116 * PT_PER_PX, 58);
});

test("sample deck validates and renders the native hybrid contract", async () => {
  const deck = JSON.parse(await readFile(path.join(root, "examples/northstar/deck.json"), "utf8"));
  const brand = JSON.parse(await readFile(path.join(root, "presets/cinematic/brand.json"), "utf8"));
  assert.deepEqual(validateDeck(deck), []);
  for (const preset of ["cinematic", "editorial", "corporate"]) {
    const profile = JSON.parse(await readFile(path.join(root, `presets/${preset}/brand.json`), "utf8"));
    assert.deepEqual(validateBrand(profile), []);
  }
  const html = renderDeckHtml(deck, brand);
  assert.equal((html.match(/class="vp-slide /g) ?? []).length, 12);
  assert.match(html, /data-ppt-native-block="chart"/);
  assert.match(html, /data-ppt-native-block="table"/);
  assert.match(html, /--font-display:&quot;Segoe UI&quot;/);
  assert.match(html, /window\.__vibePpt/);
});

test("the deck stylesheet parses as CSS", async () => {
  // A `;` typed where a `{` belongs makes the browser drop that rule *and the next one*, which is
  // invisible in every structural check. It also unbalances the braces, so counting them catches it.
  const deck = JSON.parse(await readFile(path.join(root, "examples/northstar/deck.json"), "utf8"));
  const brand = JSON.parse(await readFile(path.join(root, "presets/cinematic/brand.json"), "utf8"));
  const css = renderDeckHtml(deck, brand).match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.equal((css.match(/{/g) ?? []).length, (css.match(/}/g) ?? []).length);
});

test("lint rejects remote assets and malformed chart data", () => {
  const deck = {
    version: 1,
    meta: { title: "Bad deck" },
    brandProfile: "./brand.json",
    sections: [{ id: "one", title: "One", slides: [{
      id: "bad", kind: "chart", title: "Bad", visual: { src: "https://example.com/a.png", alt: "a" },
      chart: { type: "line", categories: ["A", "B"], series: [{ name: "S", values: [1] }] },
    }] }],
  };
  const issues = validateDeck(deck);
  assert.ok(issues.some((issue) => issue.path.endsWith("visual.src")));
  assert.ok(issues.some((issue) => issue.path.includes("chart.series")));

  const malformed = structuredClone(deck);
  malformed.sections[0].slides[0].chart = {};
  malformed.sections[0].slides[0].table = {};
  malformed.sections[0].slides[0].diagram = {};
  assert.doesNotThrow(() => validateDeck(malformed));
  assert.ok(validateDeck(malformed).filter((issue) => issue.level === "error").length >= 3);
});

test("layout variants and theme-specific logos remain backward compatible", () => {
  const deck = {
    version: 1, meta: { title: "Layouts" }, brandProfile: "./brand.json",
    sections: [{ id: "one", title: "One", slides: [{ id: "cover", kind: "hero", layout: "split-cover", title: "Cover" }] }],
  };
  assert.deepEqual(validateDeck(deck), []);
  deck.sections[0].slides[0].layout = "Not valid";
  assert.ok(validateDeck(deck).some((issue) => issue.path.endsWith("layout")));
  const brand = {
    version: 1, id: "logos", name: "Logos", fonts: { display: "Arial", body: "Arial" }, logos: { light: "logo-dark.svg", dark: "logo-light.svg" },
    themes: Object.fromEntries(["light", "dark"].map((theme) => [theme, { bg: "#000000", bgDeep: "#000000", panel: "#000000", panelSoft: "#000000", ink: "#FFFFFF", muted: "#AAAAAA", line: "#333333", accent: "#FF0000", accent2: "#00FF00", accent3: "#0000FF", good: "#00FF00", warn: "#FFAA00" }])),
  };
  assert.deepEqual(validateBrand(brand), []);
});
