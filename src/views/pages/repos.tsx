import type { Repo } from "../../store/types";
import { formatDate } from "../components";
import { Layout } from "../layout";

export function ReposPage({ repos, notice }: { repos: Repo[]; notice?: string }) {
  const success = notice?.startsWith("Added") || notice?.startsWith("Deleted");
  return (
    <Layout title="Repositories" section="repos">
      <div class="page-header">
        <div>
          <div class="eyebrow">Sources</div>
          <h1>Repositories</h1>
          <p>Repositories available when you start an agent session.</p>
        </div>
      </div>
      {notice && <div class={success ? "notice notice-success" : "notice"}>{notice}</div>}
      <div class="split">
        <section>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Repository</th>
                  <th>Default branch</th>
                  <th>Added</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {repos.map((repo) => (
                  <tr>
                    <td>
                      <strong>
                        {repo.owner}/{repo.name}
                      </strong>
                    </td>
                    <td>
                      <code>{repo.defaultBranch}</code>
                    </td>
                    <td>
                      <time dateTime={repo.createdAt.toISOString()}>
                        {formatDate(repo.createdAt)}
                      </time>
                    </td>
                    <td>
                      <form method="post" action={`/repos/${repo.id}/delete`}>
                        <button class="button button-danger" type="submit">
                          Delete
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section class="card sticky">
          <h2>Add a repository</h2>
          <form class="stack" method="post" action="/repos">
            <label>
              Owner
              <input name="owner" required placeholder="octocat" autocomplete="off" />
            </label>
            <label>
              Repository name
              <input name="name" required placeholder="hello-world" autocomplete="off" />
            </label>
            <label>
              Default branch
              <input name="defaultBranch" required value="main" autocomplete="off" />
            </label>
            <button class="button button-primary" type="submit">
              Add repository
            </button>
          </form>
        </section>
      </div>
    </Layout>
  );
}
