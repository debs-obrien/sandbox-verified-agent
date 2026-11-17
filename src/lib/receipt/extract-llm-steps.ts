import type { LlmStepLog, Unavailable } from "../types";

const UNAVAILABLE: Unavailable = "unavailable";

type StepLike = {
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  finishReason?: string;
  text?: string;
  toolCalls?: Array<{ toolName?: string; input?: unknown }>;
  response?: { modelId?: string };
  providerMetadata?: {
    gateway?: {
      cost?: string;
      marketCost?: string;
      generationId?: string;
      routing?: {
        resolvedProvider?: string;
        finalProvider?: string;
        canonicalSlug?: string;
        originalModelId?: string;
      };
    };
  };
  model?: { modelId?: string };
};

/**
 * Extract per-step Gateway metadata from an AI SDK agent/generateText result.
 * Missing fields are recorded as "unavailable" — never invented.
 */
export function extractLlmSteps(steps: unknown): LlmStepLog[] {
  if (!Array.isArray(steps)) return [];

  return steps.map((raw, index) => {
    const step = (raw ?? {}) as StepLike;
    const gateway = step.providerMetadata?.gateway;
    const routing = gateway?.routing;
    const notes: string[] = [];

    const modelId =
      step.response?.modelId ??
      routing?.canonicalSlug ??
      routing?.originalModelId ??
      UNAVAILABLE;

    if (modelId === UNAVAILABLE) {
      notes.push(
        "modelId unavailable on this step (no response.modelId / gateway routing slug).",
      );
    } else if (
      routing?.originalModelId &&
      routing?.canonicalSlug &&
      routing.originalModelId === routing.canonicalSlug
    ) {
      notes.push(
        "Gateway returned the same id for originalModelId and canonicalSlug — resolved version may be an alias (see vercel/ai#21213 for related alias modelId behavior).",
      );
    }

    const provider =
      routing?.finalProvider ?? routing?.resolvedProvider ?? UNAVAILABLE;
    if (provider === UNAVAILABLE) {
      notes.push("provider unavailable (no gateway.routing.finalProvider).");
    }

    const costUsd =
      typeof gateway?.cost === "string" ? gateway.cost : UNAVAILABLE;
    if (costUsd === UNAVAILABLE) {
      notes.push(
        "cost unavailable (providerMetadata.gateway.cost not present on this step).",
      );
    }

    const generationId =
      typeof gateway?.generationId === "string"
        ? gateway.generationId
        : UNAVAILABLE;

    const usage = step.usage;
    const inputTokens =
      typeof usage?.inputTokens === "number" ? usage.inputTokens : UNAVAILABLE;
    const outputTokens =
      typeof usage?.outputTokens === "number"
        ? usage.outputTokens
        : UNAVAILABLE;
    const totalTokens =
      typeof usage?.totalTokens === "number" ? usage.totalTokens : UNAVAILABLE;

    if (inputTokens === UNAVAILABLE) {
      notes.push("inputTokens unavailable on step.usage.");
    }

    const toolCalls = (step.toolCalls ?? []).map((tc) => ({
      toolName: tc.toolName ?? "unknown",
      inputPreview: truncate(JSON.stringify(tc.input ?? {}), 240),
    }));

    return {
      stepNumber: index + 1,
      modelId,
      provider,
      canonicalSlug: routing?.canonicalSlug ?? UNAVAILABLE,
      generationId,
      inputTokens,
      outputTokens,
      totalTokens,
      costUsd,
      finishReason: step.finishReason ?? UNAVAILABLE,
      textPreview: truncate(step.text ?? "", 400),
      toolCalls,
      notes,
    };
  });
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + `…(+${s.length - n} chars)`;
}
