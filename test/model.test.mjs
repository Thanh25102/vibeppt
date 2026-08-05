import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { renderDeckHtml } from "../dist/html.js";
import { validateBrand, validateDeck } from "../dist/model.js";

const root = path.resolve(import.meta.dirname, "..");

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
