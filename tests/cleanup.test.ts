import { afterEach, describe, expect, it, vi } from "vitest";
import { decideVerdict } from "../src/lib/receipt/totals";

const getMock = vi.fn();
const deleteMock = vi.fn();
const sandboxDeleteMock = vi.fn();
const sandboxStopMock = vi.fn();

vi.mock("@vercel/sandbox", () => ({
  Snapshot: {
    get: (...args: unknown[]) => getMock(...args),
  },
  Sandbox: class {},
}));

describe("snapshot / sandbox cleanup", () => {
  afterEach(() => {
    getMock.mockReset();
    deleteMock.mockReset();
    sandboxDeleteMock.mockReset();
    sandboxStopMock.mockReset();
    vi.resetModules();
  });

  it("deleteSnapshotQuietly deletes via Snapshot.get + delete", async () => {
    deleteMock.mockResolvedValue(undefined);
    getMock.mockResolvedValue({ delete: deleteMock, snapshotId: "snap_1" });

    const { deleteSnapshotQuietly } = await import(
      "../src/lib/sandbox/cleanup"
    );
    const result = await deleteSnapshotQuietly("snap_1");
    expect(result.deleted).toBe(true);
    expect(getMock).toHaveBeenCalledWith(
      expect.objectContaining({ snapshotId: "snap_1" }),
    );
    expect(deleteMock).toHaveBeenCalled();
  });

  it("deleteSnapshotQuietly skips unavailable / empty ids", async () => {
    const { deleteSnapshotQuietly } = await import(
      "../src/lib/sandbox/cleanup"
    );
    expect(await deleteSnapshotQuietly("unavailable")).toEqual({
      deleted: false,
    });
    expect(await deleteSnapshotQuietly(null)).toEqual({ deleted: false });
    expect(getMock).not.toHaveBeenCalled();
  });

  it("deleteSnapshotQuietly swallows API errors", async () => {
    getMock.mockRejectedValue(new Error("not found"));
    const { deleteSnapshotQuietly } = await import(
      "../src/lib/sandbox/cleanup"
    );
    const result = await deleteSnapshotQuietly("snap_missing");
    expect(result.deleted).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("deleteSnapshotsQuietly counts attempts and deletes", async () => {
    deleteMock.mockResolvedValue(undefined);
    getMock
      .mockResolvedValueOnce({ delete: deleteMock })
      .mockRejectedValueOnce(new Error("gone"));

    const { deleteSnapshotsQuietly } = await import(
      "../src/lib/sandbox/cleanup"
    );
    const result = await deleteSnapshotsQuietly([
      "snap_a",
      "unavailable",
      "snap_b",
      null,
    ]);
    expect(result.attempted).toBe(2);
    expect(result.deleted).toBe(1);
  });

  it("disposeSandboxQuietly prefers delete with orphan snapshot cleanup", async () => {
    sandboxDeleteMock.mockResolvedValue(undefined);
    const fake = {
      delete: sandboxDeleteMock,
      stop: sandboxStopMock,
    };

    const { disposeSandboxQuietly } = await import(
      "../src/lib/sandbox/cleanup"
    );
    const result = await disposeSandboxQuietly(fake as never);
    expect(result.disposed).toBe(true);
    expect(sandboxDeleteMock).toHaveBeenCalledWith({
      deleteOrphanSnapshots: true,
    });
    expect(sandboxStopMock).not.toHaveBeenCalled();
  });

  it("disposeSandboxQuietly falls back to stop when delete fails", async () => {
    sandboxDeleteMock.mockRejectedValue(new Error("delete blocked"));
    sandboxStopMock.mockResolvedValue(undefined);
    const fake = {
      delete: sandboxDeleteMock,
      stop: sandboxStopMock,
    };

    const { disposeSandboxQuietly } = await import(
      "../src/lib/sandbox/cleanup"
    );
    const result = await disposeSandboxQuietly(fake as never);
    expect(result.disposed).toBe(true);
    expect(sandboxStopMock).toHaveBeenCalled();
  });

  it("cleanup failures never change decideVerdict", async () => {
    getMock.mockRejectedValue(new Error("boom"));
    const { deleteSnapshotQuietly } = await import(
      "../src/lib/sandbox/cleanup"
    );
    await deleteSnapshotQuietly("snap_x");

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
        claimedFixed: true,
        verified: false,
      }),
    ).toBe("claim-failed-verification");
  });
});
