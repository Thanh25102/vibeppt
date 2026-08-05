import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { renderDeckHtml } from "../dist/html.js";
import { loadProject, validateTemplate } from "../dist/model.js";
import { createPresentationProject, listTemplates } from "../dist/templates.js";

const root = path.resolve(import.meta.dirname, "..");

test("the curated catalog contains eight valid, renderable template packs", async () => {
  const templates = await listTemplates(root);
  assert.equal(templates.length, 8);
  assert.deepEqual(new Set(templates.flatMap((template) => Object.keys(template.preview))), new Set(["dark", "light"]));
  for (const template of templates) {
    const project = await loadProject(path.join(root, "templates", template.id, "sample-deck.json"));
    assert.deepEqual(project.issues, []);
    assert.equal(project.template?.profile.id, template.id);
    const html = renderDeckHtml(project.deck, project.brand, {
      theme: template.defaultTheme,
      templateCss: project.template?.css,
      templateId: template.id,
    });
    assert.match(html, new RegExp(`data-template-id="${template.id}"`));
    assert.match(html, /class="vp-slide /);
  }
});

test("project creation copies the selected pack, brief, logo, and sources without overwriting", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "vibeppt-project-test-"));
  try {
    const inputA = path.join(temporary, "input-a");
    const inputB = path.join(temporary, "input-b");
    await Promise.all([mkdir(inputA), mkdir(inputB)]);
    const sourceA = path.join(inputA, "brief.md");
    const sourceB = path.join(inputB, "brief.md");
    const logo = path.join(temporary, "logo.png");
    await Promise.all([
      writeFile(sourceA, "source a", "utf8"),
      writeFile(sourceB, "source b", "utf8"),
      writeFile(logo, "not-an-image-but-a-local-file", "utf8"),
    ]);
    const target = path.join(temporary, "customer-launch");
    const created = await createPresentationProject({
      targetDirectory: target,
      templateId: "launch-signal",
      theme: "dark",
      brief: {
        projectName: "Customer launch",
        title: "A better launch",
        goal: "Win approval for a focused pilot.",
        audience: "Sales leaders",
        durationMinutes: 25,
        language: "vi",
      },
      logoPath: logo,
      sourcePaths: [sourceA, sourceB],
      rootDirectory: root,
    });
    assert.equal(created.projectPath, target);
    const deck = JSON.parse(await readFile(path.join(target, "deck.json"), "utf8"));
    assert.equal(deck.templateProfile, "./template/template.json");
    assert.equal(deck.brandProfile, "./brand/brand.json");
    assert.equal(deck.theme, "dark");
    assert.equal(await readFile(path.join(target, "sources", "brief.md"), "utf8"), "source a");
    assert.equal(await readFile(path.join(target, "sources", "brief-2.md"), "utf8"), "source b");
    assert.match(await readFile(path.join(target, "brief.md"), "utf8"), /Launch Signal/);
    const loaded = await loadProject(path.join(target, "deck.json"));
    assert.deepEqual(loaded.issues, []);
    await assert.rejects(() => createPresentationProject({
      targetDirectory: target,
      templateId: "launch-signal",
      theme: "dark",
      brief: { projectName: "Again", title: "Again", goal: "Again", audience: "Again", durationMinutes: 10, language: "en" },
      rootDirectory: root,
    }), /not empty/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("template validation rejects remote and incomplete packs", () => {
  const issues = validateTemplate({
    version: 1, id: "bad", name: "Bad", summary: "Bad", categories: ["pitch"], moods: ["bad"], defaultTheme: "dark",
    stylesheet: "https://example.com/style.css", brandProfile: "./brand.json", sampleDeck: "./deck.json", recipe: "./recipe.md",
    preview: { dark: "./dark.webp", light: "./light.webp" }, storyRecipe: [],
  });
  assert.ok(issues.some((issue) => issue.path.endsWith("stylesheet")));
  assert.ok(issues.some((issue) => issue.path.endsWith("storyRecipe")));
});

test("a project cannot load a template profile from outside its directory", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "vibeppt-template-boundary-"));
  try {
    const project = path.join(temporary, "project");
    await mkdir(project);
    const deck = JSON.parse(await readFile(path.join(root, "templates", "launch-signal", "sample-deck.json"), "utf8"));
    deck.brandProfile = path.join(root, "templates", "launch-signal", "brand.json");
    deck.templateProfile = "../outside/template.json";
    await writeFile(path.join(project, "deck.json"), JSON.stringify(deck), "utf8");
    await assert.rejects(() => loadProject(path.join(project, "deck.json")), /must stay inside/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
