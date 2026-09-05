import { Router } from "express";
import type { DataStore } from "../../store/types";
import { ReposPage } from "../../views/pages/repos";
import { renderPage } from "../../views/render";
import { formField, noticeUrl, queryString } from "./forms";

export function createReposRouter(store: DataStore): Router {
  const router = Router();

  router.get("/repos", async (req, res) => {
    const repos = await store.listRepos();
    res
      .type("html")
      .send(
        renderPage(<ReposPage repos={repos} notice={queryString(req.query.notice)} />),
      );
  });

  router.post("/repos", async (req, res) => {
    const owner = formField(req.body, "owner");
    const name = formField(req.body, "name");
    const defaultBranch = formField(req.body, "defaultBranch");
    if (!owner || !name || !defaultBranch) {
      const repos = await store.listRepos();
      res
        .status(400)
        .type("html")
        .send(
          renderPage(
            <ReposPage
              repos={repos}
              notice="Owner, repository name, and default branch are required."
            />,
          ),
        );
      return;
    }
    await store.createRepo({ owner, name, defaultBranch });
    res.redirect(303, noticeUrl("/repos", `Added ${owner}/${name}.`));
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
