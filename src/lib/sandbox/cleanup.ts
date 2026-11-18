import { Sandbox, Snapshot } from "@vercel/sandbox";
import { getSandboxCredentials } from "../config";

/**
 * Best-effort snapshot deletion. Never throws — cleanup must not affect
 * receipt verdicts or run success.
 */
export async function deleteSnapshotQuietly(
  snapshotId: string | null | undefined,
): Promise<{ deleted: boolean; error?: string }> {
  if (!snapshotId || snapshotId === "unavailable") {
    return { deleted: false };
  }
  try {
    const creds = getSandboxCredentials();
    const snap = await Snapshot.get({
      snapshotId,
      ...(creds
        ? { token: creds.token, teamId: creds.teamId, projectId: creds.projectId }
        : {}),
    });
    await snap.delete();
    return { deleted: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.warn("Snapshot cleanup failed:", snapshotId, error);
    return { deleted: false, error };
  }
}

/**
 * Stop or delete a sandbox without throwing.
 * Prefer delete+orphan snapshot cleanup when the session is finished.
 */
export async function disposeSandboxQuietly(
  sandbox: Sandbox | null | undefined,
  opts?: { deleteOrphanSnapshots?: boolean },
): Promise<{ disposed: boolean; error?: string }> {
  if (!sandbox) return { disposed: false };
  const deleteOrphans = opts?.deleteOrphanSnapshots ?? true;
  try {
    await sandbox.delete({ deleteOrphanSnapshots: deleteOrphans });
    return { disposed: true };
  } catch (err) {
    try {
      await sandbox.stop();
      return { disposed: true };
    } catch (err2) {
      const error = err2 instanceof Error ? err2.message : String(err2);
      console.warn("Sandbox dispose failed:", error);
      return { disposed: false, error };
    }
  }
}

/**
 * Delete many snapshot ids; always resolves; never throws.
 */
export async function deleteSnapshotsQuietly(
  ids: Array<string | null | undefined>,
): Promise<{ attempted: number; deleted: number }> {
  let deleted = 0;
  let attempted = 0;
  for (const id of ids) {
    if (!id || id === "unavailable") continue;
    attempted += 1;
    const result = await deleteSnapshotQuietly(id);
    if (result.deleted) deleted += 1;
  }
  return { attempted, deleted };
}
