import assert from "node:assert/strict";
import test from "node:test";
import { MemoryDataStore } from "../../store/memory";
import { renderPage } from "../render";
import { DashboardPage } from "./dashboard";
import { NewRepoPage, RepoDetailPage, ReposPage } from "./repos";
import { NewSessionPage, SessionsPage } from "./sessions";

void test("keeps the primary navigation focused", async () => {
  const store = new MemoryDataStore();
  const [repos, sessions] = await Promise.all([
    store.listRepos(),
    store.listSessions(),
  ]);
  const html = renderPage(<DashboardPage repos={repos} sessions={sessions} />);

  assert.match(html, /🛠️/u);
  assert.match(html, /href="\/sessions"/);
  assert.doesNotMatch(html, /href="\/prompts"/);
  assert.doesNotMatch(
    html,
    /<nav[^>]*>(?:(?!<\/nav>).)*>(?:Dashboard|About)</s,
  );
  assert.doesNotMatch(html, /Workshop overview/);
  assert.doesNotMatch(html, /Start a session/);
  assert.equal(html.match(/href="\/sessions\/new"/g)?.length, 1);
});

void test("loads page styles from the shared stylesheet", () => {
  const html = renderPage(<DashboardPage repos={[]} sessions={[]} />);

  assert.match(html, /<link rel="stylesheet" href="\/styles\.css"\/>/);
  assert.doesNotMatch(html, /<style>/);
});

void test("renders the repository listing without branch or delete controls", async () => {
  const store = new MemoryDataStore();
  const [repos, sessions] = await Promise.all([
    store.listRepos(),
    store.listSessions(),
  ]);
  const html = renderPage(<ReposPage repos={repos} sessions={sessions} />);

  assert.doesNotMatch(html, /Sources/);
  assert.doesNotMatch(html, />master</);
  assert.doesNotMatch(html, /\/delete"/);
  assert.match(html, /href="\/repos\/new"/);
  for (const repo of repos) {
    const repoSessions = sessions.filter(
      (session) => session.repoId === repo.id,
    );
    assert.match(html, new RegExp(`href="/repos/${repo.id}"`));
    assert.match(
      html,
      new RegExp(
        `href="/sessions\\?repoId=${repo.id}">${repoSessions.length.toString()}</a>`,
      ),
    );
  }
});

void test("renders repository creation on its own page", () => {
  const html = renderPage(<NewRepoPage />);

  assert.match(
    html,
    /<form class="card stack form-card" method="post" action="\/repos">/,
  );
  assert.match(html, /<h1>Add repository<\/h1>/);
});

void test("renders repository details and session counts", async () => {
  const store = new MemoryDataStore();
  const repo = (await store.listRepos()).find(({ id }) => id === "repo-garage");
  assert.ok(repo);
  const sessions = (await store.listSessions()).filter(
    (session) => session.repoId === repo.id,
  );
  const html = renderPage(<RepoDetailPage repo={repo} sessions={sessions} />);

  assert.match(html, /Default branch/);
  assert.match(html, />main</);
  assert.match(
    html,
    /<h2>Active sessions<\/h2><div class="stat-value">2<\/div>/,
  );
  assert.match(html, /href="\/sessions\?repoId=repo-garage">4<\/a>/);
});

void test("lists every session on the sessions page", async () => {
  const store = new MemoryDataStore();
  const [repos, sessions] = await Promise.all([
    store.listRepos(),
    store.listSessions(),
  ]);
  const html = renderPage(<SessionsPage repos={repos} sessions={sessions} />);

  for (const session of sessions) assert.match(html, new RegExp(session.title));
});

void test("labels a repository-filtered sessions page", async () => {
  const store = new MemoryDataStore();
  const repos = await store.listRepos();
  const selectedRepo = repos[0];
  assert.ok(selectedRepo);
  const sessions = (await store.listSessions()).filter(
    (session) => session.repoId === selectedRepo.id,
  );
  const html = renderPage(
    <SessionsPage
      repos={repos}
      sessions={sessions}
      selectedRepo={selectedRepo}
    />,
  );

  assert.match(
    html,
    new RegExp(`Showing sessions for.*${selectedRepo.name}`, "s"),
  );
  assert.match(html, /href="\/sessions">Clear filter<\/a>/);
  for (const session of sessions) assert.match(html, new RegExp(session.title));
  for (const session of await store.listSessions()) {
    if (session.repoId !== selectedRepo.id) {
      assert.doesNotMatch(html, new RegExp(session.title));
    }
  }
});

void test("new-session form has no prompt-library controls", async () => {
  const store = new MemoryDataStore();
  const html = renderPage(<NewSessionPage repos={await store.listRepos()} />);

  assert.doesNotMatch(html, /system prompt/i);
  assert.doesNotMatch(html, /composed prompt/i);
  assert.doesNotMatch(html, /systemPromptExtra/);
  assert.doesNotMatch(html, />Runner</);
  assert.doesNotMatch(html, /Codex/);
  assert.doesNotMatch(html, /<label/);
  assert.doesNotMatch(html, /name="(?:title|parentId|createPr|autoMerge)"/);
  assert.doesNotMatch(html, /After the run/);
  assert.match(html, /placeholder="Describe the outcome you want…"/);
  assert.match(html, /value="openai\/gpt-5\.6-sol"/);
  assert.match(html, /value="anthropic\/claude-opus-5"/);
  assert.match(html, /value="moonshotai\/kimi-k3"/);
  assert.match(html, /value="z-ai\/glm-5\.2"/);
});

void test("identifies each session's model and OpenRouter gateway", async () => {
  const store = new MemoryDataStore();
  const repos = await store.listRepos();
  const sessions = await store.listSessions();
  const html = renderPage(<SessionsPage repos={repos} sessions={sessions} />);

  assert.match(html, /GPT-5\.6 Sol via OpenRouter/);
  assert.match(html, /Claude Opus 5 via OpenRouter/);
  assert.match(html, /Kimi K3 via OpenRouter/);
  assert.match(html, /GLM 5\.2 via OpenRouter/);
  assert.doesNotMatch(html, /codex runner/i);
});
