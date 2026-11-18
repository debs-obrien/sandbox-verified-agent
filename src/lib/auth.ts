import { getVercelOidcToken } from "@vercel/oidc";

/**
 * Resolve Vercel OIDC the official way.
 *
 * On Vercel Functions the token arrives as the `x-vercel-oidc-token` request
 * header (via AsyncLocalStorage request context). Locally it comes from
 * `VERCEL_OIDC_TOKEN` after `vercel env pull`.
 *
 * Both `@vercel/sandbox` and `@ai-sdk/gateway` call `getVercelOidcToken()`
 * themselves — this helper is for our preflight check so we don't hard-fail
 * when only the header is present (env var absent).
 *
 * Must be called inside a request handler so the header context exists.
 */
export async function resolveOidcToken(): Promise<string | null> {
  try {
    const token = await getVercelOidcToken();
    return token || null;
  } catch {
    return process.env.VERCEL_OIDC_TOKEN?.trim() || null;
  }
}

export type AuthStatus = {
  oidcToken: string | null;
  hasAiGatewayAuth: boolean;
  hasSandboxAuth: boolean;
  missing: string[];
};

export async function resolveAuthStatus(): Promise<AuthStatus> {
  const oidcToken = await resolveOidcToken();
  const hasApiKey = Boolean(process.env.AI_GATEWAY_API_KEY?.trim());
  const hasTokenTrio = Boolean(
    process.env.VERCEL_TOKEN?.trim() &&
      process.env.VERCEL_TEAM_ID?.trim() &&
      process.env.VERCEL_PROJECT_ID?.trim(),
  );

  const hasAiGatewayAuth = hasApiKey || Boolean(oidcToken);
  const hasSandboxAuth = Boolean(oidcToken) || hasTokenTrio;

  const missing: string[] = [];
  if (!hasAiGatewayAuth) {
    missing.push(
      "AI Gateway: AI_GATEWAY_API_KEY, or OIDC via getVercelOidcToken() (x-vercel-oidc-token header on Vercel / VERCEL_OIDC_TOKEN from `vercel env pull` locally)",
    );
  }
  if (!hasSandboxAuth) {
    missing.push(
      "Sandbox: OIDC via getVercelOidcToken() (preferred), or VERCEL_TOKEN + VERCEL_TEAM_ID + VERCEL_PROJECT_ID",
    );
  }

  return { oidcToken, hasAiGatewayAuth, hasSandboxAuth, missing };
}
