import { Router } from "express";
import { HomePage } from "../../views/pages/home";
import { renderPage } from "../../views/render";

export const pagesRouter = Router();

pagesRouter.get("/", (_req, res) => {
  res.type("html").send(renderPage(<HomePage />));
});
