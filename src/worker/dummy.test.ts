import assert from "node:assert/strict";
import test from "node:test";
import { DummyWorker } from "./dummy";
import type { WorkerEvent } from "./types";

test("emits a short model and tool conversation before completing", async () => {
  const events: WorkerEvent[] = [];
  const worker = new DummyWorker({ stepDelayMs: 1 });

  await worker.run({
    modelName: "Test Model",
    taskPrompt: "Improve the example",
    signal: new AbortController().signal,
    emit: (event) => events.push(event),
  });

  assert.deepEqual(
    events.map(({ kind }) => kind),
    [
      "model_output",
      "tool",
      "model_output",
      "tool",
      "model_output",
      "tool",
      "tool",
      "usage",
      "model_output",
    ],
  );
  assert.match(events[0]!.data, /Improve the example/);
  assert.match(events.at(-1)!.data, /Test Model finished/);
});

test("stops without emitting more events when cancelled", async () => {
  const controller = new AbortController();
  const events: WorkerEvent[] = [];
  const worker = new DummyWorker({ stepDelayMs: 50 });
  const running = worker.run({
    modelName: "Test Model",
    taskPrompt: "Wait",
    signal: controller.signal,
    emit: (event) => events.push(event),
  });

  controller.abort();

  await assert.rejects(running, { name: "AbortError" });
  assert.deepEqual(events, []);
});
