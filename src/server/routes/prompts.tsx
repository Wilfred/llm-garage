import { Router } from "express";
import type { DataStore, PromptScope } from "../../store/types";
import {
  PromptDetailPage,
  PromptsPage,
  type PromptListItem,
} from "../../views/pages/prompts";
import { NotFoundPage } from "../../views/pages/sessions";
import { renderPage } from "../../views/render";
import { formField, noticeUrl, queryString } from "./forms";

export function createPromptsRouter(store: DataStore): Router {
  const router = Router();

  router.get("/prompts", async (req, res) => {
    const [prompts, repos, basePromptId] = await Promise.all([
      store.listPrompts(),
      store.listRepos(),
      store.getBasePromptId(),
    ]);
    const items: PromptListItem[] = await Promise.all(
      prompts.map(async (prompt) => {
        const versions = await store.listPromptVersions(prompt.id);
        return { prompt, latest: versions[0], versionCount: versions.length };
      }),
    );
    res
      .type("html")
      .send(
        renderPage(
          <PromptsPage
            items={items}
            repos={repos}
            basePromptId={basePromptId}
            notice={queryString(req.query.notice)}
          />,
        ),
      );
  });

  router.post("/prompts", async (req, res) => {
    const name = formField(req.body, "name");
    const content = formField(req.body, "content");
    const scopeValue = formField(req.body, "scope");
    const scope: PromptScope = scopeValue === "repo" ? "repo" : "global";
    const repoId = formField(req.body, "repoId") || undefined;
    const note = formField(req.body, "note") || undefined;
    if (!name || !content || (scope === "repo" && !repoId)) {
      res.redirect(
        303,
        noticeUrl("/prompts", "Name, content, and repository scope are required."),
      );
      return;
    }
    const prompt = await store.createPrompt({ name, content, scope, repoId, note });
    res.redirect(303, `/prompts/${prompt.id}`);
  });

  router.post("/settings/base-prompt", async (req, res) => {
    await store.setBasePrompt(formField(req.body, "promptId") || undefined);
    res.redirect(303, noticeUrl("/prompts", "Base prompt updated."));
  });

  router.get("/prompts/:id", async (req, res) => {
    const prompt = await store.getPrompt(req.params.id);
    if (!prompt) {
      res
        .status(404)
        .type("html")
        .send(renderPage(<NotFoundPage message="That prompt does not exist." />));
      return;
    }
    const [versions, repo] = await Promise.all([
      store.listPromptVersions(prompt.id),
      prompt.repoId ? store.getRepo(prompt.repoId) : Promise.resolve(undefined),
    ]);
    res
      .type("html")
      .send(
        renderPage(<PromptDetailPage prompt={prompt} versions={versions} repo={repo} />),
      );
  });

  router.post("/prompts/:id/versions", async (req, res) => {
    const content = formField(req.body, "content");
    if (!content) {
      res.redirect(303, req.get("referer") ?? "/prompts");
      return;
    }
    await store.addPromptVersion(
      req.params.id,
      content,
      formField(req.body, "note") || undefined,
    );
    res.redirect(303, `/prompts/${req.params.id}`);
  });

  return router;
}
