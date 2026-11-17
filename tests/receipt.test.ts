import { describe, expect, it } from "vitest";
import { unifiedDiff } from "../src/lib/receipt/diff";
import { extractLlmSteps } from "../src/lib/receipt/extract-llm-steps";
import { parseVitestJson } from "../src/lib/receipt/parse-vitest";
import { decideVerdict, sumLlmTotals } from "../src/lib/receipt/totals";
import { parseAgentClaim } from "../src/lib/agent/prompts";
import sampleVerified from "../samples/sample-verified.json";
import sampleCaught from "../samples/sample-caught.json";
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

  it("falls back safely when JSON is missing", () => {
    const suite = parseVitestJson(null, 1, "x", "y");
    expect(suite.passed).toBe(false);
    expect(suite.tests).toEqual([]);
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
  it("flags claim-failed-verification when claim is true but verify fails", () => {
    expect(
      decideVerdict({ claimedFixed: true, verified: false }),
    ).toBe("claim-failed-verification");
    expect(
      decideVerdict({ claimedFixed: true, verified: true }),
    ).toBe("verified");
    expect(
      decideVerdict({ claimedFixed: false, verified: false }),
    ).toBe("not-fixed");
  });
});

describe("parseAgentClaim", () => {
  it("detects CLAIM: FIXED marker", () => {
    expect(parseAgentClaim("All good.\nCLAIM: FIXED").claimedFixed).toBe(true);
    expect(parseAgentClaim("Still broken").claimedFixed).toBe(false);
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
  });

  it("sample-caught flags claim-failed-verification", () => {
    const r = sampleCaught as Receipt;
    expect(r.isSample).toBe(true);
    expect(r.verdict).toBe("claim-failed-verification");
    expect(r.agentClaim.claimedFixed).toBe(true);
    expect(r.verification.verified).toBe(false);
  });
});
