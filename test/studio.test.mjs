import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

test("Studio serves the catalog only to its session and shuts down cleanly", async (context) => {
  if (process.env.CODEX_SANDBOX_NETWORK_DISABLED) {
    context.skip("The current sandbox disables localhost listeners and child-process pipes.");
    return;
  }
  const { NODE_TEST_CONTEXT: _nodeTestContext, ...cleanEnvironment } = process.env;
  const child = spawn(process.execPath, ["dist/cli.js", "studio", "--no-open"], { cwd: new URL("..", import.meta.url), env: cleanEnvironment, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  try {
    const started = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Studio did not start. ${stderr}`)), 10_000);
      child.stdout.on("data", (chunk) => {
        const match = stdout.match(/VibePPT Studio: (http:\/\/[^\s]+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
      child.once("exit", (code) => { clearTimeout(timer); setTimeout(() => resolve({ code }), 20); });
    });
    if (typeof started !== "string") {
      if (`${stdout}\n${stderr}`.includes("listen EPERM")) {
        context.skip("The current sandbox does not allow a localhost listener.");
        return;
      }
      throw new Error(`Studio exited early (${started.code}). ${stdout} ${stderr}`);
    }
    const studioUrl = started;
    const parsed = new URL(studioUrl);
    const token = new URLSearchParams(parsed.hash.slice(1)).get("token");
    const origin = parsed.origin;
    const denied = await fetch(`${origin}/api/templates`);
    assert.equal(denied.status, 403);
    const catalog = await fetch(`${origin}/api/templates`, { headers: { "X-VibePPT-Session": token, Origin: origin } });
    assert.equal(catalog.status, 200);
    assert.equal((await catalog.json()).length, 8);
    const stopped = await fetch(`${origin}/api/shutdown`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-VibePPT-Session": token, Origin: origin },
      body: "{}",
    });
    assert.equal(stopped.status, 200);
    const exitCode = await new Promise((resolve) => child.once("exit", resolve));
    assert.equal(exitCode, 0);
  } finally {
    if (child.exitCode === null) child.kill();
  }
});
