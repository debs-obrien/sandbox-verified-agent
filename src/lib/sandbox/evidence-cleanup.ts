import type { Sandbox } from "@vercel/sandbox";
import type { SnapshotCleanupEntry } from "../types";
import { deleteSnapshotQuietly, disposeSandboxQuietly } from "./cleanup";

export type ObservedSnapshot = {
  snapshotId: string;
  sandboxId: string;
  createdAt?: string;
  sizeBytes?: number;
};

/**
 * List snapshots attached to a sandbox (best-effort). Demo runs normally
 * create none; we still record anything present before dispose.
 */
export async function listSandboxSnapshotsQuietly(
  sandbox: Sandbox | null | undefined,
): Promise<ObservedSnapshot[]> {
  if (!sandbox) return [];
  try {
    const page = await sandbox.listSnapshots({ limit: 50, sortOrder: "desc" });
    const sandboxId = sandbox.name;
    return (page.snapshots ?? []).map((s) => ({
      snapshotId: s.id,
      sandboxId,
      createdAt: s.createdAt
        ? new Date(s.createdAt).toISOString()
        : undefined,
      sizeBytes: s.sizeBytes,
    }));
  } catch (err) {
    console.warn(
      "listSnapshots failed:",
      err instanceof Error ? err.message : String(err),
    );
    return [];
  }
}

/**
 * After the evidence pack is successfully written: delete orphan snapshots
 * (if any) then dispose sandboxes. Records a cleanup log.
 *
 * If `evidenceWritten` is false, do NOT delete snapshots/orphans — stop the
 * sandbox session only so Hobby storage is not silently wiped while proof
 * failed to persist. Documented in README.
 */
export async function cleanupAfterEvidence(args: {
  evidenceWritten: boolean;
  sandboxes: Array<{
    sandbox: Sandbox | null | undefined;
    role: "agent" | "verify";
  }>;
  observedSnapshots: ObservedSnapshot[];
}): Promise<SnapshotCleanupEntry[]> {
  const log: SnapshotCleanupEntry[] = [];
  const now = () => new Date().toISOString();

  if (!args.evidenceWritten) {
    for (const snap of args.observedSnapshots) {
      log.push({
        kind: "snapshot",
        id: snap.snapshotId,
        sandboxId: snap.sandboxId,
        createdAt: snap.createdAt,
        deletedAt: null,
        deleted: false,
        skipped: true,
        note: "Skipped delete: evidence pack was not written successfully.",
      });
    }
    for (const { sandbox, role } of args.sandboxes) {
      if (!sandbox) continue;
      // Stop without deleting orphan snapshots — preserve storage until pack exists.
      try {
        await sandbox.stop();
        log.push({
          kind: "sandbox",
          id: sandbox.name,
          sandboxId: sandbox.name,
          deletedAt: now(),
          deleted: false,
          skipped: true,
          note: `Stopped ${role} sandbox without deleteOrphanSnapshots (evidence pack write failed).`,
        });
      } catch (err) {
        log.push({
          kind: "sandbox",
          id: sandbox.name,
          deletedAt: null,
          deleted: false,
          skipped: true,
          error: err instanceof Error ? err.message : String(err),
          note: `Failed to stop ${role} sandbox after evidence write failure.`,
        });
      }
    }
    return log;
  }

  // Explicit snapshot deletes first (audit), then sandbox delete+orphans.
  for (const snap of args.observedSnapshots) {
    const result = await deleteSnapshotQuietly(snap.snapshotId);
    log.push({
      kind: "snapshot",
      id: snap.snapshotId,
      sandboxId: snap.sandboxId,
      createdAt: snap.createdAt,
      deletedAt: result.deleted ? now() : null,
      deleted: result.deleted,
      error: result.error,
      note: result.deleted
        ? "Deleted after evidence pack write."
        : "Delete attempted after evidence pack write.",
    });
  }

  for (const { sandbox, role } of args.sandboxes) {
    if (!sandbox) continue;
    const id = sandbox.name;
    const result = await disposeSandboxQuietly(sandbox, {
      deleteOrphanSnapshots: true,
    });
    log.push({
      kind: "sandbox",
      id,
      sandboxId: id,
      deletedAt: result.disposed ? now() : null,
      deleted: result.disposed,
      error: result.error,
      note: result.disposed
        ? `Disposed ${role} sandbox (deleteOrphanSnapshots) after evidence pack write.`
        : `Failed to dispose ${role} sandbox.`,
    });
  }

  return log;
}
