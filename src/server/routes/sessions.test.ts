import assert from "node:assert/strict";
import test from "node:test";
import { MemoryDataStore } from "../../store/memory";
import { filterSessionsByRepo } from "./sessions";

void test("filters sessions by a known repository", async () => {
  const store = new MemoryDataStore();
  const [repos, sessions] = await Promise.all([
    store.listRepos(),
    store.listSessions(),
  ]);

  const filtered = filterSessionsByRepo(repos, sessions, "repo-parser");

  assert.equal(filtered.selectedRepo?.id, "repo-parser");
  assert.ok(filtered.visibleSessions.length > 0);
  assert.ok(
    filtered.visibleSessions.every(({ repoId }) => repoId === "repo-parser"),
  );
});

void test("ignores an unknown repository filter", async () => {
  const store = new MemoryDataStore();
  const [repos, sessions] = await Promise.all([
    store.listRepos(),
    store.listSessions(),
  ]);

  const filtered = filterSessionsByRepo(repos, sessions, "missing");

  assert.equal(filtered.selectedRepo, undefined);
  assert.deepEqual(filtered.visibleSessions, sessions);
});
