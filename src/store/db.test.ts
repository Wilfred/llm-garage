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
import type { DataStore, SessionStatus } from "./types";

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
  });
  await dataSource.destroy();

  dataSource = createAppDataSource(dataDir);
  await dataSource.initialize();
  store = new DatabaseDataStore(dataSource);
  await store.initialize();

  assert.deepEqual(await store.getRepo(created.id), created);
  assert.equal((await store.listRepos()).length, 4);
  assert.equal(await store.deleteRepo(created.id), "deleted");
  await dataSource.destroy();

  dataSource = createAppDataSource(dataDir);
  await dataSource.initialize();
  store = new DatabaseDataStore(dataSource);
  await store.initialize();

  assert.equal(await store.getRepo(created.id), undefined);
  assert.equal((await store.listRepos()).length, 3);
});

void test("persists sessions, turns, and ordered events across restarts", async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "llm-garage-sessions-"));
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
    name: "session-project",
    defaultBranch: "main",
  });
  await assert.rejects(
    store.createRepo({
      owner: repo.owner,
      name: repo.name,
      defaultBranch: "different",
    }),
    RepoAlreadyExistsError,
  );

  const session = await store.createSession({
    repoId: repo.id,
    title: "Persist the session",
    modelId: "openai/gpt-5.6-sol",
    taskPrompt: "Exercise the database store",
    createPr: false,
    autoMerge: false,
  });
  assert.equal(
    (await store.listRunEvents((await store.listTurns(session.id))[0]!.id))
      .length,
    1,
  );
  await waitForStatus(store, session.id, "succeeded");

  const [initialTurn] = await store.listTurns(session.id);
  assert.equal((await store.getSession(session.id))?.status, "succeeded");
  assert.equal(initialTurn?.status, "succeeded");
  assert.deepEqual(
    (await store.listRunEvents(initialTurn!.id)).map(
      ({ sequence }) => sequence,
    ),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  );

  const feedbackTurn = await store.addFeedback(session.id, "Tighten the copy");
  await waitForStatus(store, session.id, "succeeded");
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
    (await restartedStore.getSession(session.id))?.status,
    "succeeded",
  );
  assert.equal((await restartedStore.listTurns(session.id)).length, 2);
  assert.deepEqual(
    (await restartedStore.listRunEvents(feedbackTurn.id)).map(
      ({ sequence }) => sequence,
    ),
    [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22],
  );
  assert.equal(await restartedStore.deleteRepo(repo.id), "in_use");
});

test("commits cancellation state and its event together", async (t) => {
  const dataDir = await mkdtemp(
    path.join(os.tmpdir(), "llm-garage-session-cancel-"),
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
  });
  const session = await store.createSession({
    repoId: repo.id,
    title: "Cancel the session",
    modelId: "openai/gpt-5.6-sol",
    taskPrompt: "Wait for cancellation",
    createPr: false,
    autoMerge: false,
  });

  assert.equal(await store.cancelSession(session.id), true);
  const [turn] = await store.listTurns(session.id);
  assert.equal((await store.getSession(session.id))?.status, "cancelled");
  assert.equal(turn?.status, "cancelled");
  assert.deepEqual(
    (await store.listRunEvents(turn!.id)).map(({ data }) => data),
    ["GPT-5.6 Sol dummy worker started", "Session cancelled by user"],
  );
});

test("rejects invalid session relationships without partial records", async (t) => {
  const dataDir = await mkdtemp(
    path.join(os.tmpdir(), "llm-garage-session-relations-"),
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
    store.createSession({
      repoId: "missing",
      title: "Invalid",
      modelId: "openai/gpt-5.6-sol",
      taskPrompt: "Do not persist this",
      createPr: false,
      autoMerge: false,
    }),
    /Repository not found/,
  );
  assert.deepEqual(await store.listSessions(), []);

  const firstRepo = await store.createRepo({
    owner: "example",
    name: "first-project",
    defaultBranch: "main",
  });
  const secondRepo = await store.createRepo({
    owner: "example",
    name: "second-project",
    defaultBranch: "main",
  });
  const parent = await store.createSession({
    repoId: firstRepo.id,
    title: "Parent",
    modelId: "openai/gpt-5.6-sol",
    taskPrompt: "Create the parent",
    createPr: false,
    autoMerge: false,
  });
  await waitForStatus(store, parent.id, "succeeded");

  await assert.rejects(
    store.createSession({
      repoId: secondRepo.id,
      parentId: parent.id,
      title: "Invalid child",
      modelId: "openai/gpt-5.6-sol",
      taskPrompt: "Cross repository boundaries",
      createPr: false,
      autoMerge: false,
    }),
    /different repository/,
  );
  assert.deepEqual(
    (await store.listSessions()).map(({ id }) => id),
    [parent.id],
  );
});

test("persists worker failures and their terminal events", async (t) => {
  const dataDir = await mkdtemp(
    path.join(os.tmpdir(), "llm-garage-session-failure-"),
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
  });
  const session = await store.createSession({
    repoId: repo.id,
    title: "Fail the session",
    modelId: "openai/gpt-5.6-sol",
    taskPrompt: "Exercise failure storage",
    createPr: false,
    autoMerge: false,
  });

  await waitForStatus(store, session.id, "failed");
  const [turn] = await store.listTurns(session.id);
  assert.equal(turn?.status, "failed");
  assert.deepEqual(
    (await store.listRunEvents(turn!.id)).map(({ kind, sequence }) => ({
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
  sessionId: string,
  expected: SessionStatus,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if ((await store.getSession(sessionId))?.status === expected) return;
    await delay(10);
  }
  assert.fail(`Session ${sessionId} did not reach ${expected}`);
}
