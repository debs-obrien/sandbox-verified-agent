"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { DemoMode } from "@/lib/types";
import {
  clearPresenterRunSecret,
  readPresenterRunSecret,
  writePresenterRunSecret,
} from "@/lib/presenter-secret";

export function RunControls() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [secretDraft, setSecretDraft] = useState("");
  const [secretSaved, setSecretSaved] = useState(false);

  useEffect(() => {
    const existing = readPresenterRunSecret();
    setSecretSaved(Boolean(existing));
  }, []);

  function saveSecret() {
    writePresenterRunSecret(secretDraft);
    const saved = Boolean(readPresenterRunSecret());
    setSecretSaved(saved);
    setSecretDraft("");
    setError(null);
    setStatus(
      saved
        ? "Run secret saved for this tab session only (sessionStorage)."
        : "Run secret cleared.",
    );
  }

  function clearSecret() {
    clearPresenterRunSecret();
    setSecretSaved(false);
    setSecretDraft("");
    setStatus("Run secret cleared from this tab.");
  }

  function run(mode: DemoMode) {
    setError(null);
    setStatus(
      mode === "hidden"
        ? "Starting hidden-tests run (agent sees visible tests only)…"
        : "Starting normal run (agent sees full suite)…",
    );
    startTransition(async () => {
      try {
        const secret = readPresenterRunSecret();
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (secret) {
          headers["x-run-secret"] = secret;
        }
        const res = await fetch("/api/run", {
          method: "POST",
          headers,
          body: JSON.stringify({ mode }),
        });
        const data = await res.json();
        if (!res.ok) {
          const message = data?.error ?? `HTTP ${res.status}`;
          setError(
            res.status === 401
              ? `${message}\nPaste the presenter run secret above (matches RUN_SECRET), save, then click again.`
              : message,
          );
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
      <div className="rounded-md border border-[var(--line)] bg-[var(--panel)] p-4 space-y-3 max-w-xl">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-[var(--ink)]">
            Presenter run secret
          </p>
          {secretSaved ? (
            <span className="text-xs uppercase tracking-wide text-[var(--pass)]">
              saved for this tab
            </span>
          ) : (
            <span className="text-xs uppercase tracking-wide text-[var(--muted)]">
              not set
            </span>
          )}
        </div>
        <p className="text-sm text-[var(--muted)] leading-relaxed">
          On a protected preview, viewers use a Shareable Link. The presenter
          pastes <code className="font-mono">RUN_SECRET</code> once here — it
          stays in <code className="font-mono">sessionStorage</code> for this
          tab only and is sent as{" "}
          <code className="font-mono">x-run-secret</code>. It is never embedded
          in the page or shipped to anonymous viewers. Rate limits still apply.
        </p>
        <div className="flex flex-wrap gap-2 items-center">
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={secretDraft}
            onChange={(e) => setSecretDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                saveSecret();
              }
            }}
            placeholder={
              secretSaved ? "•••••••• (enter to replace)" : "Paste RUN_SECRET"
            }
            className="min-w-[14rem] flex-1 rounded-md border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm font-mono text-[var(--ink)]"
          />
          <button
            type="button"
            onClick={saveSecret}
            className="rounded-md border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm font-semibold text-[var(--ink)] hover:opacity-90"
          >
            Save
          </button>
          {secretSaved && (
            <button
              type="button"
              onClick={clearSecret}
              className="rounded-md px-3 py-2 text-sm text-[var(--muted)] underline underline-offset-2"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() => run("normal")}
          className="rounded-md bg-[var(--ink)] text-[var(--paper)] px-5 py-3 text-base font-semibold disabled:opacity-50 hover:opacity-90 transition"
        >
          Run normal (full suite)
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => run("hidden")}
          className="rounded-md border-2 border-[var(--fail)] text-[var(--fail)] px-5 py-3 text-base font-semibold disabled:opacity-50 hover:bg-[var(--fail-bg)] transition"
        >
          Run hidden-tests demo
        </button>
      </div>
      {status && (
        <p className="text-sm text-[var(--muted)] animate-pulse">{status}</p>
      )}
      {error && (
        <p className="text-sm text-[var(--fail)] whitespace-pre-wrap">{error}</p>
      )}
      <p className="text-sm text-[var(--muted)] max-w-xl">
        Live runs need Sandbox + AI Gateway auth (OIDC header on Vercel, or
        env locally) and a connected Blob store for durable receipts. Prefer{" "}
        <code className="font-mono">RUN_SECRET</code> + Deployment Protection;
        optional <code className="font-mono">ALLOW_PUBLIC_RUNS=true</code> only
        when the secret is unset. Sample receipts below work offline.
      </p>
    </div>
  );
}
