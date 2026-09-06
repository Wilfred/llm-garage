import { config } from "../config";
import { createAppDataSource } from "../db/data-source";
import { DatabaseDataStore } from "../store/db";
import { OpenRouterWorker } from "../worker/openrouter";
import { WebTools } from "../worker/web-tools";
import { DockerSandbox } from "../sandbox/docker";
import Docker from "dockerode";
import { createApp } from "./app";
import type { Express } from "express";
import type { Server } from "node:http";

const dataSource = createAppDataSource(config.DATA_DIR);

async function main(): Promise<void> {
  await dataSource.initialize();
  const store = new DatabaseDataStore(dataSource, {
    worker: new OpenRouterWorker({
      apiKey: config.OPENROUTER_API_KEY,
      webTools: new WebTools({ braveApiKey: config.BRAVE_SEARCH_API_KEY }),
    }),
    sandbox: new DockerSandbox({
      docker: new Docker({ socketPath: config.DOCKER_SOCKET }),
      image: config.WORKER_IMAGE,
    }),
  });
  await store.initialize();
  const app = createApp(dataSource, store);

  let server: Server;
  try {
    server = await listen(app, config.PORT, config.HOST);
  } catch (error) {
    await dataSource.destroy();
    throw error;
  }

  console.log(
    `llm-garage listening on http://${config.HOST}:${config.PORT.toString()}`,
  );
  installShutdownHandlers(server);
}

function listen(app: Express, port: number, host: string): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, (error?: Error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(server);
    });
  });
}

function installShutdownHandlers(server: Server): void {
  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    console.log(`Received ${signal}; shutting down llm-garage`);

    try {
      await close(server);
      if (dataSource.isInitialized) {
        await dataSource.destroy();
      }
    } catch (error) {
      console.error("Failed to shut down llm-garage cleanly", error);
      process.exitCode = 1;
    }
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

void main().catch((error: unknown) => {
  console.error("Failed to start llm-garage", error);
  process.exitCode = 1;
});
