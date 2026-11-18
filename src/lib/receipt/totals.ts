import type {
  LlmStepLog,
  ReceiptTotals,
  Unavailable,
  Verdict,
} from "../types";

const UNAVAILABLE: Unavailable = "unavailable";

/**
 * Sum token/cost fields across LLM steps.
 * If any step is missing a numeric field, that total becomes "unavailable"
 * (we never invent values). Cost is summed only when every step with a
 * recorded generation also has a numeric cost string — otherwise unavailable,
 * with a count of steps missing cost.
 */
export function sumLlmTotals(steps: LlmStepLog[]): ReceiptTotals {
  let input = 0;
  let output = 0;
  let total = 0;
  let cost = 0;
  let inputOk = steps.length > 0;
  let outputOk = steps.length > 0;
  let totalOk = steps.length > 0;
  let costOk = steps.length > 0;
  let stepsWithCost = 0;
  let stepsMissingCost = 0;

  if (steps.length === 0) {
    return {
      inputTokens: UNAVAILABLE,
      outputTokens: UNAVAILABLE,
      totalTokens: UNAVAILABLE,
      costUsd: UNAVAILABLE,
      stepsWithCost: 0,
      stepsMissingCost: 0,
    };
  }

  for (const step of steps) {
    if (typeof step.inputTokens === "number") input += step.inputTokens;
    else inputOk = false;

    if (typeof step.outputTokens === "number") output += step.outputTokens;
    else outputOk = false;

    if (typeof step.totalTokens === "number") total += step.totalTokens;
    else totalOk = false;

    if (typeof step.costUsd === "string" && step.costUsd !== "unavailable") {
      const n = Number(step.costUsd);
      if (Number.isFinite(n)) {
        cost += n;
        stepsWithCost += 1;
      } else {
        costOk = false;
        stepsMissingCost += 1;
      }
    } else {
      costOk = false;
      stepsMissingCost += 1;
    }
  }

  return {
    inputTokens: inputOk ? input : UNAVAILABLE,
    outputTokens: outputOk ? output : UNAVAILABLE,
    totalTokens: totalOk ? total : UNAVAILABLE,
    costUsd: costOk ? cost.toFixed(8).replace(/\.?0+$/, "") || "0" : UNAVAILABLE,
    stepsWithCost,
    stepsMissingCost,
  };
}

/**
 * Verdict from structured claim + independent proof.
 * - claimed fixed + green → verified
 * - claimed fixed + red → caught (claim-failed-verification)
 * - claimed not fixed → not-fixed (honest)
 * - no submitClaim → no-claim
 */
export function decideVerdict(args: {
  claimSubmitted: boolean;
  claimedFixed: boolean | null;
  verified: boolean;
  errored?: boolean;
}): Verdict {
  if (args.errored) return "error";
  if (!args.claimSubmitted || args.claimedFixed === null) return "no-claim";
  if (args.claimedFixed && args.verified) return "verified";
  if (args.claimedFixed && !args.verified) return "claim-failed-verification";
  return "not-fixed";
}
