import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import test from "node:test";
import { ChatGptAuth, type ChatGptStatus } from "./auth";

function jwt(claims: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode(claims)}.signature`;
}

const idToken = jwt({
  email: "me@example.com",
  "https://api.openai.com/auth": {
    chatgpt_account_id: "account-1",
    chatgpt_plan_type: "pro",
  },
});

function memorySettings() {
  const values = new Map<string, string>();
  return {
    values,
    getSetting: async (key: string) => values.get(key),
    setSetting: async (key: string, value: string) => {
      values.set(key, value);
    },
    deleteSetting: async (key: string) => {
      values.delete(key);
    },
  };
}

async function waitFor(
  auth: ChatGptAuth,
  state: ChatGptStatus["state"],
): Promise<ChatGptStatus> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const status = await auth.status();
    if (status.state === state) return status;
    await sleep(5);
  }
  assert.fail(`ChatGPT sign-in never reached ${state}`);
}

void test("signs in with a device code and stores the tokens", async () => {
  const settings = memorySettings();
  const requests: Array<{ url: string; body: string }> = [];
  let polls = 0;
  const auth = new ChatGptAuth({
    settings,
    issuer: "https://auth.test",
    fetch: async (input, init) => {
      const url = input as string;
      requests.push({ url, body: init?.body as string });
      if (url.endsWith("/deviceauth/usercode")) {
        return Response.json({
          device_auth_id: "device-1",
          user_code: "ABCD-EFGH",
          interval: "0",
        });
      }
      if (url.endsWith("/deviceauth/token")) {
        polls += 1;
        if (polls === 1) return new Response("", { status: 403 });
        return Response.json({
          authorization_code: "code-1",
          code_challenge: "challenge",
          code_verifier: "verifier",
        });
      }
      return Response.json({
        id_token: idToken,
        access_token: jwt({ exp: 4_000_000_000 }),
        refresh_token: "refresh-1",
      });
    },
  });

  assert.deepEqual(await auth.status(), { state: "signed_out" });
  await auth.startLogin();
  const pending = await auth.status();
  assert.ok(pending.state === "pending");
  assert.equal(pending.verificationUrl, "https://auth.test/codex/device");
  assert.equal(pending.userCode, "ABCD-EFGH");

  assert.deepEqual(await waitFor(auth, "signed_in"), {
    state: "signed_in",
    email: "me@example.com",
    plan: "pro",
  });
  assert.equal(polls, 2);
  const exchange = requests.at(-1);
  assert.equal(exchange?.url, "https://auth.test/oauth/token");
  assert.deepEqual(Object.fromEntries(new URLSearchParams(exchange.body)), {
    grant_type: "authorization_code",
    client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
    code: "code-1",
    redirect_uri: "https://auth.test/deviceauth/callback",
    code_verifier: "verifier",
  });
  assert.deepEqual(await auth.credentials(new AbortController().signal), {
    accessToken: jwt({ exp: 4_000_000_000 }),
    accountId: "account-1",
  });

  await auth.signOut();
  assert.deepEqual(await auth.status(), { state: "signed_out" });
  await assert.rejects(auth.credentials(new AbortController().signal), {
    message: "Sign in to ChatGPT under Settings to use this model",
  });
});

void test("reports a device code sign-in the backend refuses", async () => {
  const auth = new ChatGptAuth({
    settings: memorySettings(),
    fetch: async (input) =>
      (input as string).endsWith("/usercode")
        ? Response.json({
            device_auth_id: "device-1",
            user_code: "ABCD-EFGH",
            interval: "0",
          })
        : new Response("", { status: 500 }),
  });

  await auth.startLogin();

  assert.deepEqual(await waitFor(auth, "signed_out"), {
    state: "signed_out",
    error: "ChatGPT sign-in failed (500)",
  });
});

void test("refreshes an expiring access token once", async () => {
  const settings = memorySettings();
  const expiring = jwt({ exp: Math.floor(Date.now() / 1000) + 60 });
  const fresh = jwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
  settings.values.set(
    "chatgpt_tokens",
    JSON.stringify({
      idToken,
      accessToken: expiring,
      refreshToken: "refresh-1",
    }),
  );
  const refreshes: unknown[] = [];
  const auth = new ChatGptAuth({
    settings,
    fetch: async (input, init) => {
      assert.equal(input, "https://auth.openai.com/oauth/token");
      refreshes.push(JSON.parse(init?.body as string));
      return Response.json({
        access_token: fresh,
        refresh_token: "refresh-2",
      });
    },
  });

  const signal = new AbortController().signal;
  const [first, second] = await Promise.all([
    auth.credentials(signal),
    auth.credentials(signal),
  ]);

  assert.deepEqual(first, { accessToken: fresh, accountId: "account-1" });
  assert.deepEqual(second, first);
  assert.deepEqual(refreshes, [
    {
      client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
      grant_type: "refresh_token",
      refresh_token: "refresh-1",
    },
  ]);
  assert.deepEqual(JSON.parse(settings.values.get("chatgpt_tokens") ?? ""), {
    idToken,
    accessToken: fresh,
    refreshToken: "refresh-2",
  });
});
