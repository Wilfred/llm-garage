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
  const activeRepos = repos.filter((repo) => !repo.archivedAt);
  const archivedRepos = repos.filter((repo) => repo.archivedAt);
  const success =
    notice?.startsWith("Added") ||
    notice?.startsWith("Deleted") ||
    notice?.startsWith("Archived") ||
    notice?.startsWith("Unarchived");
  return (
    <Layout title="Repositories" section="settings">
      <div class="page-header">
        <h1>Repositories</h1>
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
        <>
          {activeRepos.length > 0 && (
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Repository</th>
                    <th>Trajectories</th>
                    <th>Active</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {activeRepos.map((repo) => (
                    <RepoRow repo={repo} trajectories={trajectories} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {archivedRepos.length > 0 && (
            <div class="section-heading">
              <h2>Archived</h2>
              <span class="count">
                {archivedRepos.length} hidden from the dashboard
              </span>
            </div>
          )}
          {archivedRepos.length > 0 && (
            <div class="table-wrap">
              <table>
                <tbody>
                  {archivedRepos.map((repo) => (
                    <RepoRow repo={repo} trajectories={trajectories} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Layout>
  );
}

function RepoRow({
  repo,
  trajectories,
}: {
  repo: Repo;
  trajectories: Trajectory[];
}) {
  const repoTrajectories = trajectories.filter(
    (trajectory) => trajectory.repoId === repo.id,
  );
  return (
    <tr>
      <td>
        <a class="repo-name" href={`/repos/${repo.id}`}>
          {repo.name}
        </a>
      </td>
      <td>
        <a href={`/trajectories?repoId=${encodeURIComponent(repo.id)}`}>
          {repoTrajectories.length}
        </a>
      </td>
      <td>{repoTrajectories.filter(isActive).length}</td>
      <td>
        {repo.archivedAt ? (
          <form method="post" action={`/repos/${repo.id}/unarchive`}>
            <button class="button button-small" type="submit">
              Unarchive
            </button>
          </form>
        ) : (
          <form method="post" action={`/repos/${repo.id}/archive`}>
            <button class="button button-small" type="submit">
              Archive
            </button>
          </form>
        )}
      </td>
    </tr>
  );
}

export function NewRepoPage({ error }: { error?: string }) {
  return (
    <Layout title="Add repository" section="settings">
      <div class="breadcrumb">
        <a href="/repos">Repositories</a>
        <span>/</span>
        <strong>Add repository</strong>
      </div>
      <h1 class="page-intro">Add repository</h1>
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
    <Layout title={repo.name} section="settings">
      <div class="breadcrumb">
        <a href="/repos">Repositories</a>
        <span>/</span>
        <strong>{repo.name}</strong>
      </div>
      <div class="page-header">
        <h1>{repo.name}</h1>
        <div class="actions">
          <a
            class="button button-primary"
            href={`/trajectories/new?repoId=${encodeURIComponent(repo.id)}`}
          >
            New trajectory
          </a>
          {repo.archivedAt ? (
            <form method="post" action={`/repos/${repo.id}/unarchive`}>
              <button class="button" type="submit">
                Unarchive
              </button>
            </form>
          ) : (
            <form method="post" action={`/repos/${repo.id}/archive`}>
              <button class="button" type="submit">
                Archive
              </button>
            </form>
          )}
          <form method="post" action={`/repos/${repo.id}/delete`}>
            <button class="button button-danger" type="submit">
              Delete repository
            </button>
          </form>
        </div>
      </div>
      {notice && <div class="notice">{notice}</div>}
      {repo.archivedAt && (
        <div class="notice">
          This repository is archived and hidden from the dashboard and
          trajectory forms.
        </div>
      )}
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
      <p class="muted small repo-created">
        Added{" "}
        <time dateTime={repo.createdAt.toISOString()}>
          {formatDate(repo.createdAt)}
        </time>
      </p>
    </Layout>
  );
}
