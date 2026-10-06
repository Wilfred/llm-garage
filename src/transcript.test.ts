import assert from "node:assert/strict";
import test from "node:test";
import { formatTrajectoryTranscript } from "./transcript";

void test("formats every prompt and event of a trajectory", () => {
  const ts = new Date("2026-09-06T10:00:00Z");
  const transcript = formatTrajectoryTranscript({
    trajectory: {
      id: "trajectory-1",
      rootId: "trajectory-1",
      repoId: "repo-1",
      title: "Fix the parser",
      status: "succeeded",
      modelId: "openai/gpt-5.6-sol",
      taskPrompt: "Fix the parser",
      prUrl: "https://github.com/example/parser/pull/1",
      createdAt: ts,
      updatedAt: ts,
    },
    repo: {
      id: "repo-1",
      owner: "example",
      name: "parser",
      defaultBranch: "main",
      createdAt: ts,
    },
    turns: [
      {
        turn: {
          id: "turn-1",
          trajectoryId: "trajectory-1",
          kind: "initial",
          prompt: "Fix the parser",
          status: "succeeded",
          usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.01 },
          createdAt: ts,
        },
        events: [
          event(1, "tool", 'run_command {"command":"ls"}'),
          event(2, "tool", 'run_command result {"stdout":"src"}'),
          event(3, "model_output", "Fixed it."),
        ],
      },
    ],
  });

  assert.equal(
    transcript,
    `# Fix the parser

Trajectory: trajectory-1
Repository: example/parser
Model: openai/gpt-5.6-sol
Status: succeeded
Pull request: https://github.com/example/parser/pull/1
Usage: 10 input tokens · 5 output tokens · $0.01

## Turn 1 (initial, succeeded)

### Prompt

Fix the parser

### 2026-09-06T10:00:00.000Z tool

run_command {"command":"ls"}

### 2026-09-06T10:00:00.000Z tool

run_command result {"stdout":"src"}

### 2026-09-06T10:00:00.000Z model_output

Fixed it.
`,
  );

  function event(
    sequence: number,
    kind: "tool" | "model_output",
    data: string,
  ) {
    return {
      id: `event-${sequence.toString()}`,
      trajectoryId: "trajectory-1",
      turnId: "turn-1",
      sequence,
      kind,
      data,
      ts,
    };
  }
});
