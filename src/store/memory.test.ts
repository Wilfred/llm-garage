import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { MemoryDataStore } from "./memory";

test("seeds repositories and every prototype session state", async () => {
  const store = new MemoryDataStore();

  assert.equal((await store.listRepos()).length, 3);
  const statuses = new Set(
    (await store.listSessions()).map(({ status }) => status),
  );
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

test("supports the prototype repository workflow", async () => {
  const store = new MemoryDataStore({ seed: false });
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
    modelId: "z-ai/glm-5.2",
    taskPrompt: "Make a small change",
    createPr: true,
    autoMerge: false,
  });

  assert.equal(session.status, "running");
  await delay(35);
  assert.equal(
    (await store.getSession(session.id))?.status,
    "awaiting_feedback",
  );
  const [initialTurn] = await store.listTurns(session.id);
  assert.equal(initialTurn?.status, "succeeded");
  assert.equal(
    (await store.listRunEvents(initialTurn!.id)).filter(
      ({ kind }) => kind === "log",
    ).length,
    3,
  );

  await store.addFeedback(session.id, "Please tighten the copy");
  assert.equal((await store.listTurns(session.id)).length, 2);
  assert.equal((await store.getSession(session.id))?.status, "running");
  await delay(35);
  assert.equal(
    (await store.getSession(session.id))?.status,
    "awaiting_feedback",
  );

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
    modelId: "openai/gpt-5.6-sol",
    taskPrompt: "Wait",
    createPr: false,
    autoMerge: false,
  });

  assert.equal(await store.cancelSession(session.id), true);
  await delay(35);
  assert.equal((await store.getSession(session.id))?.status, "cancelled");
  assert.equal((await store.listTurns(session.id))[0]?.status, "cancelled");
});
