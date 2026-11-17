/**
 * Runtime configuration.
 * Model default is a live Gateway catalog id (fetched 2026-11-17):
 * anthropic/claude-haiku-4.5 — cheap, tool-calling capable.
 * Override with AI_GATEWAY_MODEL.
 */
export const DEFAULT_MODEL =
  process.env.AI_GATEWAY_MODEL ?? "anthropic/claude-haiku-4.5";

export const WORKSPACE_ROOT = "/vercel/sandbox/buggy-pricing";

/** Truncate command stdout/stderr in the receipt. */
export const LOG_TRUNCATE_CHARS = 4_000;

/** Max agent steps in normal mode. */
export const NORMAL_MAX_STEPS = 12;

/**
 * Caught-it mode: deliberately tiny step budget so the agent cannot
 * complete a real fix+test cycle before it is forced to stop.
 */
export const CAUGHT_MAX_STEPS = 2;

export const SANDBOX_TIMEOUT_MS = 10 * 60_000;

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

export function hasAiGatewayAuth(): boolean {
  return Boolean(
    process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN,
  );
}

export function missingCredentials(): string[] {
  const missing: string[] = [];
  if (!hasAiGatewayAuth()) {
    missing.push(
      "AI_GATEWAY_API_KEY (or VERCEL_OIDC_TOKEN via `vercel link` + `vercel env pull`)",
    );
  }
  // Sandbox on Vercel uses OIDC automatically; locally needs OIDC or token trio.
  if (
    !process.env.VERCEL_OIDC_TOKEN &&
    !(
      process.env.VERCEL_TOKEN &&
      process.env.VERCEL_TEAM_ID &&
      process.env.VERCEL_PROJECT_ID
    )
  ) {
    missing.push(
      "Sandbox auth: VERCEL_OIDC_TOKEN (preferred) OR VERCEL_TOKEN + VERCEL_TEAM_ID + VERCEL_PROJECT_ID",
    );
  }
  return missing;
}
