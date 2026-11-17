import { NextResponse } from "next/server";
import { runVerifiedAgent } from "@/lib/agent/run";
import type { DemoMode } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 800;

export async function POST(request: Request) {
  let body: { mode?: string; model?: string } = {};
  try {
    body = (await request.json()) as { mode?: string; model?: string };
  } catch {
    body = {};
  }

  const mode: DemoMode = body.mode === "caught" ? "caught" : "normal";

  const receipt = await runVerifiedAgent({
    mode,
    model: body.model,
  });

  return NextResponse.json(receipt);
}
