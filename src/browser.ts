import { chromium, type Browser, type LaunchOptions } from "playwright";

/**
 * Prefer a browser the user already has over the Playwright download, because Edge and Chrome
 * ship the Windows font stack the decks are designed against.
 */
export async function launchBrowser(): Promise<{ browser: Browser; engine: string }> {
  const attempts: Array<{ engine: string; options: LaunchOptions }> = process.platform === "win32"
    ? [
        { engine: "Microsoft Edge", options: { channel: "msedge", headless: true } },
        { engine: "Google Chrome", options: { channel: "chrome", headless: true } },
        { engine: "Playwright Chromium", options: { headless: true } },
      ]
    : [
        { engine: "Google Chrome", options: { channel: "chrome", headless: true, args: ["--no-sandbox"] } },
        { engine: "Playwright Chromium", options: { headless: true, args: ["--no-sandbox"] } },
      ];
  const failures: string[] = [];
  for (const attempt of attempts) {
    try {
      return { browser: await chromium.launch(attempt.options), engine: attempt.engine };
    } catch (error) {
      failures.push(`${attempt.engine}: ${(error as Error).message.split("\n")[0]}`);
    }
  }
  throw new Error(`No supported Chromium browser could start. Install Microsoft Edge or run npx playwright install chromium.\n${failures.join("\n")}`);
}
