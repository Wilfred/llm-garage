import type { PromptVersion, Repo, SystemPrompt } from "../../store/types";
import { formatDate } from "../components";
import { Layout } from "../layout";

export type PromptListItem = {
  prompt: SystemPrompt;
  latest?: PromptVersion;
  versionCount: number;
};

export function PromptsPage({
  items,
  repos,
  basePromptId,
  notice,
}: {
  items: PromptListItem[];
  repos: Repo[];
  basePromptId?: string;
  notice?: string;
}) {
  const globalPrompts = items.filter(({ prompt }) => prompt.scope === "global");
  return (
    <Layout title="Prompt library" section="prompts">
      <div class="page-header">
        <div>
          <div class="eyebrow">Tailoring</div>
          <h1>Prompt library</h1>
          <p>
            Version the working instructions your agents receive. Existing sessions keep
            their original snapshot.
          </p>
        </div>
      </div>
      {notice && <div class="notice notice-success">{notice}</div>}
      <div class="split">
        <section class="stack">
          {items.map(({ prompt, latest, versionCount }) => {
            const repo = repos.find(({ id }) => id === prompt.repoId);
            return (
              <a class="card card-link" href={`/prompts/${prompt.id}`}>
                <div class="card-meta">
                  <span>
                    {prompt.scope === "global"
                      ? "Global"
                      : repo
                        ? `${repo.owner}/${repo.name}`
                        : "Repository"}
                  </span>
                  <span>
                    {versionCount} version{versionCount === 1 ? "" : "s"}
                  </span>
                  {basePromptId === prompt.id && <span>Base prompt</span>}
                </div>
                <div class="card-title">{prompt.name}</div>
                <p class="muted small">
                  {latest?.content.slice(0, 150) ?? "No content yet"}
                </p>
              </a>
            );
          })}
        </section>
        <aside class="stack sticky">
          <section class="card">
            <h2>Base prompt</h2>
            <p class="muted small">
              The global foundation composed into every new session.
            </p>
            <form class="stack" method="post" action="/settings/base-prompt">
              <label>
                Selected prompt
                <select name="promptId">
                  <option value="">No base prompt</option>
                  {globalPrompts.map(({ prompt }) => (
                    <option value={prompt.id} selected={prompt.id === basePromptId}>
                      {prompt.name}
                    </option>
                  ))}
                </select>
              </label>
              <button class="button" type="submit">
                Save base prompt
              </button>
            </form>
          </section>
          <section class="card">
            <h2>Create a prompt</h2>
            <form class="stack" method="post" action="/prompts">
              <label>
                Name
                <input name="name" required placeholder="Review conventions" />
              </label>
              <label>
                Scope
                <select name="scope">
                  <option value="global">Global</option>
                  <option value="repo">Repository</option>
                </select>
              </label>
              <label>
                Repository <span class="help">Required only for repository prompts.</span>
                <select name="repoId">
                  <option value="">Choose a repository</option>
                  {repos.map((repo) => (
                    <option value={repo.id}>
                      {repo.owner}/{repo.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Initial content
                <textarea
                  name="content"
                  required
                  placeholder="Instructions for the agent…"
                />
              </label>
              <label>
                Version note
                <input name="note" placeholder="Initial version" />
              </label>
              <button class="button button-primary" type="submit">
                Create prompt
              </button>
            </form>
          </section>
        </aside>
      </div>
    </Layout>
  );
}

export function PromptDetailPage({
  prompt,
  versions,
  repo,
}: {
  prompt: SystemPrompt;
  versions: PromptVersion[];
  repo?: Repo;
}) {
  return (
    <Layout title={prompt.name} section="prompts">
      <div class="breadcrumb">
        <a href="/prompts">Prompts</a>
        <span>/</span>
        <strong>{prompt.name}</strong>
      </div>
      <div class="page-header">
        <div>
          <div class="eyebrow">
            {prompt.scope === "global"
              ? "Global prompt"
              : repo
                ? `${repo.owner}/${repo.name}`
                : "Repository prompt"}
          </div>
          <h1>{prompt.name}</h1>
          <p>
            Editing appends an immutable version; session snapshots never change
            retroactively.
          </p>
        </div>
      </div>
      <div class="split">
        <section class="stack">
          <div class="section-heading">
            <h2>Version history</h2>
            <span class="count">{versions.length} total</span>
          </div>
          {versions.map((version, index) => (
            <article class={`card version ${index === 0 ? "version-current" : ""}`}>
              <div class="turn-header">
                <strong>
                  {index === 0 ? "Current version" : `Version ${versions.length - index}`}
                </strong>
                <time class="muted small" dateTime={version.createdAt.toISOString()}>
                  {formatDate(version.createdAt)}
                </time>
              </div>
              {version.note && <p class="muted small">{version.note}</p>}
              <pre>{version.content}</pre>
            </article>
          ))}
        </section>
        <section class="card sticky">
          <h2>Add a version</h2>
          <form class="stack" method="post" action={`/prompts/${prompt.id}/versions`}>
            <label>
              Prompt content
              <textarea class="mono" name="content" required>
                {versions[0]?.content}
              </textarea>
            </label>
            <label>
              What changed?
              <input name="note" placeholder="Tighten test guidance" />
            </label>
            <button class="button button-primary" type="submit">
              Save new version
            </button>
          </form>
        </section>
      </div>
    </Layout>
  );
}
