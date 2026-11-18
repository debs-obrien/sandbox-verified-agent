import { notFound } from "next/navigation";
import { ReceiptView } from "@/components/ReceiptView";
import { loadReceipt } from "@/lib/receipt/store";

export const dynamic = "force-dynamic";

export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const receipt = await loadReceipt(id);
  if (!receipt) notFound();
  return (
    <main
      className="min-h-screen"
      style={{
        background:
          "linear-gradient(180deg, #f7f4ef 0%, #f3efe8 40%, #efeae2 100%)",
      }}
    >
      <ReceiptView receipt={receipt} />
    </main>
  );
}
