import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import { createAuth, localPath } from "./auth";

void test("requires sign in only for routes after requireSignIn", async (t) => {
  const { router, requireSignIn } = createAuth({
    clientId: "client-id",
    clientSecret: "client-secret",
    secret: "test-secret",
    allowedUsers: ["octocat"],
  });
  const app = express();
  app.use(router);
  app.get("/", (_req, res) => {
    res.send("public");
  });
  app.use(requireSignIn);
  app.all("/{*path}", (_req, res) => {
    res.send("private");
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;
  const url = (path: string) => `http://127.0.0.1:${port.toString()}${path}`;

  assert.equal(await (await fetch(url("/"))).text(), "public");

  const redirect = await fetch(url("/trajectories?repo=x"), {
    redirect: "manual",
  });
  assert.equal(redirect.status, 302);
  assert.equal(
    redirect.headers.get("location"),
    "/auth/signin?callbackUrl=%2Ftrajectories%3Frepo%3Dx",
  );

  const post = await fetch(url("/trajectories"), { method: "POST" });
  assert.equal(post.status, 401);

  const signIn = await fetch(url("/auth/signin"), { redirect: "manual" });
  assert.equal(signIn.status, 302);
  const location = new URL(signIn.headers.get("location") ?? "");
  assert.equal(location.origin, "https://github.com");
  assert.ok(location.searchParams.get("state"));

  const forged = await fetch(url("/auth/github/callback?code=x&state=y"));
  assert.equal(forged.status, 403);
});

void test("only returns to paths on this site after sign in", () => {
  assert.equal(localPath("/trajectories?repo=x"), "/trajectories?repo=x");
  assert.equal(localPath("https://example.com"), "/");
  assert.equal(localPath("//example.com"), "/");
  assert.equal(localPath("/\\example.com"), "/");
});
