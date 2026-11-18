import { describe, expect, it } from "vitest";
import { unifiedDiff } from "../src/lib/receipt/diff";
import { extractLlmSteps } from "../src/lib/receipt/extract-llm-steps";
import { parseVitestJson } from "../src/lib/receipt/parse-vitest";
import { decideVerdict, sumLlmTotals } from "../src/lib/receipt/totals";
import {
  claimFromSubmit,
  emptyClaim,
  extractSubmitClaim,
} from "../src/lib/agent/tools";
import sampleVerified from "../samples/sample-verified.json";
import sampleHidden from "../samples/sample-hidden.json";
import type { LlmStepLog, Receipt } from "../src/lib/types";

describe("parseVitestJson", () => {
  it("parses a vitest JSON reporter payload into per-test results", () => {
    const raw = JSON.stringify({
      success: false,
      numPassedTests: 4,
      numFailedTests: 1,
      numPendingTests: 0,
      numTotalTests: 5,
      testResults: [
        {
          assertionResults: [
            {
              title: "applies 10% off when buying exactly 3",
              fullName:
                "applyBulkDiscount applies 10% off when buying exactly 3",
              status: "failed",
              duration: 3,
              failureMessages: ["expected 15000 to be 13500"],
            },
            {
              title: "charges full price for a single item",
              fullName: "applyBulkDiscount charges full price for a single item",
              status: "passed",
              duration: 1,
            },
          ],
        },
      ],
    });

    const suite = parseVitestJson(raw, 1, "stdout", "stderr");
    expect(suite.passed).toBe(false);
    expect(suite.summary).toEqual({
      total: 5,
      passed: 4,
      failed: 1,
      skipped: 0,
    });
    expect(suite.tests[0]?.status).toBe("failed");
    expect(suite.tests[0]?.errorMessage).toContain("13500");
  });

  it("never passes when JSON is missing, even on exit 0", () => {
    const suite = parseVitestJson(null, 0, "x", "y");
    expect(suite.passed).toBe(false);
    expect(suite.tests).toEqual([]);
  });

  it("does not let success:true override a nonzero exit code", () => {
    const raw = JSON.stringify({
      success: true,
      numPassedTests: 5,
      numFailedTests: 0,
      numPendingTests: 0,
      numTotalTests: 5,
      testResults: [
        {
          assertionResults: [
            {
              title: "ok",
              fullName: "ok",
              status: "passed",
              duration: 1,
            },
          ],
        },
      ],
    });
    expect(parseVitestJson(raw, 1, "", "").passed).toBe(false);
  });

  it("passes only with exit 0, zero failures, and parsed tests", () => {
    const raw = JSON.stringify({
      success: true,
      numPassedTests: 1,
      numFailedTests: 0,
      numPendingTests: 0,
      numTotalTests: 1,
      testResults: [
        {
          assertionResults: [
            {
              title: "ok",
              fullName: "ok",
              status: "passed",
              duration: 1,
            },
          ],
        },
      ],
    });
    expect(parseVitestJson(raw, 0, "", "").passed).toBe(true);
  });
});

describe("write allowlist", () => {
  it("allows only pricing.ts", async () => {
    const { isAllowedWritePath } = await import("../src/lib/sandbox/harness");
    expect(isAllowedWritePath("buggy-pricing/src/pricing.ts")).toBe(true);
    expect(isAllowedWritePath("/vercel/sandbox/buggy-pricing/src/pricing.ts")).toBe(
      true,
    );
    expect(isAllowedWritePath("buggy-pricing/src/pricing.visible.test.ts")).toBe(
      false,
    );
    expect(isAllowedWritePath("buggy-pricing/src/pricing.hidden.test.ts")).toBe(
      false,
    );
    expect(isAllowedWritePath("buggy-pricing/package.json")).toBe(false);
  });
});

describe("sumLlmTotals + extractLlmSteps", () => {
  it("never invents cost when gateway.cost is absent", () => {
    const steps = extractLlmSteps([
      {
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        finishReason: "stop",
        text: "hi",
        response: { modelId: "anthropic/claude-haiku-4.5" },
        providerMetadata: {
          gateway: {
            generationId: "gen_1",
            routing: {
              finalProvider: "anthropic",
              canonicalSlug: "anthropic/claude-haiku-4.5",
            },
          },
        },
      },
    ]);

    expect(steps).toHaveLength(1);
    expect(steps[0]?.costUsd).toBe("unavailable");
    expect(steps[0]?.notes.some((n) => n.includes("cost unavailable"))).toBe(
      true,
    );

    const totals = sumLlmTotals(steps);
    expect(totals.costUsd).toBe("unavailable");
    expect(totals.inputTokens).toBe(10);
    expect(totals.stepsMissingCost).toBe(1);
  });

  it("sums costs when every step reports a numeric gateway.cost", () => {
    const steps: LlmStepLog[] = [
      {
        stepNumber: 1,
        modelId: "m",
        provider: "p",
        canonicalSlug: "m",
        generationId: "g1",
        inputTokens: 1,
        outputTokens: 2,
        totalTokens: 3,
        costUsd: "0.0010",
        finishReason: "stop",
        textPreview: "",
        toolCalls: [],
        notes: [],
      },
      {
        stepNumber: 2,
        modelId: "m",
        provider: "p",
        canonicalSlug: "m",
        generationId: "g2",
        inputTokens: 4,
        outputTokens: 5,
        totalTokens: 9,
        costUsd: "0.0020",
        finishReason: "stop",
        textPreview: "",
        toolCalls: [],
        notes: [],
      },
    ];
    const totals = sumLlmTotals(steps);
    expect(totals.inputTokens).toBe(5);
    expect(totals.outputTokens).toBe(7);
    expect(totals.totalTokens).toBe(12);
    expect(totals.costUsd).toBe("0.003");
    expect(totals.stepsWithCost).toBe(2);
  });
});

describe("decideVerdict", () => {
  it("maps structured claim + proof to the four demo verdicts", () => {
    expect(
      decideVerdict({
        claimSubmitted: true,
        claimedFixed: true,
        verified: false,
      }),
    ).toBe("claim-failed-verification");
    expect(
      decideVerdict({
        claimSubmitted: true,
        claimedFixed: true,
        verified: true,
      }),
    ).toBe("verified");
    expect(
      decideVerdict({
        claimSubmitted: true,
        claimedFixed: false,
        verified: false,
      }),
    ).toBe("not-fixed");
    expect(
      decideVerdict({
        claimSubmitted: true,
        claimedFixed: false,
        verified: true,
      }),
    ).toBe("not-fixed");
    expect(
      decideVerdict({
        claimSubmitted: false,
        claimedFixed: null,
        verified: true,
      }),
    ).toBe("no-claim");
  });
});

describe("submitClaim extraction", () => {
  it("returns no-claim when submitClaim was never called", () => {
    const claim = extractSubmitClaim([
      { text: "Now let's run the tests again to verify the fix:", toolCalls: [] },
    ]);
    expect(claim.submitted).toBe(false);
    expect(claim.claimedFixed).toBeNull();
    expect(claim.summary).toBe("No claim submitted");
  });

  it("reads structured submitClaim tool input", () => {
    const claim = extractSubmitClaim([
      {
        toolCalls: [
          {
            toolName: "submitClaim",
            input: {
              fixed: true,
              summary: "Changed > to >=",
              filesChanged: ["src/pricing.ts"],
              testsRun: "npm test — pass",
            },
          },
        ],
      },
    ]);
    expect(claim.submitted).toBe(true);
    expect(claim.claimedFixed).toBe(true);
    expect(claim.summary).toContain(">");
    expect(claim.filesChanged).toEqual(["src/pricing.ts"]);
  });

  it("claimFromSubmit sets submitted", () => {
    const c = claimFromSubmit({
      fixed: false,
      summary: "still broken",
      filesChanged: [],
      testsRun: "failing",
    });
    expect(c).toMatchObject({
      submitted: true,
      claimedFixed: false,
      summary: "still broken",
    });
    expect(emptyClaim().submitted).toBe(false);
  });
});

describe("unifiedDiff", () => {
  it("marks changed lines", () => {
    const diff = unifiedDiff("pricing.ts", "a\nb\n", "a\nc\n");
    expect(diff).toContain("-b");
    expect(diff).toContain("+c");
  });
});

describe("sample receipts", () => {
  it("sample-verified is marked verified", () => {
    const r = sampleVerified as Receipt;
    expect(r.isSample).toBe(true);
    expect(r.verdict).toBe("verified");
    expect(r.verification.verified).toBe(true);
    expect(r.agentClaim.submitted).toBe(true);
    expect(r.agentClaim.claimedFixed).toBe(true);
  });

  it("sample-hidden flags claim-failed-verification with held-out failures", () => {
    const r = sampleHidden as Receipt;
    expect(r.isSample).toBe(true);
    expect(r.mode).toBe("hidden");
    expect(r.verdict).toBe("claim-failed-verification");
    expect(r.agentClaim.submitted).toBe(true);
    expect(r.agentClaim.claimedFixed).toBe(true);
    expect(r.verification.verified).toBe(false);
    expect(r.verification.method).toBe("pristine-plus-diff");
    expect(r.verification.hiddenTests.some((t) => t.status === "failed")).toBe(
      true,
    );
    expect(r.hiddenTestSource).toContain("cartTotalCents (hidden)");
  });
});

describe("hidden harness naming", () => {
  it("trusted harness lists visible + hidden test files", async () => {
    const { TRUSTED_HARNESS_FILES } = await import("../src/lib/sandbox/harness");
    expect(TRUSTED_HARNESS_FILES).toContain("src/pricing.visible.test.ts");
    expect(TRUSTED_HARNESS_FILES).toContain("src/pricing.hidden.test.ts");
  });
});

describe("fixture source does not label bugs", () => {
  it("pricing.ts has no BUG annotations", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(
      new URL("../fixtures/buggy-pricing/src/pricing.ts", import.meta.url),
      "utf8",
    );
    expect(src).not.toMatch(/BUG\s*\d/i);
    expect(src).not.toMatch(/instead of/i);
    expect(src).not.toMatch(/off-by-one/i);
  });
});
