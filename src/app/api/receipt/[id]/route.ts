import { NextResponse } from "next/server";
import { loadReceipt } from "@/lib/receipt/store";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const receipt = await loadReceipt(id);
  if (!receipt) {
    return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
  }
  return NextResponse.json(receipt);
}
