import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  buildEvidencePack,
  buildEvidencePackFromReceipt,
  evidencePackMetaFromWritten,
  scrubSecrets,
  sha256Utf8,
  verifyEvidencePackIntegrity,
  withUpdatedCleanupLog,
} from "../src/lib/receipt/evidence";
import type { Receipt } from "../src/lib/types";

function baseReceipt(): Receipt {
  return {
    id: "rec-test-1",
    createdAt: "2026-11-18T12:00:00.000Z",
    finishedAt: "2026-11-18T12:02:00.000Z",
    durationMs: 120_000,
    mode: "normal",
    isSample: false,
    bugReport: "bug",
    modelConfigured: "anthropic/claude-haiku-4.5",
    agentClaim: {
      submitted: true,
      claimedFixed: true,
      summary: "fixed threshold",
      filesChanged: ["src/pricing.ts"],
      testsRun: "npm test — pass",
      rawText: '{"fixed":true}',
    },
    commands: [],
    llmSteps: [
      {
        stepNumber: 1,
        modelId: "anthropic/claude-haiku-4.5",
        provider: "anthropic",
        canonicalSlug: "unavailable",
        generationId: "gen_1",
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        costUsd: "0.0001",
        finishReason: "tool-calls",
        textPreview: "",
        toolCalls: [{ toolName: "submitClaim", inputPreview: "{…}" }],
        notes: [],
      },
    ],
    totals: {
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      costUsd: "0.0001",
      stepsWithCost: 1,
      stepsMissingCost: 0,
    },
    diffs: [
      {
        path: "src/pricing.ts",
        before: "if (qty > 3)",
        after: "if (qty >= 3)",
        unifiedDiff: "--- a/src/pricing.ts\n+++ b/src/pricing.ts\n",
      },
    ],
    agentTests: {
      passed: true,
      exitCode: 0,
      stdout: "Test Files  2 passed",
      stderr: "",
      tests: [],
      summary: { total: 10, passed: 10, failed: 0, skipped: 0 },
    },
    verification: {
      independentTests: {
        passed: true,
        exitCode: 0,
        stdout: "FULL independent stdout",
        stderr: "FULL independent stderr",
        tests: [],
        summary: { total: 10, passed: 10, failed: 0, skipped: 0 },
      },
      visibleTests: [],
      hiddenTests: [],
      verified: true,
      beforeSnapshotId: "unavailable",
      afterSnapshotId: "unavailable",
      verificationSandboxId: "sbx_verify",
      method: "pristine-plus-diff",
    },
    verdict: "verified",
    networkPolicyNotes: ["deny-all"],
    architectureNotes: ["evidence pack first"],
    agentSandboxId: "sbx_agent",
  };
}

describe("evidence pack", () => {
  it("scrubs secrets from artifact text", () => {
    const dirty =
      'Authorization: Bearer abc.def.ghi AI_GATEWAY_API_KEY=sk-secret VERCEL_TOKEN=tok';
    const clean = scrubSecrets(dirty);
    expect(clean).not.toContain("sk-secret");
    expect(clean).not.toContain("tok");
    expect(clean).toContain("[REDACTED]");
  });

  it("builds a pack with sha256 manifest covering every artifact", () => {
    const pack = buildEvidencePackFromReceipt(baseReceipt(), {
      cleanupLog: [
        {
          kind: "sandbox",
          id: "sbx_agent",
          deletedAt: "2026-11-18T12:02:01.000Z",
          deleted: true,
          note: "Disposed after evidence write",
        },
      ],
      snapshotsCreated: [],
    });

    expect(pack.version).toBe(1);
    expect(pack.receiptId).toBe("rec-test-1");
    expect(pack.artifacts["claim.json"]).toContain("fixed threshold");
    expect(pack.artifacts["files/src/pricing.ts"]).toContain(">=");
    expect(pack.artifacts["diffs/src/pricing.ts.diff"]).toContain("pricing.ts");
    expect(pack.artifacts["tests/independent.stdout.txt"]).toBe(
      "FULL independent stdout",
    );
    expect(pack.artifacts["tests/independent.stderr.txt"]).toBe(
      "FULL independent stderr",
    );
    expect(pack.artifacts["sandboxes.json"]).toContain("sbx_agent");

    const integrity = verifyEvidencePackIntegrity(pack);
    expect(integrity.ok).toBe(true);
    expect(integrity.mismatches).toEqual([]);
    expect(pack.manifest.artifacts.length).toBeGreaterThan(8);
  });

  it("detects tampering via manifest hashes", () => {
    const pack = buildEvidencePackFromReceipt(baseReceipt());
    pack.artifacts["claim.json"] = '{"tampered":true}';
    const integrity = verifyEvidencePackIntegrity(pack);
    expect(integrity.ok).toBe(false);
    expect(integrity.mismatches.some((m) => m.includes("claim.json"))).toBe(
      true,
    );
  });

  it("updates cleanup log and remanifests hashes", () => {
    const pack = buildEvidencePackFromReceipt(baseReceipt());
    const updated = withUpdatedCleanupLog(pack, [
      {
        kind: "snapshot",
        id: "snap_1",
        deletedAt: "2026-11-18T12:03:00.000Z",
        deleted: true,
        note: "Deleted after evidence pack write.",
      },
    ]);
    expect(updated.artifacts["cleanup-log.json"]).toContain("snap_1");
    expect(verifyEvidencePackIntegrity(updated).ok).toBe(true);
    expect(updated.manifest.artifacts.find((a) => a.path === "cleanup-log.json")
      ?.sha256).toBe(sha256Utf8(updated.artifacts["cleanup-log.json"]!));
  });

  it("includes hidden test source when present", () => {
    const receipt = baseReceipt();
    receipt.mode = "hidden";
    receipt.verdict = "claim-failed-verification";
    receipt.hiddenTestSource = "describe('hidden', () => {});";
    const pack = buildEvidencePackFromReceipt(receipt);
    expect(
      pack.artifacts["hidden-tests/pricing.hidden.test.ts"],
    ).toContain("hidden");
  });

  it("evidencePackMetaFromWritten records size and artifact list", () => {
    const pack = buildEvidencePackFromReceipt(baseReceipt());
    const meta = evidencePackMetaFromWritten({
      pathname: "receipts/rec-test-1.evidence.json",
      pack,
      writtenAt: "2026-11-18T12:02:00.000Z",
    });
    expect(meta.status).toBe("written");
    expect(meta.bytes).toBeGreaterThan(100);
    expect(meta.sha256).toHaveLength(64);
    expect(meta.artifactCount).toBe(pack.manifest.artifacts.length);
    expect(meta.artifacts?.[0]?.path).toBeTruthy();
  });
});

describe("cleanup after evidence gate", () => {
  const stopMock = vi.fn();
  const deleteMock = vi.fn();
  const listSnapshotsMock = vi.fn();

  beforeEach(() => {
    stopMock.mockReset();
    deleteMock.mockReset();
    listSnapshotsMock.mockReset();
    stopMock.mockResolvedValue(undefined);
    deleteMock.mockResolvedValue(undefined);
    listSnapshotsMock.mockResolvedValue({ snapshots: [], pagination: {} });
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("does not delete orphan snapshots when evidence was not written", async () => {
    const { cleanupAfterEvidence } = await import(
      "../src/lib/sandbox/evidence-cleanup"
    );

    const sandbox = {
      name: "sbx_agent",
      stop: stopMock,
      delete: deleteMock,
      listSnapshots: listSnapshotsMock,
    };

    const log = await cleanupAfterEvidence({
      evidenceWritten: false,
      sandboxes: [{ sandbox: sandbox as never, role: "agent" }],
      observedSnapshots: [
        {
          snapshotId: "snap_keep",
          sandboxId: "sbx_agent",
          createdAt: "2026-11-18T12:00:00.000Z",
        },
      ],
    });

    expect(deleteMock).not.toHaveBeenCalled();
    expect(stopMock).toHaveBeenCalled();
    expect(log.some((e) => e.kind === "snapshot" && e.skipped)).toBe(true);
    expect(log.some((e) => e.kind === "sandbox" && e.skipped)).toBe(true);
  });

  it("disposes sandboxes with orphan cleanup after evidence write", async () => {
    vi.doMock("@vercel/sandbox", () => ({
      Snapshot: {
        get: vi.fn(),
      },
      Sandbox: class {},
    }));

    const { cleanupAfterEvidence } = await import(
      "../src/lib/sandbox/evidence-cleanup"
    );

    const sandbox = {
      name: "sbx_verify",
      stop: stopMock,
      delete: deleteMock,
      listSnapshots: listSnapshotsMock,
    };

    const log = await cleanupAfterEvidence({
      evidenceWritten: true,
      sandboxes: [{ sandbox: sandbox as never, role: "verify" }],
      observedSnapshots: [],
    });

    expect(deleteMock).toHaveBeenCalledWith({
      deleteOrphanSnapshots: true,
    });
    expect(log.some((e) => e.kind === "sandbox" && e.deleted)).toBe(true);
  });
});

describe("buildEvidencePack direct", () => {
  it("hashes match content bytes", () => {
    const pack = buildEvidencePack({
      receiptId: "x",
      mode: "hidden",
      createdAt: "2026-11-18T00:00:00.000Z",
      verdict: "claim-failed-verification",
      modelConfigured: "anthropic/claude-haiku-4.5",
      claim: {
        submitted: true,
        claimedFixed: true,
        summary: "thought fixed",
        filesChanged: ["src/pricing.ts"],
        testsRun: "pass visible",
        rawText: "{}",
      },
      diffs: [],
      independentTests: {
        passed: false,
        exitCode: 1,
        stdout: "fail",
        stderr: "",
        tests: [],
        summary: { total: 1, passed: 0, failed: 1, skipped: 0 },
      },
      visibleTests: [],
      hiddenTests: [],
      llmSteps: [],
      totals: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costUsd: "0",
        stepsWithCost: 0,
        stepsMissingCost: 0,
      },
      commands: [],
      agentSandboxId: "a",
      verificationSandboxId: "v",
      snapshotsCreated: [],
      cleanupLog: [],
      networkPolicyNotes: [],
      architectureNotes: [],
    });
    expect(verifyEvidencePackIntegrity(pack).ok).toBe(true);
  });
});
