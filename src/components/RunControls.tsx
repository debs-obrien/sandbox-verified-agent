"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { DemoMode } from "@/lib/types";

export function RunControls() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  function run(mode: DemoMode) {
    setError(null);
    setStatus(
      mode === "caught"
        ? "Starting caught-it run (agent will claim success early)…"
        : "Starting normal run (agent should fix and verify)…",
    );
    startTransition(async () => {
      try {
        const res = await fetch("/api/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data?.error ?? `HTTP ${res.status}`);
          setStatus(null);
          return;
        }
        setStatus(`Receipt ${data.id} ready — opening…`);
        router.push(`/receipt/${data.id}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStatus(null);
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() => run("normal")}
          className="rounded-md bg-[var(--ink)] text-[var(--paper)] px-5 py-3 text-base font-semibold disabled:opacity-50 hover:opacity-90 transition"
        >
          Run normal (real fix)
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => run("caught")}
          className="rounded-md border-2 border-[var(--fail)] text-[var(--fail)] px-5 py-3 text-base font-semibold disabled:opacity-50 hover:bg-[var(--fail-bg)] transition"
        >
          Run caught-it demo
        </button>
      </div>
      {status && (
        <p className="text-sm text-[var(--muted)] animate-pulse">{status}</p>
      )}
      {error && (
        <p className="text-sm text-[var(--fail)] whitespace-pre-wrap">{error}</p>
      )}
      <p className="text-sm text-[var(--muted)] max-w-xl">
        Live runs need Sandbox + AI Gateway credentials. Deployed demos should
        set <code className="font-mono">RUN_SECRET</code> (or enable Vercel
        Deployment Protection with{" "}
        <code className="font-mono">ALLOW_PUBLIC_RUNS=true</code>) so anonymous
        callers cannot burn paid Sandbox/Gateway usage. Sample receipts below
        work offline.
      </p>
    </div>
  );
}
