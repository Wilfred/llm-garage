import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

void test("refreshes evolving page content and preserves expanded turns", async () => {
  const expanded = details("turn-one:0", true);
  const current = page("1", [expanded]);
  const refreshedExpanded = details("turn-one:0", false);
  const refreshedNew = details("turn-one:1", false);
  const refreshed = page("1", [refreshedExpanded, refreshedNew]);
  const finished = page(undefined, []);
  const parsedPages = [refreshed, finished];
  const scheduled: Array<() => Promise<void>> = [];
  const fetchOptions: unknown[] = [];

  vm.runInNewContext(readFileSync(path.resolve("public/refresh.js"), "utf8"), {
    document: { querySelector: () => current },
    DOMParser: class {
      parseFromString() {
        const next = parsedPages.shift();
        return { querySelector: () => next };
      }
    },
    window: {
      location: { href: "http://example.test/trajectories/example" },
      fetch: async (_url: string, options: unknown) => {
        fetchOptions.push(options);
        return { ok: true, text: async () => "<html></html>" };
      },
      setTimeout: (callback: () => Promise<void>, milliseconds: number) => {
        assert.equal(milliseconds, 1000);
        scheduled.push(callback);
      },
    },
  });

  assert.equal(scheduled.length, 1);
  await scheduled.shift()?.();
  assert.equal(current.replacement, refreshed);
  assert.equal(refreshedExpanded.open, true);
  assert.equal(refreshedNew.open, false);
  assert.equal(scheduled.length, 1);

  await scheduled.shift()?.();
  assert.equal(refreshed.replacement, finished);
  assert.equal(scheduled.length, 0);
  assert.equal(fetchOptions.length, 2);
  for (const options of fetchOptions) {
    assert.equal((options as { cache?: string }).cache, "no-store");
  }
});

function details(refreshKey: string, open: boolean) {
  return { dataset: { refreshKey }, open };
}

function page(
  refreshSeconds: string | undefined,
  turnDetails: Array<ReturnType<typeof details>>,
) {
  return {
    dataset: { refreshSeconds },
    replacement: undefined as unknown,
    querySelectorAll: (selector: string) =>
      selector.endsWith("[open]")
        ? turnDetails.filter(({ open }) => open)
        : turnDetails,
    replaceWith(replacement: unknown) {
      this.replacement = replacement;
    },
  };
}
