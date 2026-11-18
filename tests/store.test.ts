import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const putMock = vi.fn();
const getMock = vi.fn();

vi.mock("@vercel/blob", () => ({
  put: (...args: unknown[]) => putMock(...args),
  get: (...args: unknown[]) => getMock(...args),
}));

import type { Receipt } from "../src/lib/types";

function sampleReceipt(id: string): Receipt {
  return {
    id,
    createdAt: "2026-11-17T00:00:00.000Z",
    mode: "normal",
    isSample: false,
    bugReport: "bug",
    modelConfigured: "anthropic/claude-haiku-4.5",
    agentClaim: {
      submitted: true,
      claimedFixed: true,
      summary: "ok",
      filesChanged: ["src/pricing.ts"],
      testsRun: "npm test — pass",
      rawText: "{\"fixed\":true}",
    },
    commands: [],
    llmSteps: [],
    totals: {
      inputTokens: "unavailable",
      outputTokens: "unavailable",
      totalTokens: "unavailable",
      costUsd: "unavailable",
      stepsWithCost: 0,
      stepsMissingCost: 0,
    },
    diffs: [],
    verification: {
      independentTests: {
        passed: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        tests: [],
        summary: { total: 0, passed: 0, failed: 0, skipped: 0 },
      },
      visibleTests: [],
      hiddenTests: [],
      verified: true,
      beforeSnapshotId: "b",
      afterSnapshotId: "a",
      verificationSandboxId: "v",
      method: "pristine-plus-diff",
    },
    verdict: "verified",
    networkPolicyNotes: [],
    architectureNotes: [],
  };
}

describe("receipt store", () => {
  let tmpDir: string;
  let store: typeof import("../src/lib/receipt/store");

  beforeEach(async () => {
    vi.resetModules();
    putMock.mockReset();
    getMock.mockReset();
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "receipt-store-"));
    process.env.BLOB_READ_WRITE_TOKEN = "";
    delete process.env.BLOB_READ_WRITE_TOKEN;
    store = await import("../src/lib/receipt/store");
    store.__test.memory.clear();
    // Point local fallback at tmp by writing through the real LOCAL path when no blob.
  });

  afterEach(async () => {
    store.__test.memory.clear();
    delete process.env.BLOB_READ_WRITE_TOKEN;
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("saves and loads via Blob when BLOB_READ_WRITE_TOKEN is set", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test";
    vi.resetModules();
    store = await import("../src/lib/receipt/store");
    store.__test.memory.clear();

    const receipt = sampleReceipt("blob-receipt-1");
    putMock.mockResolvedValue({ url: "https://blob.example/receipts/blob-receipt-1.json" });

    await store.saveReceipt(receipt);

    expect(putMock).toHaveBeenCalledWith(
      "receipts/blob-receipt-1.json",
      expect.stringContaining('"id": "blob-receipt-1"'),
      expect.objectContaining({
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: true,
      }),
    );

    // Clear memory so load must hit Blob.
    store.__test.memory.clear();
    const body = JSON.stringify(receipt);
    getMock.mockResolvedValue({
      statusCode: 200,
      stream: new Response(body).body,
      headers: new Headers(),
      blob: {
        url: "https://blob.example/x",
        downloadUrl: "https://blob.example/x",
        pathname: "receipts/blob-receipt-1.json",
        contentDisposition: "",
        cacheControl: "",
        uploadedAt: new Date(),
        etag: "e",
        contentType: "application/json",
        size: body.length,
      },
    });

    const loaded = await store.loadReceipt("blob-receipt-1");
    expect(loaded?.id).toBe("blob-receipt-1");
    expect(loaded?.verdict).toBe("verified");
    expect(getMock).toHaveBeenCalledWith(
      "receipts/blob-receipt-1.json",
      expect.objectContaining({ access: "private" }),
    );
  });

  it("persists a Caught (claim-failed-verification) receipt via Blob", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test";
    vi.resetModules();
    store = await import("../src/lib/receipt/store");
    store.__test.memory.clear();

    const receipt = sampleReceipt("blob-caught-1");
    receipt.mode = "hidden";
    receipt.verdict = "claim-failed-verification";
    receipt.verification.verified = false;
    receipt.verification.hiddenTests = [
      {
        name: "discounts each qualifying SKU line independently",
        fullName:
          "cartTotalCents (hidden) discounts each qualifying SKU line independently",
        status: "failed",
        durationMs: 3,
        errorMessage: "expected 14580 to be 14700",
        heldOut: true,
      },
    ];
    receipt.verification.independentTests.passed = false;
    receipt.verification.independentTests.exitCode = 1;
    receipt.verification.independentTests.stdout =
      "FAIL cartTotalCents (hidden) > discounts each qualifying SKU line independently";
    receipt.hiddenTestSource =
      'describe("cartTotalCents (hidden)", () => { /* held-out */ });';

    putMock.mockResolvedValue({
      url: "https://blob.example/receipts/blob-caught-1.json",
    });
    await store.saveReceipt(receipt);

    store.__test.memory.clear();
    const body = JSON.stringify(receipt);
    getMock.mockResolvedValue({
      statusCode: 200,
      stream: new Response(body).body,
      headers: new Headers(),
      blob: {
        url: "https://blob.example/x",
        downloadUrl: "https://blob.example/x",
        pathname: "receipts/blob-caught-1.json",
        contentDisposition: "",
        cacheControl: "",
        uploadedAt: new Date(),
        etag: "e",
        contentType: "application/json",
        size: body.length,
      },
    });

    const loaded = await store.loadReceipt("blob-caught-1");
    expect(loaded?.verdict).toBe("claim-failed-verification");
    expect(loaded?.agentClaim.claimedFixed).toBe(true);
    expect(loaded?.verification.verified).toBe(false);
    expect(loaded?.verification.hiddenTests[0]?.status).toBe("failed");
    expect(loaded?.hiddenTestSource).toContain("cartTotalCents (hidden)");
  });

  it("falls back to local filesystem when Blob token is unset", async () => {
    const receipt = sampleReceipt("local-receipt-1");
    await store.saveReceipt(receipt);

    // Memory hit
    expect((await store.loadReceipt("local-receipt-1"))?.id).toBe(
      "local-receipt-1",
    );

    // Disk hit after clearing memory
    store.__test.memory.clear();
    const disk = await readFile(
      path.join(store.__test.LOCAL_DATA_DIR, "local-receipt-1.json"),
      "utf8",
    );
    expect(JSON.parse(disk).id).toBe("local-receipt-1");
  });

  it("loads checked-in sample receipts as a last resort", async () => {
    store.__test.memory.clear();
    const sample = await store.loadReceipt("sample-verified");
    expect(sample?.isSample).toBe(true);
    expect(sample?.verdict).toBe("verified");

    const hidden = await store.loadReceipt("sample-hidden");
    expect(hidden?.mode).toBe("hidden");
    expect(hidden?.verdict).toBe("claim-failed-verification");
  });

  it("rejects unsafe receipt ids", async () => {
    await expect(
      store.saveReceipt(sampleReceipt("../evil")),
    ).rejects.toThrow(/Invalid receipt id/);
  });
});
