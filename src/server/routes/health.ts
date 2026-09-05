import { Router } from "express";
import type { DataSource } from "typeorm";

export function createHealthRouter(dataSource: DataSource): Router {
  const router = Router();

  router.get("/healthz", async (_req, res) => {
    try {
      await dataSource.query("SELECT 1");
      res.json({ ok: true, db: true });
    } catch {
      res.status(503).json({ ok: false, db: false });
    }
  });

  return router;
}
