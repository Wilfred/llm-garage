import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PassThrough } from "node:stream";
import test from "node:test";
import Docker from "dockerode";
import { containerName, DockerSandbox } from "./docker";

const dockerIntegration = process.env["DOCKER_INTEGRATION_TEST"] === "1";

void test("configures, executes in, and archives one isolated container", async () => {
  const trajectoryId = "trajectory-contract-test";
  let createOptions: Docker.ContainerCreateOptions | undefined;
  let created = false;
  let removed = false;
  const execution = {
    start: async () => {
      const stream = new PassThrough();
      setImmediate(() => stream.end("bin\nworkspace\n"));
      return stream;
    },
    inspect: async () => ({ ExitCode: 0 }),
  };
  const container = {
    inspect: async () => {
      if (!created)
        throw Object.assign(new Error("missing"), { statusCode: 404 });
      return { State: { Running: true } };
    },
    start: async () => {
      created = true;
    },
    exec: async () => execution,
    kill: async () => undefined,
    remove: async () => {
      removed = true;
      created = false;
    },
  };
  const docker = {
    getContainer: () => container,
    getImage: () => ({ inspect: async () => ({}) }),
    createContainer: async (options: Docker.ContainerCreateOptions) => {
      createOptions = options;
      return container;
    },
    pull: async () => new PassThrough(),
    modem: {
      demuxStream: (
        source: PassThrough,
        stdout: PassThrough,
        stderr: PassThrough,
      ) => {
        source.pipe(stdout);
        source.once("end", () => stderr.end());
      },
      followProgress: () => undefined,
    },
  } as unknown as Docker;
  const sandbox = new DockerSandbox({ docker, image: "worker:test" });

  await sandbox.create(trajectoryId);
  assert.ok(createOptions);
  assert.equal(createOptions.name, containerName(trajectoryId));
  assert.equal(createOptions.Image, "worker:test");
  assert.equal(createOptions.User, "65534:65534");
  assert.equal(
    createOptions.Labels?.["com.llm-garage.trajectory-id"],
    trajectoryId,
  );
  const hostConfig = createOptions.HostConfig;
  assert.ok(hostConfig);
  assert.equal(hostConfig.NetworkMode, "none");
  assert.equal(hostConfig.ReadonlyRootfs, true);
  assert.deepEqual(hostConfig.CapDrop, ["ALL"]);

  const result = await sandbox.runCommand(
    trajectoryId,
    "ls /",
    new AbortController().signal,
  );
  assert.deepEqual(result, {
    exitCode: 0,
    stdout: "bin\nworkspace\n",
    stderr: "",
    truncated: false,
  });

  await sandbox.archive(trajectoryId);
  assert.equal(removed, true);
});

void test("lists and removes only managed containers that are not kept", async () => {
  const removed: string[] = [];
  let listOptions: Docker.ContainerListOptions | undefined;
  const managedContainers = [
    {
      Id: "active-container-id",
      Names: ["/llm-garage-trajectory-active"],
      Image: "worker:test",
      ImageID: "image-id",
      Command: "/bin/sh",
      Created: 1_788_777_600,
      Ports: [],
      Labels: {
        "com.llm-garage.managed": "true",
        "com.llm-garage.trajectory-id": "active",
      },
      State: "running",
      Status: "Up 2 minutes",
      HostConfig: { NetworkMode: "none" },
      NetworkSettings: { Networks: {} },
      Mounts: [],
    },
    {
      Id: "idle-container-id",
      Names: ["/llm-garage-trajectory-idle"],
      Image: "worker:test",
      ImageID: "image-id",
      Command: "/bin/sh",
      Created: 1_788_777_000,
      Ports: [],
      Labels: {
        "com.llm-garage.managed": "true",
        "com.llm-garage.trajectory-id": "idle",
      },
      State: "exited",
      Status: "Exited (0) 10 minutes ago",
      HostConfig: { NetworkMode: "none" },
      NetworkSettings: { Networks: {} },
      Mounts: [],
    },
  ] satisfies Docker.ContainerInfo[];
  const docker = {
    listContainers: async (options: Docker.ContainerListOptions) => {
      listOptions = options;
      return managedContainers;
    },
    getContainer: (id: string) => ({
      remove: async () => {
        removed.push(id);
      },
    }),
  } as unknown as Docker;
  const sandbox = new DockerSandbox({ docker });

  const listed = await sandbox.listContainers();

  assert.deepEqual(listOptions, {
    all: true,
    filters: { label: ["com.llm-garage.managed=true"] },
  });
  assert.deepEqual(listed, [
    {
      id: "active-container-id",
      name: "llm-garage-trajectory-active",
      trajectoryId: "active",
      image: "worker:test",
      state: "running",
      status: "Up 2 minutes",
      createdAt: new Date("2026-09-07T10:40:00.000Z"),
    },
    {
      id: "idle-container-id",
      name: "llm-garage-trajectory-idle",
      trajectoryId: "idle",
      image: "worker:test",
      state: "exited",
      status: "Exited (0) 10 minutes ago",
      createdAt: new Date("2026-09-07T10:30:00.000Z"),
    },
  ]);

  const count = await sandbox.removeContainers({
    keepTrajectoryIds: new Set(["active"]),
  });

  assert.equal(count, 1);
  assert.deepEqual(removed, ["idle-container-id"]);
});

void test(
  "creates an isolated container, runs a command, and removes it",
  { skip: !dockerIntegration },
  async (t) => {
    const docker = new Docker();
    const trajectoryId = randomUUID();
    const sandbox = new DockerSandbox({ docker });
    t.after(() => sandbox.archive(trajectoryId));

    await sandbox.create(trajectoryId);
    const details = await docker
      .getContainer(containerName(trajectoryId))
      .inspect();
    assert.equal(
      details.Config.Labels["com.llm-garage.trajectory-id"],
      trajectoryId,
    );
    assert.equal(details.HostConfig.NetworkMode, "none");
    assert.equal(details.HostConfig.Privileged, false);

    const result = await sandbox.runCommand(
      trajectoryId,
      "ls /",
      new AbortController().signal,
    );
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /(?:^|\n)bin(?:\n|$)/);
    assert.equal(result.stderr, "");

    await sandbox.archive(trajectoryId);
    await assert.rejects(
      docker.getContainer(containerName(trajectoryId)).inspect(),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "statusCode" in error &&
        error.statusCode === 404,
    );
  },
);
