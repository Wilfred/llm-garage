import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { MemoryDataStore } from "./memory";

test("seeds repositories, versioned prompts, and every prototype session state", async () => {
  const store = new MemoryDataStore();

  assert.equal((await store.listRepos()).length, 3);
  assert.equal((await store.listPromptVersions("prompt-base")).length, 3);
  const statuses = new Set((await store.listSessions()).map(({ status }) => status));
  for (const status of [
    "running",
    "awaiting_feedback",
    "succeeded",
    "failed",
    "archived",
  ]) {
    assert.ok(statuses.has(status as never), `expected a ${status} fixture`);
  }
});

test("supports the prototype repo and prompt workflows", async () => {
  const store = new MemoryDataStore({ seed: false });
  const repo = await store.createRepo({
    owner: "example",
    name: "project",
    defaultBranch: "main",
  });
  const base = await store.createPrompt({
    name: "Base",
    scope: "global",
    content: "Escape untrusted output.",
  });
  await store.addPromptVersion(base.id, "Escape output and run tests.", "Add tests");
  await store.setBasePrompt(base.id);
  await store.createPrompt({
    name: "Repo rules",
    scope: "repo",
    repoId: repo.id,
    content: "Use strict TypeScript.",
  });

  assert.equal((await store.listPromptVersions(base.id)).length, 2);
  assert.equal(
    await store.composeSystemPrompt(repo.id, "Keep the diff small."),
    "## Base\n\nEscape output and run tests.\n\n## Repo rules\n\nUse strict TypeScript.\n\n## Session instructions\n\nKeep the diff small.",
  );
  assert.equal(await store.deleteRepo(repo.id), "in_use");

  const disposable = await store.createRepo({
    owner: "example",
    name: "scratch",
    defaultBranch: "trunk",
  });
  assert.equal(await store.deleteRepo(disposable.id), "deleted");
  assert.equal(await store.getRepo(disposable.id), undefined);
});

test("simulates initial and feedback turns, then archives the session", async () => {
  const store = new MemoryDataStore({ seed: false, simulationStepMs: 5 });
  const repo = await store.createRepo({
    owner: "example",
    name: "project",
    defaultBranch: "main",
  });
  const session = await store.createSession({
    repoId: repo.id,
    title: "Try the workflow",
    runner: "echo",
    taskPrompt: "Make a small change",
    systemPromptExtra: "Be concise",
    createPr: true,
    autoMerge: false,
  });

  assert.equal(session.status, "running");
  await delay(35);
  assert.equal((await store.getSession(session.id))?.status, "awaiting_feedback");
  const [initialTurn] = await store.listTurns(session.id);
  assert.equal(initialTurn?.status, "succeeded");
  assert.equal(
    (await store.listRunEvents(initialTurn!.id)).filter(({ kind }) => kind === "log")
      .length,
    3,
  );

  await store.addFeedback(session.id, "Please tighten the copy");
  assert.equal((await store.listTurns(session.id)).length, 2);
  assert.equal((await store.getSession(session.id))?.status, "running");
  await delay(35);
  assert.equal((await store.getSession(session.id))?.status, "awaiting_feedback");

  assert.equal(await store.archiveSession(session.id), true);
  assert.equal((await store.getSession(session.id))?.status, "archived");
});

test("cancels a running prototype turn without later changing its state", async () => {
  const store = new MemoryDataStore({ seed: false, simulationStepMs: 5 });
  const repo = await store.createRepo({
    owner: "example",
    name: "project",
    defaultBranch: "main",
  });
  const session = await store.createSession({
    repoId: repo.id,
    title: "Cancel me",
    runner: "codex",
    taskPrompt: "Wait",
    systemPromptExtra: "",
    createPr: false,
    autoMerge: false,
  });

  assert.equal(await store.cancelSession(session.id), true);
  await delay(35);
  assert.equal((await store.getSession(session.id))?.status, "cancelled");
  assert.equal((await store.listTurns(session.id))[0]?.status, "cancelled");
});
