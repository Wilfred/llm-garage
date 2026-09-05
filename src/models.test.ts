import assert from "node:assert/strict";
import test from "node:test";
import { getModel, isModelId, modelCatalog } from "./models";

test("accepts only models exposed by the OpenRouter catalogue", () => {
  assert.ok(modelCatalog.length >= 2);
  for (const model of modelCatalog) {
    assert.equal(isModelId(model.id), true);
    assert.equal(getModel(model.id), model);
  }
  assert.equal(isModelId("codex"), false);
  assert.equal(isModelId("openrouter/auto"), false);
});
