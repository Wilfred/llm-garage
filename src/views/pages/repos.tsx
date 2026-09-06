import type { Repo, Trajectory } from "../../store/types";
import { EmptyState, formatDate } from "../components";
import { Layout } from "../layout";

const isActive = ({ status }: Trajectory): boolean =>
  status === "running" || status === "queued";

export function ReposPage({
  repos,
  trajectories,
  notice,
}: {
  repos: Repo[];
  trajectories: Trajectory[];
  notice?: string;
}) {
  const success = notice?.startsWith("Added") || notice?.startsWith("Deleted");
  return (
    <Layout title="Repositories" section="repos">
      <div class="page-header">
        <div>
          <h1>Repositories</h1>
        </div>
        <a class="button button-primary" href="/repos/new">
          Add repository
        </a>
      </div>
      {notice && (
        <div class={success ? "notice notice-success" : "notice"}>{notice}</div>
      )}
      {repos.length === 0 ? (
        <EmptyState>
          No repositories yet. <a href="/repos/new">Add a repository</a> to get
          started.
        </EmptyState>
      ) : (
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Repository</th>
                <th>Trajectories</th>
                <th>Active</th>
              </tr>
            </thead>
            <tbody>
              {repos.map((repo) => {
                const repoTrajectories = trajectories.filter(
                  (trajectory) => trajectory.repoId === repo.id,
                );
                return (
                  <tr>
                    <td>
                      <a class="repo-name" href={`/repos/${repo.id}`}>
                        {repo.owner}/{repo.name}
                      </a>
                    </td>
                    <td>
                      <a
                        href={`/trajectories?repoId=${encodeURIComponent(repo.id)}`}
                      >
                        {repoTrajectories.length}
                      </a>
                    </td>
                    <td>{repoTrajectories.filter(isActive).length}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Layout>
  );
}

export function NewRepoPage({ error }: { error?: string }) {
  return (
    <Layout title="Add repository" section="repos">
      <div class="breadcrumb">
        <a href="/repos">Repositories</a>
        <span>/</span>
        <strong>Add repository</strong>
      </div>
      <div class="page-header">
        <div>
          <h1>Add repository</h1>
        </div>
      </div>
      {error && <div class="notice">{error}</div>}
      <form class="card stack form-card" method="post" action="/repos">
        <label>
          Owner
          <input
            name="owner"
            required
            placeholder="octocat"
            autocomplete="off"
          />
        </label>
        <label>
          Repository name
          <input
            name="name"
            required
            placeholder="hello-world"
            autocomplete="off"
          />
        </label>
        <label>
          Default branch
          <input
            name="defaultBranch"
            required
            value="main"
            autocomplete="off"
          />
        </label>
        <label class="checkbox">
          <input type="checkbox" name="autoMerge" />
          Auto-merge pull requests when required checks pass
        </label>
        <button class="button button-primary" type="submit">
          Add repository
        </button>
      </form>
    </Layout>
  );
}

export function RepoDetailPage({
  repo,
  trajectories,
  notice,
}: {
  repo: Repo;
  trajectories: Trajectory[];
  notice?: string;
}) {
  const activeCount = trajectories.filter(isActive).length;
  const trajectoriesUrl = `/trajectories?repoId=${encodeURIComponent(repo.id)}`;
  return (
    <Layout title={`${repo.owner}/${repo.name}`} section="repos">
      <div class="breadcrumb">
        <a href="/repos">Repositories</a>
        <span>/</span>
        <strong>
          {repo.owner}/{repo.name}
        </strong>
      </div>
      <div class="page-header">
        <div>
          <h1>
            {repo.owner}/{repo.name}
          </h1>
        </div>
        <div class="actions">
          <a
            class="button button-primary"
            href={`/trajectories/new?repoId=${encodeURIComponent(repo.id)}`}
          >
            New trajectory
          </a>
          <form method="post" action={`/repos/${repo.id}/delete`}>
            <button class="button button-danger" type="submit">
              Delete repository
            </button>
          </form>
        </div>
      </div>
      {notice && <div class="notice">{notice}</div>}
      <div class="grid grid-3 repo-stats">
        <section class="card">
          <h2>Default branch</h2>
          <div class="stat-value">{repo.defaultBranch}</div>
        </section>
        <section class="card">
          <h2>Trajectories</h2>
          <a class="stat-value" href={trajectoriesUrl}>
            {trajectories.length}
          </a>
        </section>
        <section class="card">
          <h2>Active trajectories</h2>
          <div class="stat-value">{activeCount}</div>
        </section>
      </div>
      <section class="card repo-auto-merge">
        <h2>Auto-merge</h2>
        <form
          class="auto-merge-form"
          method="post"
          action={`/repos/${repo.id}/auto-merge`}
        >
          <label class="checkbox">
            <input type="checkbox" name="autoMerge" checked={repo.autoMerge} />
            Merge pull requests automatically when required checks pass
          </label>
          <button class="button" type="submit">
            Save
          </button>
        </form>
      </section>
      <p class="muted small repo-created">
        Added{" "}
        <time dateTime={repo.createdAt.toISOString()}>
          {formatDate(repo.createdAt)}
        </time>
      </p>
    </Layout>
  );
}
