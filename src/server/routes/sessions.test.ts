import assert from "node:assert/strict";
import test from "node:test";
import { MemoryDataStore } from "../../store/memory";
import { filterSessionsByRepo, titleFromTask } from "./sessions";

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

void test("derives a concise session title from the task", () => {
  assert.equal(titleFromTask("Fix the form\nKeep it simple"), "Fix the form");
  assert.equal(titleFromTask("a".repeat(81)), `${"a".repeat(79)}…`);
});
