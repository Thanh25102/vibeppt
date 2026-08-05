import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const exec = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");

test("the public site is generated from all template packs without local Studio APIs", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "vibeppt-site-test-"));
  const out = path.join(temporary, "site");
  try {
    await exec(process.execPath, ["scripts/site.mjs", "build", "--out", out], { cwd: root });
    const catalog = JSON.parse(await readFile(path.join(out, "catalog.json"), "utf8"));
    assert.ok(catalog.templates.length >= 8, `expected at least 8 packs, found ${catalog.templates.length}`);
    assert.equal(new Set(catalog.templates.flatMap((template) => Object.keys(template.demo))).size, 2);
    const home = await readFile(path.join(out, "index.html"), "utf8");
    assert.doesNotMatch(home, /\/api\/|token=/);
    assert.match(home, /id="template-gallery"/);
    for (const template of catalog.templates) {
      assert.ok((await stat(path.join(out, template.detailUrl, "index.html"))).isFile());
      assert.ok((await stat(path.join(out, template.demo.dark, "index.html"))).isFile());
      assert.ok((await stat(path.join(out, template.demo.light, "index.html"))).isFile());
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
