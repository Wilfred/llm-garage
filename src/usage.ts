export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  // Absent when the provider did not report a cost for the request.
  costUsd?: number;
};

export function addUsage(
  total: TokenUsage | undefined,
  next: TokenUsage,
): TokenUsage {
  if (!total) return next;
  const costUsd =
    total.costUsd === undefined && next.costUsd === undefined
      ? undefined
      : (total.costUsd ?? 0) + (next.costUsd ?? 0);
  return {
    inputTokens: total.inputTokens + next.inputTokens,
    outputTokens: total.outputTokens + next.outputTokens,
    ...(costUsd === undefined ? {} : { costUsd }),
  };
}

export function sumUsage(
  usages: Array<TokenUsage | undefined>,
): TokenUsage | undefined {
  return usages.reduce<TokenUsage | undefined>(
    (total, usage) => (usage ? addUsage(total, usage) : total),
    undefined,
  );
}

export function formatTokens(tokens: number): string {
  return tokens.toLocaleString("en-US");
}

export function formatUsd(costUsd: number): string {
  if (costUsd > 0 && costUsd < 0.0001) return "<$0.0001";
  return costUsd.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: costUsd < 1 ? 4 : 2,
  });
}

export function formatUsage(usage: TokenUsage): string {
  return [
    `${formatTokens(usage.inputTokens)} input tokens`,
    `${formatTokens(usage.outputTokens)} output tokens`,
    ...(usage.costUsd === undefined ? [] : [formatUsd(usage.costUsd)]),
  ].join(" · ");
}
