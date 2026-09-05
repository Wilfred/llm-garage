import assert from "node:assert/strict";
import test from "node:test";
import { MemoryDataStore } from "../../store/memory";
import { renderPage } from "../render";
import { DashboardPage } from "./dashboard";
import { ReposPage } from "./repos";
import { NewSessionPage, SessionsPage } from "./sessions";

test("keeps the primary navigation focused", async () => {
  const store = new MemoryDataStore();
  const [repos, sessions] = await Promise.all([store.listRepos(), store.listSessions()]);
  const html = renderPage(<DashboardPage repos={repos} sessions={sessions} />);

  assert.match(html, /🛠️/u);
  assert.match(html, /href="\/sessions"/);
  assert.doesNotMatch(html, /href="\/prompts"/);
  assert.doesNotMatch(html, /Workshop overview/);
  assert.doesNotMatch(html, /Start a session/);
  assert.equal(html.match(/href="\/sessions\/new"/g)?.length, 1);
});

test("renders the repository listing without branch or delete controls", async () => {
  const store = new MemoryDataStore();
  const html = renderPage(<ReposPage repos={await store.listRepos()} />);

  assert.doesNotMatch(html, /Sources/);
  assert.doesNotMatch(html, />master</);
  assert.doesNotMatch(html, /\/delete"/);
});

test("lists every session on the sessions page", async () => {
  const store = new MemoryDataStore();
  const [repos, sessions] = await Promise.all([store.listRepos(), store.listSessions()]);
  const html = renderPage(<SessionsPage repos={repos} sessions={sessions} />);

  for (const session of sessions) assert.match(html, new RegExp(session.title));
});

test("new-session form has no prompt-library controls", async () => {
  const store = new MemoryDataStore();
  const html = renderPage(
    <NewSessionPage
      repos={await store.listRepos()}
      sessions={await store.listSessions()}
    />,
  );

  assert.doesNotMatch(html, /system prompt/i);
  assert.doesNotMatch(html, /composed prompt/i);
  assert.doesNotMatch(html, /systemPromptExtra/);
});
