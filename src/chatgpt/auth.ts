import { setTimeout as sleep } from "node:timers/promises";
import { Mutex } from "async-mutex";
import { decodeJwt } from "jose";
import { z } from "zod";
import type { DataStore } from "../store/types";

// ChatGPT sign-in uses the same OAuth client and device code flow as the
// Codex CLI, since that is what the Codex backend accepts tokens from.
const defaultIssuer = "https://auth.openai.com";
const clientId = "app_EMoamEEZ73f0CkXaXp7hrann";
const tokensSettingKey = "chatgpt_tokens";
const loginTimeoutMs = 15 * 60_000;
const refreshMarginMs = 5 * 60_000;

const tokensSchema = z.object({
  idToken: z.string(),
  accessToken: z.string(),
  refreshToken: z.string(),
});
type Tokens = z.infer<typeof tokensSchema>;

const userCodeSchema = z.object({
  device_auth_id: z.string(),
  user_code: z.string(),
  interval: z.coerce.number().int().nonnegative().catch(5),
});

const authorizationSchema = z.object({
  authorization_code: z.string(),
  code_verifier: z.string(),
});

const tokenResponseSchema = z.object({
  id_token: z.string(),
  access_token: z.string(),
  refresh_token: z.string(),
});

const refreshResponseSchema = tokenResponseSchema.partial();

const idTokenClaimsSchema = z.object({
  email: z.string().optional(),
  "https://api.openai.com/auth": z
    .object({
      chatgpt_account_id: z.string().optional(),
      chatgpt_plan_type: z.string().optional(),
    })
    .optional(),
});

export type ChatGptStatus =
  | { state: "signed_out"; error?: string }
  | {
      state: "pending";
      userCode: string;
      verificationUrl: string;
      expiresAt: Date;
    }
  | { state: "signed_in"; email?: string; plan?: string };

export type ChatGptCredentials = { accessToken: string; accountId?: string };

export interface ChatGptCredentialSource {
  credentials(
    signal: AbortSignal,
    options?: { forceRefresh?: boolean },
  ): Promise<ChatGptCredentials>;
}

export type ChatGptAuthOptions = {
  settings: Pick<DataStore, "getSetting" | "setSetting" | "deleteSetting">;
  issuer?: string;
  fetch?: typeof fetch;
};

export class ChatGptAuth implements ChatGptCredentialSource {
  private readonly settings: ChatGptAuthOptions["settings"];
  private readonly issuer: string;
  private readonly fetch: typeof fetch;
  private readonly refreshLock = new Mutex();
  private login:
    | { controller: AbortController; userCode: string; expiresAt: Date }
    | undefined;
  private loginError: string | undefined;

  constructor({
    settings,
    issuer = defaultIssuer,
    fetch: fetchImplementation = fetch,
  }: ChatGptAuthOptions) {
    this.settings = settings;
    this.issuer = issuer;
    this.fetch = fetchImplementation;
  }

  async status(): Promise<ChatGptStatus> {
    if (this.login) {
      return {
        state: "pending",
        userCode: this.login.userCode,
        verificationUrl: `${this.issuer}/codex/device`,
        expiresAt: this.login.expiresAt,
      };
    }
    const tokens = await this.loadTokens();
    if (!tokens) {
      return {
        state: "signed_out",
        ...(this.loginError === undefined ? {} : { error: this.loginError }),
      };
    }
    const claims = idTokenClaims(tokens.idToken);
    const plan = claims["https://api.openai.com/auth"]?.chatgpt_plan_type;
    return {
      state: "signed_in",
      ...(claims.email === undefined ? {} : { email: claims.email }),
      ...(plan === undefined ? {} : { plan }),
    };
  }

  // Requests a one-time code for the user to enter at the verification URL,
  // then waits in the background for them to approve it.
  async startLogin(): Promise<void> {
    this.cancelLogin();
    this.loginError = undefined;
    const response = await this.fetch(
      `${this.issuer}/api/accounts/deviceauth/usercode`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId }),
      },
    );
    if (!response.ok) {
      throw new Error(
        `ChatGPT sign-in could not start (${response.status.toString()})`,
      );
    }
    const userCode = userCodeSchema.parse(await response.json());
    const controller = new AbortController();
    const login = {
      controller,
      userCode: userCode.user_code,
      expiresAt: new Date(Date.now() + loginTimeoutMs),
    };
    this.login = login;
    void this.completeLogin(
      userCode.device_auth_id,
      userCode.user_code,
      userCode.interval * 1000,
      controller.signal,
    )
      .catch((error: unknown) => {
        if (!controller.signal.aborted) this.loginError = errorMessage(error);
      })
      .finally(() => {
        if (this.login === login) this.login = undefined;
      });
  }

  cancelLogin(): void {
    this.login?.controller.abort();
    this.login = undefined;
  }

  async signOut(): Promise<void> {
    this.cancelLogin();
    this.loginError = undefined;
    await this.settings.deleteSetting(tokensSettingKey);
  }

  async credentials(
    signal: AbortSignal,
    { forceRefresh = false }: { forceRefresh?: boolean } = {},
  ): Promise<ChatGptCredentials> {
    // Refresh tokens are single use, so concurrent trajectories must not
    // refresh at the same time.
    return this.refreshLock.runExclusive(async () => {
      let tokens = await this.loadTokens();
      if (!tokens) {
        throw new Error("Sign in to ChatGPT under Settings to use this model");
      }
      const { exp } = decodeJwt(tokens.accessToken);
      if (
        forceRefresh ||
        exp === undefined ||
        exp * 1000 - Date.now() < refreshMarginMs
      ) {
        tokens = await this.refresh(tokens, signal);
      }
      const accountId = idTokenClaims(tokens.idToken)[
        "https://api.openai.com/auth"
      ]?.chatgpt_account_id;
      return {
        accessToken: tokens.accessToken,
        ...(accountId === undefined ? {} : { accountId }),
      };
    });
  }

  private async completeLogin(
    deviceAuthId: string,
    userCode: string,
    intervalMs: number,
    signal: AbortSignal,
  ): Promise<void> {
    const deadline = Date.now() + loginTimeoutMs;
    for (;;) {
      const response = await this.fetch(
        `${this.issuer}/api/accounts/deviceauth/token`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            device_auth_id: deviceAuthId,
            user_code: userCode,
          }),
          signal,
        },
      );
      if (response.ok) {
        const authorization = authorizationSchema.parse(await response.json());
        await this.saveTokens(await this.exchange(authorization, signal));
        return;
      }
      // The code has not been approved yet.
      if (response.status !== 403 && response.status !== 404) {
        throw new Error(
          `ChatGPT sign-in failed (${response.status.toString()})`,
        );
      }
      if (Date.now() >= deadline) {
        throw new Error("ChatGPT sign-in timed out; try again");
      }
      await sleep(intervalMs, undefined, { signal });
    }
  }

  private async exchange(
    { authorization_code, code_verifier }: z.infer<typeof authorizationSchema>,
    signal: AbortSignal,
  ): Promise<Tokens> {
    const response = await this.fetch(`${this.issuer}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        code: authorization_code,
        redirect_uri: `${this.issuer}/deviceauth/callback`,
        code_verifier,
      }),
      signal,
    });
    if (!response.ok) {
      throw new Error(`ChatGPT sign-in failed (${response.status.toString()})`);
    }
    const tokens = tokenResponseSchema.parse(await response.json());
    return {
      idToken: tokens.id_token,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
    };
  }

  private async refresh(tokens: Tokens, signal: AbortSignal): Promise<Tokens> {
    const response = await this.fetch(`${this.issuer}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        grant_type: "refresh_token",
        refresh_token: tokens.refreshToken,
      }),
      signal,
    });
    if (!response.ok) {
      throw new Error(
        `ChatGPT token refresh failed (${response.status.toString()}); sign in to ChatGPT again under Settings`,
      );
    }
    const refreshed = refreshResponseSchema.parse(await response.json());
    const next: Tokens = {
      idToken: refreshed.id_token ?? tokens.idToken,
      accessToken: refreshed.access_token ?? tokens.accessToken,
      refreshToken: refreshed.refresh_token ?? tokens.refreshToken,
    };
    await this.saveTokens(next);
    return next;
  }

  private async loadTokens(): Promise<Tokens | undefined> {
    const value = await this.settings.getSetting(tokensSettingKey);
    if (value === undefined) return undefined;
    const tokens = tokensSchema.safeParse(JSON.parse(value));
    return tokens.success ? tokens.data : undefined;
  }

  private async saveTokens(tokens: Tokens): Promise<void> {
    await this.settings.setSetting(tokensSettingKey, JSON.stringify(tokens));
  }
}

function idTokenClaims(idToken: string): z.infer<typeof idTokenClaimsSchema> {
  const claims = idTokenClaimsSchema.safeParse(decodeJwt(idToken));
  return claims.success ? claims.data : {};
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
