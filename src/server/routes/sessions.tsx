import { Router } from "express";
import type { DataStore, RunnerName, Session } from "../../store/types";
import {
  NewSessionPage,
  NotFoundPage,
  SessionDetailPage,
  type TurnTranscript,
} from "../../views/pages/sessions";
import { renderPage } from "../../views/render";
import { formField } from "./forms";

const newSessionScript = `(() => {
  const repo = document.querySelector("#repo-id");
  const extra = document.querySelector("#system-prompt-extra");
  const preview = document.querySelector("#composed-preview");
  const createPr = document.querySelector("#create-pr");
  const autoMerge = document.querySelector("#auto-merge");
  if (!repo || !extra || !preview) return;
  let request = 0;
  const update = async () => {
    const current = ++request;
    const params = new URLSearchParams({ repoId: repo.value, extra: extra.value });
    const response = await fetch("/sessions/compose-preview?" + params.toString());
    if (response.ok && current === request) preview.value = (await response.json()).composed;
  };
  repo.addEventListener("change", update);
  extra.addEventListener("input", update);
  if (createPr && autoMerge) {
    createPr.addEventListener("change", () => { autoMerge.disabled = !createPr.checked; if (!createPr.checked) autoMerge.checked = false; });
    autoMerge.addEventListener("change", () => { if (autoMerge.checked) createPr.checked = true; });
  }
})();`;

export function createSessionsRouter(store: DataStore): Router {
  const router = Router();

  router.get("/assets/new-session.js", (_req, res) => {
    res.type("application/javascript").send(newSessionScript);
  });

  router.get("/sessions/compose-preview", async (req, res) => {
    const repoId = typeof req.query.repoId === "string" ? req.query.repoId : "";
    const extra = typeof req.query.extra === "string" ? req.query.extra : "";
    res.json({ composed: await store.composeSystemPrompt(repoId, extra) });
  });

  router.get("/sessions/new", async (_req, res) => {
    const [repos, sessions] = await Promise.all([
      store.listRepos(),
      store.listSessions(),
    ]);
    const initialPreview = repos[0]
      ? await store.composeSystemPrompt(repos[0].id, "")
      : "";
    res
      .type("html")
      .send(
        renderPage(
          <NewSessionPage
            repos={repos}
            sessions={sessions}
            initialPreview={initialPreview}
          />,
        ),
      );
  });

  router.post("/sessions", async (req, res) => {
    const repoId = formField(req.body, "repoId");
    const title = formField(req.body, "title");
    const taskPrompt = formField(req.body, "taskPrompt");
    const runnerValue = formField(req.body, "runner");
    const runner: RunnerName = runnerValue === "echo" ? "echo" : "codex";
    if (!repoId || !title || !taskPrompt) {
      const [repos, sessions] = await Promise.all([
        store.listRepos(),
        store.listSessions(),
      ]);
      const initialPreview = repoId
        ? await store.composeSystemPrompt(
            repoId,
            formField(req.body, "systemPromptExtra"),
          )
        : "";
      res
        .status(400)
        .type("html")
        .send(
          renderPage(
            <NewSessionPage
              repos={repos}
              sessions={sessions}
              initialPreview={initialPreview}
              error="Repository, title, and task are required."
            />,
          ),
        );
      return;
    }
    const session = await store.createSession({
      repoId,
      parentId: formField(req.body, "parentId") || undefined,
      title,
      taskPrompt,
      runner,
      systemPromptExtra: formField(req.body, "systemPromptExtra"),
      createPr:
        formField(req.body, "createPr") === "yes" ||
        formField(req.body, "autoMerge") === "yes",
      autoMerge: formField(req.body, "autoMerge") === "yes",
    });
    res.redirect(303, `/sessions/${session.id}`);
  });

  router.get("/sessions/:id", async (req, res) => {
    const session = await store.getSession(req.params.id);
    if (!session) {
      res
        .status(404)
        .type("html")
        .send(renderPage(<NotFoundPage message="That session does not exist." />));
      return;
    }
    const [repo, sessions, turns] = await Promise.all([
      store.getRepo(session.repoId),
      store.listSessions(),
      store.listTurns(session.id),
    ]);
    const transcript: TurnTranscript[] = await Promise.all(
      turns.map(async (turn) => ({
        turn,
        events: await store.listRunEvents(turn.id),
      })),
    );
    const breadcrumb = buildBreadcrumb(session, sessions);
    const tree = sessions.filter(({ rootId }) => rootId === session.rootId);
    res
      .type("html")
      .send(
        renderPage(
          <SessionDetailPage
            session={session}
            repo={repo}
            breadcrumb={breadcrumb}
            tree={tree}
            transcript={transcript}
          />,
        ),
      );
  });

  router.post("/sessions/:id/feedback", async (req, res) => {
    const feedback = formField(req.body, "feedback");
    if (feedback) await store.addFeedback(req.params.id, feedback);
    res.redirect(303, `/sessions/${req.params.id}`);
  });

  router.post("/sessions/:id/cancel", async (req, res) => {
    await store.cancelSession(req.params.id);
    res.redirect(303, `/sessions/${req.params.id}`);
  });

  router.post("/sessions/:id/archive", async (req, res) => {
    await store.archiveSession(req.params.id);
    res.redirect(303, `/sessions/${req.params.id}`);
  });

  return router;
}

function buildBreadcrumb(session: Session, sessions: Session[]): Session[] {
  const result: Session[] = [session];
  let current = session;
  while (current.parentId) {
    const parent = sessions.find(({ id }) => id === current.parentId);
    if (!parent || result.some(({ id }) => id === parent.id)) break;
    result.unshift(parent);
    current = parent;
  }
  return result;
}
