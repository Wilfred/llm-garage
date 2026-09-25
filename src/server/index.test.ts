import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, open, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

const auth = {
  AUTH_SECRET: "secret",
  AUTH_GITHUB_ID: "client-id",
  AUTH_GITHUB_SECRET: "client-secret",
  AUTH_GITHUB_USERS: "octocat",
};

void test("exits unsuccessfully when the HTTP server cannot bind", async (t) => {
  const { exitCode, stdout, stderr } = await startServer(t, {
    ...auth,
    HOST: "192.0.2.1",
  });

  assert.equal(exitCode, 1);
  assert.doesNotMatch(stdout, /llm-garage listening/);
  assert.match(stderr, /Failed to start llm-garage/);
  assert.doesNotMatch(stderr, /GitHub sign in/);
});

void test("refuses to serve a public address without sign in", async (t) => {
  const { exitCode, stdout, stderr } = await startServer(t, {
    HOST: "0.0.0.0",
  });

  assert.equal(exitCode, 1);
  assert.doesNotMatch(stdout, /llm-garage listening/);
  assert.match(stderr, /GitHub sign in must be configured/);
});

async function startServer(
  t: TestContext,
  env: NodeJS.ProcessEnv,
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "llm-garage-startup-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  // Ignore any AUTH_* settings from the parent.
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => key !== "NODE_TEST_CONTEXT" && !key.startsWith("AUTH_"),
    ),
  );
  const childEnv: NodeJS.ProcessEnv = {
    ...inherited,
    DATA_DIR: dataDir,
    PORT: "3000",
    ...env,
  };
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
  return { exitCode, stdout, stderr };
}
