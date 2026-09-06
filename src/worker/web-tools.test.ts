import assert from "node:assert/strict";
import test from "node:test";
import { Agent, Headers, Response } from "undici";
import { isPublicAddress, WebTools } from "./web-tools";

void test("searches Brave with the configured credential and bounded count", async () => {
  let request:
    | {
        input: Parameters<typeof import("undici").fetch>[0];
        init?: Parameters<typeof import("undici").fetch>[1];
      }
    | undefined;
  const fetch: typeof import("undici").fetch = async (input, init) => {
    request = { input, ...(init ? { init } : {}) };
    return Response.json({
      type: "search",
      web: {
        results: [
          {
            title: "First result",
            url: "https://example.com/one",
            description: "First description",
          },
          {
            title: "Second result",
            url: "https://example.com/two",
            description: "Second description",
          },
        ],
      },
    });
  };
  const webTools = new WebTools({
    braveApiKey: "brave-test-key",
    fetch,
    dispatcher: new Agent(),
  });

  const result = await webTools.searchWeb(
    "typescript agents",
    1,
    new AbortController().signal,
  );

  assert.ok(request);
  const url = new URL(requestUrl(request.input));
  assert.equal(
    url.origin + url.pathname,
    "https://api.search.brave.com/res/v1/web/search",
  );
  assert.equal(url.searchParams.get("q"), "typescript agents");
  assert.equal(url.searchParams.get("count"), "1");
  assert.equal(
    new Headers(request.init?.headers).get("X-Subscription-Token"),
    "brave-test-key",
  );
  assert.deepEqual(result, {
    query: "typescript agents",
    results: [
      {
        title: "First result",
        url: "https://example.com/one",
        description: "First description",
      },
    ],
  });
});

void test("requires a Brave credential before searching", async () => {
  let requested = false;
  const webTools = new WebTools({
    braveApiKey: undefined,
    fetch: async () => {
      requested = true;
      return new Response();
    },
  });

  await assert.rejects(
    webTools.searchWeb("query", 5, new AbortController().signal),
    /BRAVE_SEARCH_API_KEY is not configured/,
  );
  assert.equal(requested, false);
});

void test("fetches text through redirects and truncates oversized bodies", async () => {
  const requested: string[] = [];
  const fetch: typeof import("undici").fetch = async (input) => {
    requested.push(requestUrl(input));
    if (requested.length === 1) {
      return new Response(null, {
        status: 302,
        headers: { Location: "/article" },
      });
    }
    return new Response("A useful article", {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  };
  const webTools = new WebTools({
    braveApiKey: undefined,
    bodyLimitBytes: 8,
    fetch,
    dispatcher: new Agent(),
  });

  const result = await webTools.fetchUrl(
    "https://example.com/start",
    new AbortController().signal,
  );

  assert.deepEqual(requested, [
    "https://example.com/start",
    "https://example.com/article",
  ]);
  assert.deepEqual(result, {
    url: "https://example.com/article",
    status: 200,
    contentType: "text/plain; charset=utf-8",
    content: "A useful",
    truncated: true,
  });
});

void test("rejects non-public URL targets", async () => {
  let requested = false;
  const webTools = new WebTools({
    braveApiKey: undefined,
    fetch: async () => {
      requested = true;
      return new Response("private");
    },
  });

  for (const url of [
    "file:///etc/passwd",
    "http://localhost/admin",
    "http://127.0.0.1/admin",
    "http://[::1]/admin",
    "http://169.254.169.254/latest/meta-data",
  ]) {
    await assert.rejects(webTools.fetchUrl(url, new AbortController().signal));
  }
  assert.equal(requested, false);
});

void test("classifies public and reserved addresses", () => {
  assert.equal(isPublicAddress("8.8.8.8"), true);
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
  assert.equal(isPublicAddress("10.0.0.1"), false);
  assert.equal(isPublicAddress("127.0.0.1"), false);
  assert.equal(isPublicAddress("::1"), false);
  assert.equal(isPublicAddress("fc00::1"), false);
  assert.equal(isPublicAddress("::ffff:127.0.0.1"), false);
});

function requestUrl(
  input: Parameters<typeof import("undici").fetch>[0],
): string {
  if (typeof input === "string") return input;
  if ("url" in input) return input.url;
  return input.href;
}
