import assert from "node:assert/strict";
import test from "node:test";
import { formatUsage, formatUsd, sumUsage } from "./usage";

void test("adds reported costs and leaves unreported ones unknown", () => {
  assert.deepEqual(
    sumUsage([
      { inputTokens: 100, outputTokens: 10, costUsd: 0.002 },
      { inputTokens: 200, outputTokens: 20, costUsd: 0.003 },
    ]),
    { inputTokens: 300, outputTokens: 30, costUsd: 0.005 },
  );
  assert.deepEqual(
    sumUsage([
      { inputTokens: 100, outputTokens: 10 },
      { inputTokens: 200, outputTokens: 20 },
    ]),
    { inputTokens: 300, outputTokens: 30 },
  );
  assert.equal(sumUsage([undefined]), undefined);
});

void test("formats costs down to a hundredth of a cent", () => {
  assert.equal(formatUsd(0), "$0.00");
  assert.equal(formatUsd(0.0042), "$0.0042");
  assert.equal(formatUsd(0.00001), "<$0.0001");
  assert.equal(formatUsd(12.3456), "$12.35");
});

void test("omits the cost from a usage summary when it is unknown", () => {
  assert.equal(
    formatUsage({ inputTokens: 1250, outputTokens: 42, costUsd: 0.5 }),
    "1,250 input tokens · 42 output tokens · $0.50",
  );
  assert.equal(
    formatUsage({ inputTokens: 1250, outputTokens: 42 }),
    "1,250 input tokens · 42 output tokens",
  );
});
