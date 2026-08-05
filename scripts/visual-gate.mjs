// Regression gate: build the golden decks and require PowerPoint to lay every text box out
// inside the geometry the renderer measured. This is what stops the hybrid renderer drifting
// silently — a wrong point-size conversion passes every structural check but fails here.
// Kept out of `npm test` because each deck costs a full browser render plus a COM round trip.
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "dist", "cli.js");

const GOLDEN_DECKS = [
  "examples/northstar/deck.json",
  "templates/product-walkthrough/sample-deck.json",
];

if (process.platform !== "win32") {
  console.log("SKIP: the visual gate needs Windows with desktop Microsoft PowerPoint.");
  process.exit(0);
}

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code: code ?? 1, output }));
  });
}

let failures = 0;
for (const deck of GOLDEN_DECKS) {
  const outDir = await mkdtemp(path.join(tmpdir(), "vibeppt-visual-"));
  try {
    const built = await run(["build", path.join(root, deck), "--out", outDir, "--force"]);
    if (built.code !== 0) {
      console.error(`FAIL ${deck}\n${built.output}`);
      failures += 1;
      continue;
    }
    const pptx = (await readdir(outDir)).find((name) => name.endsWith(".pptx"));
    if (!pptx) {
      console.error(`FAIL ${deck}: no PPTX was produced.`);
      failures += 1;
      continue;
    }
    const reportPath = path.join(outDir, "qa-visual.json");
    await run(["qa", path.join(outDir, pptx), "--powerpoint", "--out", reportPath]);
    const report = JSON.parse((await readFile(reportPath, "utf8")).replace(/^﻿/, ""));
    const errors = report.issues.filter((issue) => issue.level === "error");
    const warnings = report.issues.filter((issue) => issue.level === "warning");
    if (errors.length) {
      console.error(`FAIL ${deck} — ${errors.length} error(s):`);
      for (const issue of errors) console.error(`  ${issue.message}`);
      failures += 1;
    } else {
      console.log(`PASS ${deck} — ${report.slideCount} slides, ${warnings.length} warning(s)`);
      for (const issue of warnings) console.log(`  WARN ${issue.message}`);
    }
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}

if (failures) {
  console.error(`\n${failures} of ${GOLDEN_DECKS.length} golden decks failed the visual gate.`);
  process.exit(1);
}
console.log(`\nAll ${GOLDEN_DECKS.length} golden decks passed the visual gate.`);
