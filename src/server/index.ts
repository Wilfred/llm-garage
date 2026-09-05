import { config } from "../config";
import { createAppDataSource } from "../db/data-source";
import { MemoryDataStore } from "../store/memory";
import { createApp } from "./app";

const dataSource = createAppDataSource(config.DATA_DIR);

async function main(): Promise<void> {
  await dataSource.initialize();
  const app = createApp(dataSource, new MemoryDataStore());

  app.listen(config.PORT, config.HOST, () => {
    console.log(`llm-garage listening on http://${config.HOST}:${config.PORT}`);
  });
}

void main().catch((error: unknown) => {
  console.error("Failed to start llm-garage", error);
  process.exitCode = 1;
});
