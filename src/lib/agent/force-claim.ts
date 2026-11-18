/**
 * Ensure every successful agent loop ends with submitClaim.
 *
 * Hypothesis (verified against AI SDK stopWhen): isStepCount(N) stops when
 * steps.length === N even if submitClaim was never called. Agents often spend
 * the last step narrating ("tests are passing…") instead of claiming, which
 * yields verdict no-claim despite a real fix.
 *
 * Mitigations (AI SDK-native):
 * 1. prepareStep forces toolChoice → submitClaim on the final allowed step
 * 2. If the loop still ends without a claim, one follow-up generateText with
 *    the same history + toolChoice { type: "tool", toolName: "submitClaim" }
 *
 * Honest outcomes remain: fixed can be true or false. no-claim is reserved
 * for errors / hard refusal after the forced path.
 */

import type { ModelMessage } from "ai";
import type { AgentClaim } from "../types";
import { emptyClaim, extractSubmitClaim } from "./tools";

export const SUBMIT_CLAIM_TOOL = "submitClaim" as const;

/** User nudge appended when we force a claim follow-up. */
export const FORCED_CLAIM_USER_MESSAGE =
  "Stop exploring and narrating. Call submitClaim now with your honest outcome: fixed=true if workspace tests passed after your fix, otherwise fixed=false. Do not call any other tool.";

/**
 * stepNumber is 0-based (AI SDK passes steps.length for the step about to run).
 * The final allowed step is maxSteps - 1; after it completes, isStepCount(maxSteps) stops.
 */
export function isFinalAllowedStep(
  stepNumber: number,
  maxSteps: number,
): boolean {
  if (maxSteps < 1) return true;
  return stepNumber >= maxSteps - 1;
}

export type ForceClaimPrepareResult = {
  toolChoice: { type: "tool"; toolName: typeof SUBMIT_CLAIM_TOOL };
  activeTools: Array<typeof SUBMIT_CLAIM_TOOL>;
};

/**
 * prepareStep helper: on the last allowed step, require submitClaim only.
 * Returns undefined earlier so the agent keeps normal toolChoice.
 */
export function forceClaimPrepareStep(args: {
  stepNumber: number;
  maxSteps: number;
}): ForceClaimPrepareResult | undefined {
  if (!isFinalAllowedStep(args.stepNumber, args.maxSteps)) {
    return undefined;
  }
  return {
    toolChoice: { type: "tool", toolName: SUBMIT_CLAIM_TOOL },
    activeTools: [SUBMIT_CLAIM_TOOL],
  };
}

/** True when the main loop finished without a structured submitClaim. */
export function needsForcedClaimFollowUp(claim: {
  submitted?: boolean;
} | null): boolean {
  return claim?.submitted !== true;
}

/**
 * Build messages for a forced follow-up generateText that shares prior history.
 * `responseMessages` should be GenerateTextResult.responseMessages from the main loop.
 */
export function buildForcedClaimFollowUpMessages(
  responseMessages: ReadonlyArray<ModelMessage>,
): ModelMessage[] {
  return [
    ...responseMessages,
    { role: "user", content: FORCED_CLAIM_USER_MESSAGE },
  ];
}

export type ForcedClaimFollowUpResult = {
  steps: unknown[];
  text?: string;
};

/**
 * If the main loop produced no claim, run one forced follow-up and merge steps.
 * `runFollowUp` is injected so unit tests can cover the path without a live model.
 */
export async function ensureClaimSubmitted(args: {
  claim: AgentClaim;
  steps: unknown[];
  rawText?: string;
  runFollowUp: () => Promise<ForcedClaimFollowUpResult>;
}): Promise<{ claim: AgentClaim; steps: unknown[]; forcedFollowUp: boolean }> {
  if (!needsForcedClaimFollowUp(args.claim)) {
    return {
      claim: args.claim,
      steps: args.steps,
      forcedFollowUp: false,
    };
  }

  const followUp = await args.runFollowUp();
  const steps = [...args.steps, ...followUp.steps];
  const claim = extractSubmitClaim(
    steps,
    followUp.text ?? args.rawText ?? "",
  );

  return {
    claim: claim.submitted ? claim : emptyClaim(followUp.text ?? args.rawText ?? ""),
    steps,
    forcedFollowUp: true,
  };
}
