import express from "express";
import { config } from "../config";
import { healthRouter } from "./routes/health";
import { pagesRouter } from "./routes/pages";

const app = express();

app.use(pagesRouter);
app.use(healthRouter);

app.listen(config.PORT, config.HOST, () => {
  console.log(`llm-garage listening on http://${config.HOST}:${config.PORT}`);
});
