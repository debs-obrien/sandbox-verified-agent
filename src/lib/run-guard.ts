import { DEFAULT_MODEL } from "./config";

/**
 * Protect /api/run from anonymous unpaid sandbox/Gateway burn.
 *
 * - If RUN_SECRET is set, require matching `x-run-secret` header (or Authorization Bearer).
 * - In production (VERCEL=1 / NODE_ENV=production), refuse to start when RUN_SECRET is unset
 *   unless ALLOW_PUBLIC_RUNS=true (explicit demo override — not recommended).
 * - Ignore client-supplied model ids; always use server DEFAULT_MODEL / AI_GATEWAY_MODEL.
 * - Simple in-memory concurrency + hourly rate limit per process.
 */

const MAX_CONCURRENT = Number(process.env.RUN_MAX_CONCURRENT ?? "1");
const MAX_PER_HOUR = Number(process.env.RUN_MAX_PER_HOUR ?? "6");

let inFlight = 0;
const recentStarts: number[] = [];

export type GuardFailure = {
  status: number;
  error: string;
};

export function assertRunAuthorized(request: Request): GuardFailure | null {
  const secret = process.env.RUN_SECRET?.trim();
  const allowPublic = process.env.ALLOW_PUBLIC_RUNS === "true";
  const onVercel = process.env.VERCEL === "1";
  const isProd = process.env.NODE_ENV === "production" || onVercel;

  if (secret) {
    const header =
      request.headers.get("x-run-secret") ??
      request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (header !== secret) {
      return {
        status: 401,
        error:
          "Unauthorized. Provide x-run-secret (or Authorization: Bearer) matching RUN_SECRET.",
      };
    }
  } else if (isProd && !allowPublic) {
    return {
      status: 403,
      error:
        "Refusing public runs: set RUN_SECRET (recommended) or ALLOW_PUBLIC_RUNS=true, and enable Vercel Deployment Protection.",
    };
  }

  // Prune hourly window
  const hourAgo = Date.now() - 60 * 60_000;
  while (recentStarts.length && recentStarts[0]! < hourAgo) {
    recentStarts.shift();
  }

  if (inFlight >= MAX_CONCURRENT) {
    return {
      status: 429,
      error: `Too many concurrent runs (max ${MAX_CONCURRENT}).`,
    };
  }
  if (recentStarts.length >= MAX_PER_HOUR) {
    return {
      status: 429,
      error: `Hourly run limit reached (max ${MAX_PER_HOUR}/hour on this instance).`,
    };
  }

  return null;
}

export function beginRunSlot(): void {
  inFlight += 1;
  recentStarts.push(Date.now());
}

export function endRunSlot(): void {
  inFlight = Math.max(0, inFlight - 1);
}

/** Client model overrides are ignored — always use server config. */
export function resolveRunModel(_requested?: string): string {
  return DEFAULT_MODEL;
}
