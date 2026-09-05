import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, open, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

void test("exits unsuccessfully when the HTTP server cannot bind", async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "llm-garage-startup-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    DATA_DIR: dataDir,
    HOST: "192.0.2.1",
    PORT: "3000",
  };
  delete childEnv["NODE_TEST_CONTEXT"];
  const stdoutPath = path.join(dataDir, "stdout.log");
  const stderrPath = path.join(dataDir, "stderr.log");
  const stdoutFile = await open(stdoutPath, "w");
  const stderrFile = await open(stderrPath, "w");

  const child = spawn(
    process.execPath,
    ["--import", "tsx", path.resolve("src/server/index.ts")],
    {
      env: childEnv,
      stdio: ["ignore", stdoutFile.fd, stderrFile.fd],
    },
  );

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  await Promise.all([stdoutFile.close(), stderrFile.close()]);
  const [stdout, stderr] = await Promise.all([
    readFile(stdoutPath, "utf8"),
    readFile(stderrPath, "utf8"),
  ]);

  assert.equal(exitCode, 1);
  assert.doesNotMatch(stdout, /llm-garage listening/);
  assert.match(stderr, /Failed to start llm-garage/);
});
