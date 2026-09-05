import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { MemoryDataStore } from "./memory";
import type { SessionStatus } from "./types";

async function waitForStatus(
  store: MemoryDataStore,
  sessionId: string,
  expected: SessionStatus,
): Promise<void> {
  const deadline = Date.now() + 500;
  while (Date.now() < deadline) {
    if ((await store.getSession(sessionId))?.status === expected) return;
    await delay(5);
  }
  assert.equal((await store.getSession(sessionId))?.status, expected);
}

void test("seeds repositories and every prototype session state", async () => {
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

void test("supports the prototype repository workflow", async () => {
  const store = new MemoryDataStore({ seed: false });
  const disposable = await store.createRepo({
    owner: "example",
    name: "scratch",
    defaultBranch: "trunk",
  });
  assert.equal(await store.deleteRepo(disposable.id), "deleted");
  assert.equal(await store.getRepo(disposable.id), undefined);
});

void test("runs the dummy worker for initial and feedback turns", async () => {
  const store = new MemoryDataStore({ seed: false, simulationStepMs: 1 });
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
  await waitForStatus(store, session.id, "succeeded");
  const [initialTurn] = await store.listTurns(session.id);
  assert.equal(initialTurn?.status, "succeeded");
  assert.ok(initialTurn);
  const events = await store.listRunEvents(initialTurn.id);
  assert.deepEqual(
    events.map(({ kind }) => kind),
    [
      "status",
      "model_output",
      "tool",
      "model_output",
      "tool",
      "model_output",
      "tool",
      "tool",
      "usage",
      "model_output",
      "status",
    ],
  );
  assert.equal(events.at(-1)?.data, "Session finished");

  await store.addFeedback(session.id, "Please tighten the copy");
  assert.equal((await store.listTurns(session.id)).length, 2);
  assert.equal((await store.getSession(session.id))?.status, "running");
  await waitForStatus(store, session.id, "succeeded");

  assert.equal(await store.archiveSession(session.id), true);
  assert.equal((await store.getSession(session.id))?.status, "archived");
});

void test("records a worker failure as a terminal session", async () => {
  const store = new MemoryDataStore({
    seed: false,
    worker: {
      run: async () => {
        throw new Error("Synthetic provider failure");
      },
    },
  });
  const repo = await store.createRepo({
    owner: "example",
    name: "project",
    defaultBranch: "main",
  });

  const session = await store.createSession({
    repoId: repo.id,
    title: "Fail predictably",
    modelId: "openai/gpt-5.6-sol",
    taskPrompt: "Exercise the failure path",
    createPr: false,
    autoMerge: false,
  });
  await delay(0);

  assert.equal((await store.getSession(session.id))?.status, "failed");
  const [turn] = await store.listTurns(session.id);
  assert.equal(turn?.status, "failed");
  assert.ok(turn);
  const events = await store.listRunEvents(turn.id);
  const systemEvent = events.find(({ kind }) => kind === "system");
  assert.ok(systemEvent);
  assert.match(systemEvent.data, /Synthetic provider failure/);
});

void test("cancels a running prototype turn without later changing its state", async () => {
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
