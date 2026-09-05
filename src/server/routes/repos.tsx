import { Router } from "express";
import type { DataStore } from "../../store/types";
import {
  NewRepoPage,
  RepoDetailPage,
  ReposPage,
} from "../../views/pages/repos";
import { NotFoundPage } from "../../views/pages/sessions";
import { renderPage } from "../../views/render";
import { formField, noticeUrl, queryString } from "./forms";

export function createReposRouter(store: DataStore): Router {
  const router = Router();

  router.get("/repos", async (req, res) => {
    const [repos, sessions] = await Promise.all([
      store.listRepos(),
      store.listSessions(),
    ]);
    res
      .type("html")
      .send(
        renderPage(
          <ReposPage
            repos={repos}
            sessions={sessions}
            notice={queryString(req.query.notice)}
          />,
        ),
      );
  });

  router.get("/repos/new", (_req, res) => {
    res.type("html").send(renderPage(<NewRepoPage />));
  });

  router.post("/repos", async (req, res) => {
    const owner = formField(req.body, "owner");
    const name = formField(req.body, "name");
    const defaultBranch = formField(req.body, "defaultBranch");
    if (!owner || !name || !defaultBranch) {
      res
        .status(400)
        .type("html")
        .send(
          renderPage(
            <NewRepoPage error="Owner, repository name, and default branch are required." />,
          ),
        );
      return;
    }
    await store.createRepo({ owner, name, defaultBranch });
    res.redirect(303, noticeUrl("/repos", `Added ${owner}/${name}.`));
  });

  router.get("/repos/:id", async (req, res) => {
    const [repo, allSessions] = await Promise.all([
      store.getRepo(req.params.id),
      store.listSessions(),
    ]);
    if (!repo) {
      res
        .status(404)
        .type("html")
        .send(
          renderPage(
            <NotFoundPage message="That repository does not exist." />,
          ),
        );
      return;
    }
    const sessions = allSessions.filter(
      (session) => session.repoId === repo.id,
    );
    res
      .type("html")
      .send(renderPage(<RepoDetailPage repo={repo} sessions={sessions} />));
  });

  router.post("/repos/:id/delete", async (req, res) => {
    const result = await store.deleteRepo(req.params.id);
    const notice =
      result === "deleted"
        ? "Deleted repository."
        : result === "in_use"
          ? "That repository is used by a session and cannot be deleted yet."
          : "Repository not found.";
    res.redirect(303, noticeUrl("/repos", notice));
  });

  return router;
}
