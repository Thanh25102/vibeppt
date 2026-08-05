import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildCustomerKit, installCustomerKit, listInstalledKits } from "../dist/kits.js";
import { listAvailableBrands, listAvailableTemplates } from "../dist/templates.js";

const root = path.resolve(import.meta.dirname, "..");

test("Customer Kit build and install keeps templates private and discoverable", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "vibeppt-kit-test-"));
  try {
    const workspace = path.join(temporary, "workspace");
    const templateDir = path.join(workspace, "templates", "acme-core");
    const brandDir = path.join(workspace, "brands", "acme-brand");
    await cp(path.join(root, "templates", "launch-signal"), templateDir, { recursive: true });
    await mkdir(brandDir, { recursive: true });
    const template = JSON.parse(await readFile(path.join(templateDir, "template.json"), "utf8"));
    template.id = "acme-core";
    template.name = "Acme Core";
    await writeFile(path.join(templateDir, "template.json"), JSON.stringify(template, null, 2));
    const brand = JSON.parse(await readFile(path.join(root, "templates", "launch-signal", "brand.json"), "utf8"));
    brand.id = "acme-brand";
    brand.name = "Acme Brand";
    await writeFile(path.join(brandDir, "brand.json"), JSON.stringify(brand, null, 2));
    await mkdir(path.join(workspace, "demo"));
    await writeFile(path.join(workspace, "demo", "contact-sheet.png"), "demo");
    await writeFile(path.join(workspace, "NOTICE.md"), "Customer supplied references were not packaged.");
    await writeFile(path.join(workspace, "kit.json"), JSON.stringify({
      version: 1, id: "acme-kit", name: "Acme Customer Kit", customer: "Acme", minVibePptVersion: "0.4.0-alpha.1",
      templates: ["acme-core"], brands: ["acme-brand"], demo: { contactSheet: "demo/contact-sheet.png" },
    }));
    const kitFile = path.join(temporary, "acme.vibeppt-kit");
    const manifest = await buildCustomerKit(workspace, kitFile);
    assert.equal(manifest.id, "acme-kit");
    assert.ok(!Object.keys(manifest.files).some((name) => name.includes("selection") || name.includes("library")));
    const dataRoot = path.join(temporary, "data");
    await installCustomerKit(kitFile, { dataRoot });
    assert.deepEqual((await listInstalledKits(dataRoot)).map((item) => item.id), ["acme-kit"]);
    assert.ok((await listAvailableTemplates(root, dataRoot)).some((item) => item.profile.id === "acme-core"));
    assert.ok((await listAvailableBrands(dataRoot)).some((item) => item.profile.id === "acme-brand"));
    await assert.rejects(() => installCustomerKit(kitFile, { dataRoot }), /already installed/);
    await installCustomerKit(kitFile, { dataRoot, force: true });
    assert.deepEqual((await listInstalledKits(dataRoot)).map((item) => item.id), ["acme-kit"]);

    await writeFile(path.join(workspace, "demo", "reference.pptx"), "not a declared demo");
    await assert.rejects(() => buildCustomerKit(workspace, path.join(temporary, "source-leak.vibeppt-kit")), /single demo PPTX/);
    await writeFile(path.join(templateDir, "unsafe.js"), "alert(1)");
    await assert.rejects(() => buildCustomerKit(workspace, path.join(temporary, "unsafe.vibeppt-kit")), /not allowed/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
