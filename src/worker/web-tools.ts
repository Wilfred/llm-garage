import { lookup as dnsLookup } from "node:dns";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { Agent, fetch as undiciFetch, type Dispatcher } from "undici";
import { z } from "zod";

const defaultBraveEndpoint = "https://api.search.brave.com/res/v1/web/search";
const defaultBodyLimit = 96 * 1024;
const redirectStatuses = new Set([301, 302, 303, 307, 308]);

const braveResponseSchema = z.object({
  web: z
    .object({
      results: z.array(
        z.object({
          title: z.string(),
          url: z.string(),
          description: z.string().optional().default(""),
        }),
      ),
    })
    .nullish(),
});

export type FetchUrlResult = {
  url: string;
  status: number;
  contentType: string;
  content: string;
  truncated: boolean;
};

export type SearchWebResult = {
  query: string;
  results: Array<{ title: string; url: string; description: string }>;
};

export interface WebToolProvider {
  fetchUrl(url: string, signal: AbortSignal): Promise<FetchUrlResult>;
  searchWeb(
    query: string,
    count: number,
    signal: AbortSignal,
  ): Promise<SearchWebResult>;
}

type FetchImplementation = typeof undiciFetch;

export type WebToolsOptions = {
  braveApiKey: string | undefined;
  braveEndpoint?: string;
  fetch?: FetchImplementation;
  dispatcher?: Dispatcher;
  bodyLimitBytes?: number;
  timeoutMs?: number;
};

export class WebTools implements WebToolProvider {
  private readonly braveApiKey: string | undefined;
  private readonly braveEndpoint: string;
  private readonly fetch: FetchImplementation;
  private readonly dispatcher: Dispatcher;
  private readonly bodyLimitBytes: number;
  private readonly timeoutMs: number;

  constructor({
    braveApiKey,
    braveEndpoint = defaultBraveEndpoint,
    fetch = undiciFetch,
    dispatcher = createSafeDispatcher(),
    bodyLimitBytes = defaultBodyLimit,
    timeoutMs = 15_000,
  }: WebToolsOptions) {
    this.braveApiKey = braveApiKey;
    this.braveEndpoint = braveEndpoint;
    this.fetch = fetch;
    this.dispatcher = dispatcher;
    this.bodyLimitBytes = bodyLimitBytes;
    this.timeoutMs = timeoutMs;
  }

  async fetchUrl(url: string, signal: AbortSignal): Promise<FetchUrlResult> {
    let current = parsePublicUrl(url);
    const requestSignal = AbortSignal.any([
      signal,
      AbortSignal.timeout(this.timeoutMs),
    ]);

    for (let redirects = 0; redirects <= 5; redirects += 1) {
      const response = await this.fetch(current, {
        dispatcher: this.dispatcher,
        headers: {
          Accept:
            "text/html, text/plain, application/json, application/xml;q=0.9, */*;q=0.1",
          "User-Agent":
            "LLM-Garage/0.1 (+https://github.com/Wilfred/llm-garage)",
        },
        redirect: "manual",
        signal: requestSignal,
      });

      if (redirectStatuses.has(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location) throw new Error("URL redirect is missing a location");
        if (redirects === 5) throw new Error("URL redirected too many times");
        current = parsePublicUrl(new URL(location, current).toString());
        continue;
      }

      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(
          `URL fetch failed (${response.status.toString()} ${response.statusText})`,
        );
      }
      const contentType = response.headers.get("content-type") ?? "text/plain";
      if (!isTextContentType(contentType)) {
        await response.body?.cancel();
        throw new Error(`URL returned unsupported content type ${contentType}`);
      }
      const body = await readBody(response.body, this.bodyLimitBytes);
      return {
        url: current.toString(),
        status: response.status,
        contentType,
        content: body.text,
        truncated: body.truncated,
      };
    }

    throw new Error("URL redirected too many times");
  }

  async searchWeb(
    query: string,
    count: number,
    signal: AbortSignal,
  ): Promise<SearchWebResult> {
    if (!this.braveApiKey) {
      throw new Error("BRAVE_SEARCH_API_KEY is not configured");
    }
    const endpoint = new URL(this.braveEndpoint);
    endpoint.searchParams.set("q", query);
    endpoint.searchParams.set("count", count.toString());
    const response = await this.fetch(endpoint, {
      dispatcher: this.dispatcher,
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": this.braveApiKey,
      },
      signal: AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]),
    });
    const body = await readBody(response.body, this.bodyLimitBytes);
    if (!response.ok) {
      throw new Error(
        `Brave Search request failed (${response.status.toString()})`,
      );
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(body.text);
    } catch {
      throw new Error("Brave Search returned invalid JSON");
    }
    const parsed = braveResponseSchema.safeParse(decoded);
    if (!parsed.success) {
      throw new Error("Brave Search returned an invalid response");
    }
    return {
      query,
      results: (parsed.data.web?.results ?? []).slice(0, count),
    };
  }
}

export function isPublicAddress(address: string): boolean {
  const normalized = address.replace(/^\[|\]$/g, "");
  const family = isIP(normalized);
  if (family === 4) return !blockedAddresses.check(normalized, "ipv4");
  if (family === 6) return !blockedAddresses.check(normalized, "ipv6");
  return false;
}

function createSafeDispatcher(): Dispatcher {
  const safeLookup: LookupFunction = (hostname, options, callback) => {
    dnsLookup(
      hostname,
      {
        all: true,
        family: options.family,
        hints: options.hints,
        order: "verbatim",
      },
      (error, addresses) => {
        if (error) {
          callback(error, [], undefined);
          return;
        }
        if (!addresses.length) {
          callback(new Error("URL hostname did not resolve"), [], undefined);
          return;
        }
        const blocked = addresses.find(
          ({ address }) => !isPublicAddress(address),
        );
        if (blocked) {
          callback(
            new Error(`URL resolves to blocked address ${blocked.address}`),
            [],
            undefined,
          );
          return;
        }
        if (options.all) callback(null, addresses, undefined);
        else {
          const first = addresses[0];
          if (!first) {
            callback(new Error("URL hostname did not resolve"), [], undefined);
            return;
          }
          callback(null, first.address, first.family);
        }
      },
    );
  };
  return new Agent({ connect: { lookup: safeLookup } });
}

function parsePublicUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("URL is invalid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("URL must use HTTP or HTTPS");
  }
  if (url.username || url.password) {
    throw new Error("URL credentials are not allowed");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    (isIP(hostname) !== 0 && !isPublicAddress(hostname))
  ) {
    throw new Error("URL host is not public");
  }
  return url;
}

function isTextContentType(contentType: string): boolean {
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return (
    mediaType.startsWith("text/") ||
    mediaType === "application/json" ||
    mediaType === "application/ld+json" ||
    mediaType === "application/xml" ||
    mediaType === "application/xhtml+xml" ||
    mediaType === "application/javascript" ||
    mediaType.endsWith("+json") ||
    mediaType.endsWith("+xml")
  );
}

async function readBody(
  body: Awaited<ReturnType<FetchImplementation>>["body"],
  limit: number,
): Promise<{ text: string; truncated: boolean }> {
  if (!body) return { text: "", truncated: false };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let truncated = false;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      const value: unknown = item.value;
      if (!(value instanceof Uint8Array)) {
        throw new Error("URL returned an invalid response body");
      }
      const remaining = Math.max(0, limit - bytes);
      if (value.byteLength > remaining) truncated = true;
      if (remaining > 0) {
        const chunk = value.subarray(0, remaining);
        chunks.push(chunk);
        bytes += chunk.byteLength;
      }
      if (truncated) {
        await reader.cancel();
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }

  const joined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(joined), truncated };
}

const blockedAddresses = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedAddresses.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  ["2001:db8::", 32],
] as const) {
  blockedAddresses.addSubnet(network, prefix, "ipv6");
}
