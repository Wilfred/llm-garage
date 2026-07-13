// M0: utterly trivial website. Replaced by the TypeScript app in M1 (see PLAN.md).
import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"ok":true}');
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end("<!doctype html><title>llm-garage</title><h1>llm-garage</h1><p>It works.</p>");
}).listen(port, host, () => {
  console.log(`llm-garage listening on http://${host}:${port}`);
});
