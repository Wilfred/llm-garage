import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import type {
  ContainerManager,
  RemoveContainersOptions,
} from "../../sandbox/types";
import type { DataStore, Trajectory } from "../../store/types";
import { activeTrajectoryIds, createContainersRouter } from "./containers";

void test("keeps running and queued trajectories when removing idle containers", () => {
  const activeIds = activeTrajectoryIds([
    trajectory("running", "running"),
    trajectory("queued", "queued"),
    trajectory("finished", "succeeded"),
    trajectory("awaiting", "awaiting_feedback"),
  ]);

  assert.deepEqual([...activeIds], ["running", "queued"]);
});

void test("bulk container routes preserve active trajectories only when requested", async (t) => {
  const removalOptions: Array<RemoveContainersOptions | undefined> = [];
  const manager: ContainerManager = {
    async listContainers() {
      return [];
    },
    async removeContainers(options) {
      removalOptions.push(options);
      return 2;
    },
  };
  const trajectories = [
    trajectory("active", "running"),
    trajectory("finished", "succeeded"),
  ];
  const store = {
    async listTrajectories() {
      return trajectories;
    },
  } as unknown as DataStore;
  const app = express();
  app.use(createContainersRouter(store, manager));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  );
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port.toString()}`;

  const idleResponse = await fetch(`${baseUrl}/containers/remove-idle`, {
    method: "POST",
    redirect: "manual",
  });

  assert.equal(idleResponse.status, 303);
  assert.equal(
    idleResponse.headers.get("location"),
    "/containers?notice=Removed+2+idle+containers.",
  );
  const idleOptions = removalOptions[0];
  assert.ok(idleOptions);
  const keepTrajectoryIds = idleOptions.keepTrajectoryIds;
  assert.ok(keepTrajectoryIds);
  assert.deepEqual([...keepTrajectoryIds], ["active"]);

  const allResponse = await fetch(`${baseUrl}/containers/remove-all`, {
    method: "POST",
    redirect: "manual",
  });

  assert.equal(allResponse.status, 303);
  assert.equal(
    allResponse.headers.get("location"),
    "/containers?notice=Removed+2+containers.",
  );
  assert.equal(removalOptions[1], undefined);
});

function trajectory(id: string, status: Trajectory["status"]): Trajectory {
  const timestamp = new Date("2026-09-06T12:00:00Z");
  return {
    id,
    rootId: id,
    repoId: "repo-garage",
    title: id,
    status,
    modelId: "openai/gpt-5.6-sol",
    taskPrompt: id,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
