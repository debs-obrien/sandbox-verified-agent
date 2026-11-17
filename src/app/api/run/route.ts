import { NextResponse } from "next/server";
import { runVerifiedAgent } from "@/lib/agent/run";
import {
  assertRunAuthorized,
  beginRunSlot,
  endRunSlot,
  resolveRunModel,
} from "@/lib/run-guard";
import type { DemoMode } from "@/lib/types";

export const runtime = "nodejs";
/** Hobby plan caps at 300s — keep SANDBOX_TIMEOUT_MS under this. */
export const maxDuration = 300;

export async function POST(request: Request) {
  // OIDC header (x-vercel-oidc-token) is only available inside this request.
  const denied = assertRunAuthorized(request);
  if (denied) {
    return NextResponse.json({ error: denied.error }, { status: denied.status });
  }

  let body: { mode?: string; model?: string } = {};
  try {
    body = (await request.json()) as { mode?: string; model?: string };
  } catch {
    body = {};
  }

  const mode: DemoMode = body.mode === "caught" ? "caught" : "normal";
  const model = resolveRunModel(body.model);

  beginRunSlot();
  try {
    const receipt = await runVerifiedAgent({ mode, model });
    return NextResponse.json(receipt);
  } finally {
    endRunSlot();
  }
}
