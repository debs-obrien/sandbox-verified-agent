/**
 * Runtime configuration.
 * Model default is a live Gateway catalog id:
 * anthropic/claude-haiku-4.5 — cheap, tool-calling capable.
 * Override with AI_GATEWAY_MODEL.
 */
export const DEFAULT_MODEL =
  process.env.AI_GATEWAY_MODEL ?? "anthropic/claude-haiku-4.5";

/**
 * Preferred sandbox workspace root. The universal image may not ship this
 * directory — we mkdir -p it after create and fall back to sandbox.cwd.
 */
export const PREFERRED_SANDBOX_ROOT = "/vercel/sandbox";

/** Fixture directory name under the sandbox root. */
export const FIXTURE_DIRNAME = "buggy-pricing";

/** Truncate command stdout/stderr in the receipt. */
export const LOG_TRUNCATE_CHARS = 4_000;

/** Max agent steps (kept modest for Hobby 300s). Same for normal + hidden. */
export const NORMAL_MAX_STEPS = 8;

/**
 * Hobby plan function maxDuration is 300s. Keep the sandbox session under
 * that so create → install → agent → snapshots → verify can finish.
 */
export const FUNCTION_MAX_DURATION_S = 300;
export const SANDBOX_TIMEOUT_MS = 270_000; // 4.5 minutes

/**
 * Sandbox snapshot expiration: API accepts 0 (never) or >= 1 day.
 * Demo receipts use 1 day.
 */
export const SNAPSHOT_EXPIRATION_MS = 24 * 60 * 60 * 1000;

export function getSandboxCredentials():
  | { token: string; teamId: string; projectId: string }
  | undefined {
  const token = process.env.VERCEL_TOKEN;
  const teamId = process.env.VERCEL_TEAM_ID;
  const projectId = process.env.VERCEL_PROJECT_ID;
  if (token && teamId && projectId) {
    return { token, teamId, projectId };
  }
  return undefined;
}

export function fixtureRoot(sandboxRoot: string): string {
  return `${sandboxRoot.replace(/\/$/, "")}/${FIXTURE_DIRNAME}`;
}

export function hasBlobToken(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}
