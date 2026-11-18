import { NextResponse } from "next/server";
import { loadEvidencePack, loadReceipt } from "@/lib/receipt/store";
import { buildEvidencePackFromReceipt } from "@/lib/receipt/evidence";

export const runtime = "nodejs";

/**
 * Download the evidence pack for a receipt.
 * Prefers the durable Blob pack; falls back to rebuilding from the receipt
 * (samples / older receipts without a stored pack).
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  let pack = await loadEvidencePack(id);
  if (!pack) {
    const receipt = await loadReceipt(id);
    if (!receipt) {
      return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
    }
    pack = buildEvidencePackFromReceipt(receipt);
  }

  const body = JSON.stringify(pack, null, 2);
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${id}.evidence.json"`,
      "Cache-Control": "no-store",
    },
  });
}
