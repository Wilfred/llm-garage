import { Router } from "express";
import type { ChatGptAuth } from "../../chatgpt/auth";
import { ChatGptPage } from "../../views/pages/chatgpt";
import { renderPage } from "../../views/render";
import { noticeUrl, queryString } from "./forms";

export function createChatGptRouter(auth: ChatGptAuth): Router {
  const router = Router();

  router.get("/chatgpt", async (req, res) => {
    const notice = queryString(req.query["notice"]);
    res
      .type("html")
      .send(
        renderPage(
          <ChatGptPage
            status={await auth.status()}
            {...(notice === undefined ? {} : { notice })}
          />,
        ),
      );
  });

  router.post("/chatgpt/sign-in", async (_req, res) => {
    try {
      await auth.startLogin();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.redirect(303, noticeUrl("/chatgpt", message));
      return;
    }
    res.redirect(303, "/chatgpt");
  });

  router.post("/chatgpt/cancel", (_req, res) => {
    auth.cancelLogin();
    res.redirect(303, "/chatgpt");
  });

  router.post("/chatgpt/sign-out", async (_req, res) => {
    await auth.signOut();
    res.redirect(303, noticeUrl("/chatgpt", "Signed out."));
  });

  return router;
}
