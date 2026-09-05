import type { Repo } from "../../store/types";
import { Layout } from "../layout";

export function ReposPage({ repos, notice }: { repos: Repo[]; notice?: string }) {
  const success = notice?.startsWith("Added") || notice?.startsWith("Deleted");
  return (
    <Layout title="Repositories" section="repos">
      <div class="page-header">
        <div>
          <h1>Repositories</h1>
        </div>
      </div>
      {notice && <div class={success ? "notice notice-success" : "notice"}>{notice}</div>}
      <div class="split">
        <section>
          <div class="card">
            <ul class="repo-list">
              {repos.map((repo) => (
                <li>
                  <strong>
                    {repo.owner}/{repo.name}
                  </strong>
                </li>
              ))}
            </ul>
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
