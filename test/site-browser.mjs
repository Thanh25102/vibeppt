import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

async function launch() {
  const attempts = [{ channel: "chrome", headless: true, args: ["--no-sandbox"] }, { headless: true, args: ["--no-sandbox"] }];
  for (const options of attempts) {
    try { return await chromium.launch(options); } catch {}
  }
  throw new Error("No Chrome or Playwright Chromium browser is available.");
}

const child = spawn(process.execPath, ["scripts/site.mjs", "serve", "--port", "0"], { cwd: new URL("..", import.meta.url), stdio: ["ignore", "pipe", "pipe"] });
let output = "";
child.stdout.on("data", (chunk) => { output += chunk; });
child.stderr.on("data", (chunk) => { output += chunk; });
const origin = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Site did not start. ${output}`)), 10_000);
  child.stdout.on("data", () => {
    const match = output.match(/VibePPT site: (http:\/\/[^\s]+)/);
    if (match) { clearTimeout(timer); resolve(match[1]); }
  });
  child.once("exit", (code) => reject(new Error(`Site exited early with ${code}. ${output}`)));
});

let browser;
const errors = [];
try {
  browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  await page.goto(origin, { waitUntil: "networkidle" });
  assert.match(await page.locator("h1").innerText(), /Xem slide trước/);
  assert.equal(await page.locator("[data-template-card]").count(), 8);
  assert.equal(await page.locator("img:not([alt]), img[alt='']").count(), 0);

  await page.getByRole("button", { name: "Chiến dịch" }).click();
  assert.equal(await page.locator("[data-template-card]:visible").count(), 1);
  await page.getByRole("button", { name: "Sáng", exact: true }).first().click();
  assert.match(await page.locator("[data-template-card]:visible [data-theme-image]").getAttribute("src"), /light\.webp$/);
  await page.locator("[data-template-card]:visible [data-open-preview]").click();
  assert.ok(await page.locator("#template-preview").evaluate((dialog) => dialog.open));
  await page.keyboard.press("Escape");

  await page.goto(`${origin}/templates/launch-signal/`, { waitUntil: "networkidle" });
  assert.equal(await page.locator(".story-step").count(), 6);
  const frame = page.frameLocator("[data-demo-frame]");
  await frame.locator(".vp-slide").first().waitFor();
  assert.equal(await frame.locator(".vp-slide").count(), 8);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin, { waitUntil: "networkidle" });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `Mobile page overflows by ${overflow}px.`);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ templates: 8, filters: "pass", theme: "pass", dialog: "pass", liveDemo: "pass", mobile: "pass" }));
} finally {
  await browser?.close();
  child.kill("SIGTERM");
}
