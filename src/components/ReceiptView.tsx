import type { ReactNode } from "react";
import type { Receipt } from "@/lib/types";

function Badge({
  tone,
  children,
}: {
  tone: "pass" | "fail" | "neutral" | "warn";
  children: ReactNode;
}) {
  const styles = {
    pass: "bg-[var(--pass-bg)] text-[var(--pass)] border-[var(--pass)]",
    fail: "bg-[var(--fail-bg)] text-[var(--fail)] border-[var(--fail)]",
    warn: "bg-[var(--warn-bg)] text-[var(--warn)] border-[var(--warn)]",
    neutral: "bg-[var(--ink-soft)] text-[var(--ink)] border-[var(--line)]",
  }[tone];
  return (
    <span
      className={`inline-flex items-center rounded-md border px-3 py-1 text-sm font-semibold tracking-wide ${styles}`}
    >
      {children}
    </span>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-[var(--line)] pt-8 mt-8">
      <h2 className="font-[family-name:var(--font-display)] text-2xl md:text-3xl tracking-tight text-[var(--ink)] mb-4">
        {title}
      </h2>
      {children}
    </section>
  );
}

function formatTokens(v: number | "unavailable"): string {
  return v === "unavailable" ? "unavailable" : v.toLocaleString();
}

export function ReceiptView({ receipt }: { receipt: Receipt }) {
  const verdictTone =
    receipt.verdict === "verified"
      ? "pass"
      : receipt.verdict === "claim-failed-verification"
        ? "fail"
        : receipt.verdict === "error"
          ? "warn"
          : "neutral";

  const verdictLabel =
    receipt.verdict === "verified"
      ? "Verified — independent re-run passed"
      : receipt.verdict === "claim-failed-verification"
        ? "Agent claimed fixed — verification failed"
        : receipt.verdict === "error"
          ? "Run error"
          : "Not fixed";

  return (
    <article className="mx-auto max-w-4xl px-5 py-10 md:py-14">
      {receipt.isSample && (
        <div className="mb-6 rounded-md border border-[var(--warn)] bg-[var(--warn-bg)] px-4 py-3 text-[var(--warn)] text-sm font-medium">
          SAMPLE DATA — not a live Sandbox/Gateway run. Used for UI and unit
          tests only.
          {receipt.sampleLabel ? ` (${receipt.sampleLabel})` : null}
        </div>
      )}

      <header className="space-y-4">
        <p className="text-sm uppercase tracking-[0.18em] text-[var(--muted)]">
          Sandbox Verified Agent · Receipt
        </p>
        <h1 className="font-[family-name:var(--font-display)] text-4xl md:text-5xl leading-[1.05] text-[var(--ink)]">
          Did the agent really fix it?
        </h1>
        <div className="flex flex-wrap gap-2 items-center">
          <Badge tone={verdictTone}>{verdictLabel}</Badge>
          <Badge tone="neutral">
            mode: {receipt.mode === "caught" ? "caught-it" : "normal"}
          </Badge>
          <Badge tone="neutral">model: {receipt.modelConfigured}</Badge>
        </div>
        <p className="text-[var(--muted)] text-sm">
          Receipt <code className="font-mono">{receipt.id}</code> ·{" "}
          {new Date(receipt.createdAt).toLocaleString()}
        </p>
        <a
          className="inline-flex items-center rounded-md bg-[var(--ink)] text-[var(--paper)] px-4 py-2 text-sm font-semibold hover:opacity-90 transition"
          href={`/api/receipt/${receipt.id}`}
          download={`${receipt.id}.json`}
        >
          Download JSON
        </a>
      </header>

      {receipt.errorMessage && (
        <Section title="Error">
          <pre className="whitespace-pre-wrap rounded-md bg-[var(--panel)] border border-[var(--line)] p-4 text-sm text-[var(--fail)] font-mono">
            {receipt.errorMessage}
          </pre>
        </Section>
      )}

      <Section title="Customer bug report">
        <pre className="whitespace-pre-wrap rounded-md bg-[var(--panel)] border border-[var(--line)] p-5 text-[15px] leading-relaxed text-[var(--ink)] font-mono">
          {receipt.bugReport}
        </pre>
      </Section>

      <Section title="Agent claim">
        <div className="rounded-md border border-[var(--line)] bg-[var(--panel)] p-5 space-y-3">
          <Badge tone={receipt.agentClaim.claimedFixed ? "warn" : "neutral"}>
            {receipt.agentClaim.claimedFixed
              ? "CLAIM: FIXED"
              : "Did not claim fixed"}
          </Badge>
          <p className="text-lg leading-relaxed text-[var(--ink)]">
            {receipt.agentClaim.summary}
          </p>
          {receipt.agentClaim.rawText && (
            <details className="text-sm text-[var(--muted)]">
              <summary className="cursor-pointer">Raw agent text</summary>
              <pre className="mt-2 whitespace-pre-wrap font-mono text-[13px]">
                {receipt.agentClaim.rawText}
              </pre>
            </details>
          )}
        </div>
      </Section>

      <Section title="Independent verification">
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Badge
              tone={receipt.verification.verified ? "pass" : "fail"}
            >
              {receipt.verification.verified
                ? "Fresh sandbox re-run: PASS"
                : "Fresh sandbox re-run: FAIL"}
            </Badge>
            <Badge tone="neutral">
              before snap: {String(receipt.verification.beforeSnapshotId)}
            </Badge>
            <Badge tone="neutral">
              after snap: {String(receipt.verification.afterSnapshotId)}
            </Badge>
          </div>
          <p className="text-[var(--muted)] text-sm max-w-2xl">
            The after-snapshot was restored into a <strong>new</strong> sandbox.
            Tests ran there without the agent process — so a green chat message
            is not the evidence; this re-run is.
          </p>
          <TestTable suite={receipt.verification.independentTests} />
        </div>
      </Section>

      <Section title="Diff">
        {receipt.diffs.length === 0 ? (
          <p className="text-[var(--muted)]">No tracked file changes.</p>
        ) : (
          <div className="space-y-4">
            {receipt.diffs.map((d) => (
              <div key={d.path}>
                <p className="font-mono text-sm mb-2 text-[var(--ink)]">
                  {d.path}
                </p>
                <pre className="overflow-x-auto rounded-md bg-[#1a1f1c] text-[#e8f0ea] p-4 text-[13px] leading-relaxed font-mono">
                  {d.unifiedDiff}
                </pre>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Commands run">
        <div className="space-y-3">
          {receipt.commands.length === 0 && (
            <p className="text-[var(--muted)]">No commands logged.</p>
          )}
          {receipt.commands.map((c) => (
            <div
              key={c.id}
              className="rounded-md border border-[var(--line)] bg-[var(--panel)] p-4"
            >
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <code className="font-mono text-sm text-[var(--ink)]">
                  {c.command} {c.args.join(" ")}
                </code>
                <Badge tone={c.exitCode === 0 ? "pass" : "fail"}>
                  exit {String(c.exitCode)}
                </Badge>
                {c.truncated && <Badge tone="warn">truncated</Badge>}
              </div>
              {(c.stdout || c.stderr) && (
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[12px] text-[var(--muted)]">
                  {c.stdout}
                  {c.stderr ? `\n[stderr]\n${c.stderr}` : ""}
                </pre>
              )}
            </div>
          ))}
        </div>
      </Section>

      <Section title="LLM steps (AI Gateway)">
        <div className="mb-4 flex flex-wrap gap-2 text-sm">
          <Badge tone="neutral">
            steps: {receipt.llmSteps.length}
          </Badge>
          <Badge tone="neutral">
            tokens in: {formatTokens(receipt.totals.inputTokens)}
          </Badge>
          <Badge tone="neutral">
            tokens out: {formatTokens(receipt.totals.outputTokens)}
          </Badge>
          <Badge tone="neutral">
            cost USD: {String(receipt.totals.costUsd)}
          </Badge>
          {receipt.totals.stepsMissingCost > 0 && (
            <Badge tone="warn">
              {receipt.totals.stepsMissingCost} step(s) missing cost
            </Badge>
          )}
        </div>
        <div className="space-y-3">
          {receipt.llmSteps.map((s) => (
            <div
              key={s.stepNumber}
              className="rounded-md border border-[var(--line)] bg-[var(--panel)] p-4 text-sm"
            >
              <div className="flex flex-wrap gap-2 mb-2">
                <Badge tone="neutral">step {s.stepNumber}</Badge>
                <Badge tone="neutral">model: {String(s.modelId)}</Badge>
                <Badge tone="neutral">provider: {String(s.provider)}</Badge>
                <Badge tone="neutral">cost: {String(s.costUsd)}</Badge>
              </div>
              <p className="font-mono text-[12px] text-[var(--muted)]">
                tokens in/out/total: {formatTokens(s.inputTokens)} /{" "}
                {formatTokens(s.outputTokens)} / {formatTokens(s.totalTokens)}
                {" · "}
                generationId: {String(s.generationId)}
              </p>
              {s.toolCalls.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-[var(--ink)]">
                  {s.toolCalls.map((t, i) => (
                    <li key={i}>
                      <code className="font-mono">{t.toolName}</code>{" "}
                      <span className="text-[var(--muted)]">
                        {t.inputPreview}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {s.notes.length > 0 && (
                <ul className="mt-2 text-[var(--warn)] text-[12px] space-y-1">
                  {s.notes.map((n, i) => (
                    <li key={i}>Note: {n}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </Section>

      <Section title="How this was locked down">
        <ul className="list-disc pl-5 space-y-2 text-[var(--ink)]">
          {receipt.networkPolicyNotes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
        <ul className="mt-4 list-disc pl-5 space-y-2 text-[var(--muted)] text-sm">
          {receipt.architectureNotes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </Section>
    </article>
  );
}

function TestTable({
  suite,
}: {
  suite: Receipt["verification"]["independentTests"];
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-[var(--line)]">
      <table className="w-full text-left text-sm">
        <thead className="bg-[var(--panel)] text-[var(--muted)]">
          <tr>
            <th className="px-4 py-3 font-medium">Test</th>
            <th className="px-4 py-3 font-medium">Result</th>
            <th className="px-4 py-3 font-medium">Duration</th>
          </tr>
        </thead>
        <tbody>
          {suite.tests.length === 0 && (
            <tr>
              <td className="px-4 py-3 text-[var(--muted)]" colSpan={3}>
                No per-test details (exit {suite.exitCode}). Summary:{" "}
                {suite.summary.passed} passed / {suite.summary.failed} failed /{" "}
                {suite.summary.total} total.
              </td>
            </tr>
          )}
          {suite.tests.map((t) => (
            <tr key={t.fullName} className="border-t border-[var(--line)]">
              <td className="px-4 py-3 font-mono text-[13px]">{t.fullName}</td>
              <td className="px-4 py-3">
                <Badge tone={t.status === "passed" ? "pass" : "fail"}>
                  {t.status}
                </Badge>
              </td>
              <td className="px-4 py-3 text-[var(--muted)]">
                {t.durationMs === "unavailable" ? "—" : `${t.durationMs}ms`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
