import { Router } from "express";
import { HomePage } from "../../views/pages/home";

export const pagesRouter = Router();

pagesRouter.get("/", (_req, res) => {
  res.type("html").send(<HomePage />);
});
