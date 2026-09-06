import { Router } from "express";
import { RepoAlreadyExistsError } from "../../store/errors";
import type { DataStore } from "../../store/types";
import {
  NewRepoPage,
  RepoDetailPage,
  ReposPage,
} from "../../views/pages/repos";
import { NotFoundPage } from "../../views/pages/trajectories";
import { renderPage } from "../../views/render";
import { formField, noticeUrl, queryString } from "./forms";

export function createReposRouter(store: DataStore): Router {
  const router = Router();

  router.get("/repos", async (req, res) => {
    const [repos, trajectories] = await Promise.all([
      store.listRepos(),
      store.listTrajectories(),
    ]);
    const notice = queryString(req.query["notice"]);
    res
      .type("html")
      .send(
        renderPage(
          <ReposPage
            repos={repos}
            trajectories={trajectories}
            {...(notice === undefined ? {} : { notice })}
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
    const autoMerge = formField(req.body, "autoMerge") === "on";
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
    try {
      await store.createRepo({ owner, name, defaultBranch, autoMerge });
    } catch (error) {
      if (!(error instanceof RepoAlreadyExistsError)) throw error;
      res
        .status(409)
        .type("html")
        .send(renderPage(<NewRepoPage error={error.message} />));
      return;
    }
    res.redirect(303, noticeUrl("/repos", `Added ${owner}/${name}.`));
  });

  router.get("/repos/:id", async (req, res) => {
    const [repo, allTrajectories] = await Promise.all([
      store.getRepo(req.params.id),
      store.listTrajectories(),
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
    const trajectories = allTrajectories.filter(
      (trajectory) => trajectory.repoId === repo.id,
    );
    const notice = queryString(req.query["notice"]);
    res
      .type("html")
      .send(
        renderPage(
          <RepoDetailPage
            repo={repo}
            trajectories={trajectories}
            {...(notice === undefined ? {} : { notice })}
          />,
        ),
      );
  });

  router.post("/repos/:id/auto-merge", async (req, res) => {
    const autoMerge = formField(req.body, "autoMerge") === "on";
    const found = await store.setRepoAutoMerge(req.params.id, autoMerge);
    const notice = found
      ? `Auto-merge ${autoMerge ? "enabled" : "disabled"}.`
      : "Repository not found.";
    res.redirect(303, noticeUrl(`/repos/${req.params.id}`, notice));
  });

  router.post("/repos/:id/delete", async (req, res) => {
    const result = await store.deleteRepo(req.params.id);
    const notice =
      result === "deleted"
        ? "Deleted repository."
        : result === "in_use"
          ? "That repository is used by a trajectory and cannot be deleted yet."
          : "Repository not found.";
    res.redirect(303, noticeUrl("/repos", notice));
  });

  return router;
}
