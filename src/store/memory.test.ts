import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { MemoryDataStore } from "./memory";
import type { TrajectoryStatus } from "./types";

async function waitForStatus(
  store: MemoryDataStore,
  trajectoryId: string,
  expected: TrajectoryStatus,
): Promise<void> {
  const deadline = Date.now() + 500;
  while (Date.now() < deadline) {
    if ((await store.getTrajectory(trajectoryId))?.status === expected) return;
    await delay(5);
  }
  assert.equal((await store.getTrajectory(trajectoryId))?.status, expected);
}

void test("seeds repositories and every prototype trajectory state", async () => {
  const store = new MemoryDataStore();

  assert.equal((await store.listRepos()).length, 3);
  const statuses = new Set(
    (await store.listTrajectories()).map(({ status }) => status),
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
    autoMerge: false,
  });
  assert.equal(disposable.autoMerge, false);
  assert.equal(await store.setRepoAutoMerge(disposable.id, true), true);
  assert.equal((await store.getRepo(disposable.id))?.autoMerge, true);
  assert.equal(await store.setRepoAutoMerge("missing", true), false);
  assert.equal(await store.deleteRepo(disposable.id), "deleted");
  assert.equal(await store.getRepo(disposable.id), undefined);
});

void test("runs the dummy worker for initial and feedback turns", async () => {
  const store = new MemoryDataStore({ seed: false, simulationStepMs: 1 });
  const repo = await store.createRepo({
    owner: "example",
    name: "project",
    defaultBranch: "main",
    autoMerge: false,
  });
  const trajectory = await store.createTrajectory({
    repoId: repo.id,
    title: "Try the workflow",
    modelId: "z-ai/glm-5.2",
    taskPrompt: "Make a small change",
  });

  assert.equal(trajectory.status, "running");
  await waitForStatus(store, trajectory.id, "succeeded");
  const [initialTurn] = await store.listTurns(trajectory.id);
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
  assert.equal(events.at(-1)?.data, "Trajectory finished");

  await store.addFeedback(trajectory.id, "Please tighten the copy");
  assert.equal((await store.listTurns(trajectory.id)).length, 2);
  assert.equal((await store.getTrajectory(trajectory.id))?.status, "running");
  await waitForStatus(store, trajectory.id, "succeeded");

  assert.equal(await store.archiveTrajectory(trajectory.id), true);
  assert.equal((await store.getTrajectory(trajectory.id))?.status, "archived");
});

void test("records a worker failure as a terminal trajectory", async () => {
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
    autoMerge: false,
  });

  const trajectory = await store.createTrajectory({
    repoId: repo.id,
    title: "Fail predictably",
    modelId: "openai/gpt-5.6-sol",
    taskPrompt: "Exercise the failure path",
  });
  await delay(0);

  assert.equal((await store.getTrajectory(trajectory.id))?.status, "failed");
  const [turn] = await store.listTurns(trajectory.id);
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
    autoMerge: false,
  });
  const trajectory = await store.createTrajectory({
    repoId: repo.id,
    title: "Cancel me",
    modelId: "openai/gpt-5.6-sol",
    taskPrompt: "Wait",
  });

  assert.equal(await store.cancelTrajectory(trajectory.id), true);
  await delay(35);
  assert.equal((await store.getTrajectory(trajectory.id))?.status, "cancelled");
  assert.equal((await store.listTurns(trajectory.id))[0]?.status, "cancelled");
});
