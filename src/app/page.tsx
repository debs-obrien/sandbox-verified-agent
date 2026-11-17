import Link from "next/link";
import { RunControls } from "@/components/RunControls";

export default function HomePage() {
  return (
    <main className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(1200px 600px at 10% -10%, #d8efe6 0%, transparent 55%), radial-gradient(900px 500px at 90% 0%, #f3e6d8 0%, transparent 50%), linear-gradient(180deg, #f7f4ef 0%, #efeae2 100%)",
        }}
      />
      <div className="mx-auto max-w-4xl px-5 py-16 md:py-24 space-y-10">
        <p className="text-sm uppercase tracking-[0.2em] text-[var(--muted)]">
          Vercel DevRel demo · sandbox-verified-agent
        </p>
        <h1 className="font-[family-name:var(--font-display)] text-5xl md:text-6xl leading-[1.02] tracking-tight text-[var(--ink)] max-w-3xl">
          Agents that show their work
        </h1>
        <p className="text-xl text-[var(--ink)]/80 max-w-2xl leading-relaxed">
          A green chat message isn&apos;t evidence. This template runs a coding
          agent against a real failing Vitest suite inside Vercel Sandbox, then
          restores a snapshot into a fresh sandbox and re-runs the tests —
          producing a receipt with commands, diff, cost, and verification.
        </p>

        <RunControls />

        <div className="flex flex-wrap gap-4 text-sm pt-4">
          <Link
            className="underline underline-offset-4 text-[var(--ink)]"
            href="/receipt/sample-verified"
          >
            Sample receipt · verified
          </Link>
          <Link
            className="underline underline-offset-4 text-[var(--ink)]"
            href="/receipt/sample-caught"
          >
            Sample receipt · caught-it
          </Link>
          <a
            className="underline underline-offset-4 text-[var(--muted)]"
            href="https://github.com/debs-obrien/sandbox-verified-agent"
          >
            GitHub
          </a>
        </div>
      </div>
    </main>
  );
}
