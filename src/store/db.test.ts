import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { DataSource } from "typeorm";
import { createAppDataSource } from "../db/data-source";
import { RepoAlreadyExistsError } from "./errors";
import { DatabaseDataStore } from "./db";
import type { DataStore, TrajectoryStatus } from "./types";

void test("persists repository CRUD across data source restarts", async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "llm-garage-repos-"));
  let dataSource: DataSource | undefined;

  t.after(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
    await rm(dataDir, { recursive: true, force: true });
  });

  dataSource = createAppDataSource(dataDir);
  await dataSource.initialize();
  let store = new DatabaseDataStore(dataSource);
  await store.initialize();

  assert.equal((await store.listRepos()).length, 3);
  const created = await store.createRepo({
    owner: "example",
    name: "persistent-project",
    defaultBranch: "trunk",
    autoMerge: false,
  });
  await dataSource.destroy();

  dataSource = createAppDataSource(dataDir);
  await dataSource.initialize();
  store = new DatabaseDataStore(dataSource);
  await store.initialize();

  assert.deepEqual(await store.getRepo(created.id), created);
  assert.equal((await store.listRepos()).length, 4);
  assert.equal(await store.setRepoAutoMerge(created.id, true), true);
  await dataSource.destroy();

  dataSource = createAppDataSource(dataDir);
  await dataSource.initialize();
  store = new DatabaseDataStore(dataSource);
  await store.initialize();

  assert.equal((await store.getRepo(created.id))?.autoMerge, true);
  assert.equal(await store.deleteRepo(created.id), "deleted");
  await dataSource.destroy();

  dataSource = createAppDataSource(dataDir);
  await dataSource.initialize();
  store = new DatabaseDataStore(dataSource);
  await store.initialize();

  assert.equal(await store.getRepo(created.id), undefined);
  assert.equal((await store.listRepos()).length, 3);
});

void test("persists trajectories, turns, and ordered events across restarts", async (t) => {
  const dataDir = await mkdtemp(
    path.join(os.tmpdir(), "llm-garage-trajectories-"),
  );
  let dataSource = createAppDataSource(dataDir);
  t.after(async () => {
    if (dataSource.isInitialized) await dataSource.destroy();
    await rm(dataDir, { recursive: true, force: true });
  });
  await dataSource.initialize();
  const store = new DatabaseDataStore(dataSource, {
    seed: false,
    simulationStepMs: 5,
  });
  await store.initialize();

  const repo = await store.createRepo({
    owner: "example",
    name: "trajectory-project",
    defaultBranch: "main",
    autoMerge: false,
  });
  await assert.rejects(
    store.createRepo({
      owner: repo.owner,
      name: repo.name,
      defaultBranch: "different",
      autoMerge: false,
    }),
    RepoAlreadyExistsError,
  );

  const trajectory = await store.createTrajectory({
    repoId: repo.id,
    title: "Persist the trajectory",
    modelId: "openai/gpt-5.6-sol",
    taskPrompt: "Exercise the database store",
  });
  const [runningTurn] = await store.listTurns(trajectory.id);
  assert.ok(runningTurn);
  assert.equal((await store.listRunEvents(runningTurn.id)).length, 1);
  await waitForStatus(store, trajectory.id, "succeeded");

  const [initialTurn] = await store.listTurns(trajectory.id);
  assert.equal((await store.getTrajectory(trajectory.id))?.status, "succeeded");
  assert.equal(initialTurn?.status, "succeeded");
  assert.ok(initialTurn);
  assert.deepEqual(
    (await store.listRunEvents(initialTurn.id)).map(({ sequence }) => sequence),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  );

  const feedbackTurn = await store.addFeedback(
    trajectory.id,
    "Tighten the copy",
  );
  await waitForStatus(store, trajectory.id, "succeeded");
  assert.deepEqual(
    (await store.listRunEvents(feedbackTurn.id)).map(
      ({ sequence }) => sequence,
    ),
    [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22],
  );

  await dataSource.destroy();
  dataSource = createAppDataSource(dataDir);
  await dataSource.initialize();
  const restartedStore = new DatabaseDataStore(dataSource, { seed: false });
  await restartedStore.initialize();

  assert.equal(
    (await restartedStore.getTrajectory(trajectory.id))?.status,
    "succeeded",
  );
  assert.equal((await restartedStore.listTurns(trajectory.id)).length, 2);
  assert.deepEqual(
    (await restartedStore.listRunEvents(feedbackTurn.id)).map(
      ({ sequence }) => sequence,
    ),
    [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22],
  );
  assert.equal(await restartedStore.deleteRepo(repo.id), "in_use");
});

void test("commits cancellation state and its event together", async (t) => {
  const dataDir = await mkdtemp(
    path.join(os.tmpdir(), "llm-garage-trajectory-cancel-"),
  );
  const dataSource = createAppDataSource(dataDir);
  t.after(async () => {
    if (dataSource.isInitialized) await dataSource.destroy();
    await rm(dataDir, { recursive: true, force: true });
  });
  await dataSource.initialize();
  const store = new DatabaseDataStore(dataSource, {
    seed: false,
    simulationStepMs: 100,
  });
  await store.initialize();

  const repo = await store.createRepo({
    owner: "example",
    name: "cancel-project",
    defaultBranch: "main",
    autoMerge: false,
  });
  const trajectory = await store.createTrajectory({
    repoId: repo.id,
    title: "Cancel the trajectory",
    modelId: "openai/gpt-5.6-sol",
    taskPrompt: "Wait for cancellation",
  });

  assert.equal(await store.cancelTrajectory(trajectory.id), true);
  const [turn] = await store.listTurns(trajectory.id);
  assert.equal((await store.getTrajectory(trajectory.id))?.status, "cancelled");
  assert.equal(turn?.status, "cancelled");
  assert.ok(turn);
  assert.deepEqual(
    (await store.listRunEvents(turn.id)).map(({ data }) => data),
    ["GPT-5.6 Sol dummy worker started", "Trajectory cancelled by user"],
  );
});

void test("rejects invalid trajectory relationships without partial records", async (t) => {
  const dataDir = await mkdtemp(
    path.join(os.tmpdir(), "llm-garage-trajectory-relations-"),
  );
  const dataSource = createAppDataSource(dataDir);
  t.after(async () => {
    if (dataSource.isInitialized) await dataSource.destroy();
    await rm(dataDir, { recursive: true, force: true });
  });
  await dataSource.initialize();
  const store = new DatabaseDataStore(dataSource, {
    seed: false,
    worker: { run: async () => undefined },
  });
  await store.initialize();

  await assert.rejects(
    store.createTrajectory({
      repoId: "missing",
      title: "Invalid",
      modelId: "openai/gpt-5.6-sol",
      taskPrompt: "Do not persist this",
    }),
    /Repository not found/,
  );
  assert.deepEqual(await store.listTrajectories(), []);

  const firstRepo = await store.createRepo({
    owner: "example",
    name: "first-project",
    defaultBranch: "main",
    autoMerge: false,
  });
  const secondRepo = await store.createRepo({
    owner: "example",
    name: "second-project",
    defaultBranch: "main",
    autoMerge: false,
  });
  const parent = await store.createTrajectory({
    repoId: firstRepo.id,
    title: "Parent",
    modelId: "openai/gpt-5.6-sol",
    taskPrompt: "Create the parent",
  });
  await waitForStatus(store, parent.id, "succeeded");

  await assert.rejects(
    store.createTrajectory({
      repoId: secondRepo.id,
      parentId: parent.id,
      title: "Invalid child",
      modelId: "openai/gpt-5.6-sol",
      taskPrompt: "Cross repository boundaries",
    }),
    /different repository/,
  );
  assert.deepEqual(
    (await store.listTrajectories()).map(({ id }) => id),
    [parent.id],
  );
});

void test("persists worker failures and their terminal events", async (t) => {
  const dataDir = await mkdtemp(
    path.join(os.tmpdir(), "llm-garage-trajectory-failure-"),
  );
  const dataSource = createAppDataSource(dataDir);
  t.after(async () => {
    if (dataSource.isInitialized) await dataSource.destroy();
    await rm(dataDir, { recursive: true, force: true });
  });
  await dataSource.initialize();
  const store = new DatabaseDataStore(dataSource, {
    seed: false,
    worker: {
      run: async () => {
        throw new Error("scripted failure");
      },
    },
  });
  const repo = await store.createRepo({
    owner: "example",
    name: "failure-project",
    defaultBranch: "main",
    autoMerge: false,
  });
  const trajectory = await store.createTrajectory({
    repoId: repo.id,
    title: "Fail the trajectory",
    modelId: "openai/gpt-5.6-sol",
    taskPrompt: "Exercise failure storage",
  });

  await waitForStatus(store, trajectory.id, "failed");
  const [turn] = await store.listTurns(trajectory.id);
  assert.equal(turn?.status, "failed");
  assert.ok(turn);
  assert.deepEqual(
    (await store.listRunEvents(turn.id)).map(({ kind, sequence }) => ({
      kind,
      sequence,
    })),
    [
      { kind: "status", sequence: 1 },
      { kind: "system", sequence: 2 },
      { kind: "status", sequence: 3 },
    ],
  );
});

async function waitForStatus(
  store: DataStore,
  trajectoryId: string,
  expected: TrajectoryStatus,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if ((await store.getTrajectory(trajectoryId))?.status === expected) return;
    await delay(10);
  }
  assert.fail(`Trajectory ${trajectoryId} did not reach ${expected}`);
}
