import { describe, expect, it, vi } from "vitest";
import {
  buildForcedClaimFollowUpMessages,
  ensureClaimSubmitted,
  FORCED_CLAIM_USER_MESSAGE,
  forceClaimPrepareStep,
  isFinalAllowedStep,
  needsForcedClaimFollowUp,
  SUBMIT_CLAIM_TOOL,
} from "../src/lib/agent/force-claim";
import {
  claimFromSubmit,
  emptyClaim,
  extractSubmitClaim,
} from "../src/lib/agent/tools";
import { decideVerdict } from "../src/lib/receipt/totals";

describe("force claim — step-limit hypothesis", () => {
  it("treats the last 0-based step as the final allowed step (isStepCount(N))", () => {
    // AI SDK: prepareStep gets stepNumber = steps.length; stop when length === N.
    expect(isFinalAllowedStep(0, 8)).toBe(false);
    expect(isFinalAllowedStep(6, 8)).toBe(false);
    expect(isFinalAllowedStep(7, 8)).toBe(true);
    expect(isFinalAllowedStep(8, 8)).toBe(true);
  });

  it("prepareStep forces submitClaim only on the final allowed step", () => {
    expect(forceClaimPrepareStep({ stepNumber: 3, maxSteps: 8 })).toBeUndefined();

    const forced = forceClaimPrepareStep({ stepNumber: 7, maxSteps: 8 });
    expect(forced).toEqual({
      toolChoice: { type: "tool", toolName: SUBMIT_CLAIM_TOOL },
      activeTools: [SUBMIT_CLAIM_TOOL],
    });
  });

  it("needsForcedClaimFollowUp is true only when submitClaim never landed", () => {
    expect(needsForcedClaimFollowUp(null)).toBe(true);
    expect(needsForcedClaimFollowUp(emptyClaim("narration only"))).toBe(true);
    expect(
      needsForcedClaimFollowUp(
        claimFromSubmit({
          fixed: true,
          summary: "fixed threshold",
          filesChanged: ["src/pricing.ts"],
          testsRun: "npm test — pass",
        }),
      ),
    ).toBe(false);
    expect(
      needsForcedClaimFollowUp(
        claimFromSubmit({
          fixed: false,
          summary: "could not fix",
          filesChanged: [],
          testsRun: "npm test — fail",
        }),
      ),
    ).toBe(false);
  });
});

describe("force claim — follow-up path", () => {
  it("builds follow-up messages that share history and nudge submitClaim", () => {
    const prior = [
      {
        role: "assistant" as const,
        content: "Perfect! All tests are now passing!",
      },
    ];
    const messages = buildForcedClaimFollowUpMessages(prior);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual(prior[0]);
    expect(messages[1]).toEqual({
      role: "user",
      content: FORCED_CLAIM_USER_MESSAGE,
    });
    expect(FORCED_CLAIM_USER_MESSAGE).toContain("submitClaim");
  });

  it("skips follow-up when the main loop already submitted a claim", async () => {
    const existing = claimFromSubmit({
      fixed: true,
      summary: "done",
      filesChanged: ["src/pricing.ts"],
      testsRun: "pass",
    });
    const runFollowUp = vi.fn(async () => ({ steps: [], text: "" }));

    const result = await ensureClaimSubmitted({
      claim: existing,
      steps: [{ stepNumber: 1 }],
      runFollowUp,
    });

    expect(runFollowUp).not.toHaveBeenCalled();
    expect(result.forcedFollowUp).toBe(false);
    expect(result.claim).toEqual(existing);
    expect(result.steps).toHaveLength(1);
  });

  it("runs one forced follow-up and merges claim + steps when main loop had no claim", async () => {
    // Mirrors 3bea3eb: narration after green tests, step budget exhausted, no submitClaim.
    const narrationStep = {
      toolCalls: [],
      text: "Perfect! All tests are now passing! Let me verify the fix by reviewing what was changed:",
    };
    const followUpStep = {
      toolCalls: [
        {
          toolName: "submitClaim",
          input: {
            fixed: true,
            summary: "Fixed >= threshold and per-line cart discount",
            filesChanged: ["src/pricing.ts"],
            testsRun: "npm test — 10/10",
          },
        },
      ],
    };

    const runFollowUp = vi.fn(async () => ({
      steps: [followUpStep],
      text: "",
    }));

    const result = await ensureClaimSubmitted({
      claim: emptyClaim(String(narrationStep.text)),
      steps: [narrationStep],
      rawText: String(narrationStep.text),
      runFollowUp,
    });

    expect(runFollowUp).toHaveBeenCalledTimes(1);
    expect(result.forcedFollowUp).toBe(true);
    expect(result.steps).toHaveLength(2);
    expect(result.claim.submitted).toBe(true);
    expect(result.claim.claimedFixed).toBe(true);
    expect(result.claim.summary).toContain("threshold");

    // Honest fixed=false still yields a real claim (not no-claim).
    const honest = await ensureClaimSubmitted({
      claim: emptyClaim(),
      steps: [],
      runFollowUp: async () => ({
        steps: [
          {
            toolCalls: [
              {
                toolName: "submitClaim",
                input: {
                  fixed: false,
                  summary: "Still failing two cart cases",
                  filesChanged: ["src/pricing.ts"],
                  testsRun: "npm test — 8/10",
                },
              },
            ],
          },
        ],
      }),
    });
    expect(honest.claim.submitted).toBe(true);
    expect(honest.claim.claimedFixed).toBe(false);
    expect(
      decideVerdict({
        claimSubmitted: honest.claim.submitted,
        claimedFixed: honest.claim.claimedFixed,
        verified: false,
      }),
    ).toBe("not-fixed");
  });

  it("keeps no-claim only when the forced follow-up also produces no submitClaim", async () => {
    const result = await ensureClaimSubmitted({
      claim: emptyClaim("I refuse to use tools"),
      steps: [{ toolCalls: [] }],
      runFollowUp: async () => ({
        steps: [{ toolCalls: [], text: "still no tool" }],
        text: "still no tool",
      }),
    });

    expect(result.forcedFollowUp).toBe(true);
    expect(result.claim.submitted).toBe(false);
    expect(
      decideVerdict({
        claimSubmitted: result.claim.submitted,
        claimedFixed: result.claim.claimedFixed,
        verified: true,
      }),
    ).toBe("no-claim");
  });

  it("extractSubmitClaim still parses the forced follow-up step shape", () => {
    const claim = extractSubmitClaim(
      [
        {
          toolCalls: [
            {
              toolName: "submitClaim",
              input: {
                fixed: true,
                summary: "ok",
                filesChanged: [],
                testsRun: "pass",
              },
            },
          ],
        },
      ],
      "",
    );
    expect(claim.submitted).toBe(true);
    expect(claim.claimedFixed).toBe(true);
  });
});
