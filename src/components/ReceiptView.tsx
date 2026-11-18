import type { ReactNode } from "react";
import type { Receipt, TestCaseResult, TestSuiteResult } from "@/lib/types";

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

function formatDuration(ms: number | "unavailable" | undefined): string {
  if (ms === undefined || ms === "unavailable") return "unavailable";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function verdictCopy(receipt: Receipt): { tone: "pass" | "fail" | "warn" | "neutral"; label: string } {
  if (receipt.verdict === "verified") {
    return { tone: "pass", label: "Verified" };
  }
  if (receipt.verdict === "claim-failed-verification") {
    return { tone: "fail", label: "Caught: claim not supported" };
  }
  if (receipt.verdict === "no-claim") {
    return { tone: "warn", label: "No claim submitted" };
  }
  if (receipt.verdict === "error") {
    return { tone: "warn", label: "Run error" };
  }
  return { tone: "neutral", label: "Not fixed" };
}

function TestRows({ tests }: { tests: TestCaseResult[] }) {
  if (tests.length === 0) {
    return (
      <p className="text-sm text-[var(--muted)]">No per-test details.</p>
    );
  }
  return (
    <ul className="space-y-2">
      {tests.map((t) => (
        <li
          key={t.fullName}
          className="rounded-md border border-[var(--line)] bg-[var(--panel)] px-3 py-2"
        >
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={t.status === "passed" ? "pass" : "fail"}>
              {t.status}
            </Badge>
            {t.heldOut && <Badge tone="warn">held-out</Badge>}
            <code className="font-mono text-[12px] text-[var(--ink)]">
              {t.fullName}
            </code>
          </div>
          {t.errorMessage && (
            <pre className="mt-2 whitespace-pre-wrap font-mono text-[12px] text-[var(--fail)]">
              {t.errorMessage}
            </pre>
          )}
        </li>
      ))}
    </ul>
  );
}

function SuiteSummary({ suite }: { suite?: TestSuiteResult }) {
  if (!suite) {
    return <p className="text-sm text-[var(--muted)]">No suite recorded.</p>;
  }
  return (
    <div className="flex flex-wrap gap-2 text-sm mb-3">
      <Badge tone={suite.passed ? "pass" : "fail"}>
        {suite.passed ? "PASS" : "FAIL"} · exit {suite.exitCode}
      </Badge>
      <Badge tone="neutral">
        {suite.summary.passed}/{suite.summary.total} passed
      </Badge>
      {suite.summary.failed > 0 && (
        <Badge tone="fail">{suite.summary.failed} failed</Badge>
      )}
    </div>
  );
}

export function ReceiptView({ receipt }: { receipt: Receipt }) {
  const { tone: verdictTone, label: verdictLabel } = verdictCopy(receipt);
  const visible =
    receipt.verification.visibleTests?.length
      ? receipt.verification.visibleTests
      : receipt.verification.independentTests.tests.filter((t) => !t.heldOut);
  const hidden =
    receipt.verification.hiddenTests?.length
      ? receipt.verification.hiddenTests
      : receipt.verification.independentTests.tests.filter((t) => t.heldOut);
  const failingHidden = hidden.filter((t) => t.status === "failed");

  return (
    <article className="mx-auto max-w-6xl px-5 py-10 md:py-14">
      {receipt.isSample && (
        <div className="mb-6 rounded-md border border-[var(--warn)] bg-[var(--warn-bg)] px-4 py-3 text-[var(--warn)] text-sm font-medium">
          SAMPLE DATA — not a live Sandbox/Gateway run. Used for UI and unit
          tests only.
          {receipt.sampleLabel ? ` (${receipt.sampleLabel})` : null}
        </div>
      )}

      <header className="space-y-5">
        <p className="text-sm uppercase tracking-[0.18em] text-[var(--muted)]">
          Sandbox Verified Agent · Receipt
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-4xl md:text-5xl font-[family-name:var(--font-display)] leading-none">
            <Badge tone={verdictTone}>{verdictLabel}</Badge>
          </span>
        </div>
        <h1 className="font-[family-name:var(--font-display)] text-3xl md:text-4xl leading-[1.05] text-[var(--ink)]">
          Did the agent really fix it?
        </h1>
        <div className="flex flex-wrap gap-2 items-center">
          <Badge tone="neutral">
            mode: {receipt.mode === "hidden" ? "hidden-tests" : "normal"}
          </Badge>
          <Badge tone="neutral">model: {receipt.modelConfigured}</Badge>
          <Badge tone="neutral">
            duration: {formatDuration(receipt.durationMs)}
          </Badge>
        </div>
        <p className="text-[var(--muted)] text-sm">
          Receipt <code className="font-mono">{receipt.id}</code> ·{" "}
          {new Date(receipt.createdAt).toLocaleString()}
        </p>
        <div className="flex flex-wrap gap-3 items-center">
          <a
            className="inline-flex items-center rounded-md bg-[var(--ink)] text-[var(--paper)] px-4 py-2 text-sm font-semibold hover:opacity-90 transition"
            href={`/api/receipt/${receipt.id}/evidence`}
            download={`${receipt.id}.evidence.json`}
          >
            Download evidence
          </a>
          <a
            className="inline-flex items-center rounded-md border border-[var(--line)] bg-[var(--panel)] text-[var(--ink)] px-4 py-2 text-sm font-semibold hover:opacity-90 transition"
            href={`/api/receipt/${receipt.id}`}
            download={`${receipt.id}.json`}
          >
            Download receipt JSON
          </a>
        </div>
        {receipt.evidence && (
          <div className="rounded-md border border-[var(--line)] bg-[var(--panel)] p-4 space-y-3 max-w-2xl">
            <div className="flex flex-wrap gap-2 items-center">
              <Badge
                tone={
                  receipt.evidence.status === "written"
                    ? "pass"
                    : receipt.evidence.status === "failed"
                      ? "fail"
                      : "warn"
                }
              >
                evidence: {receipt.evidence.status}
              </Badge>
              {typeof receipt.evidence.bytes === "number" && (
                <Badge tone="neutral">
                  {(receipt.evidence.bytes / 1024).toFixed(1)} KiB
                </Badge>
              )}
              {typeof receipt.evidence.artifactCount === "number" && (
                <Badge tone="neutral">
                  {receipt.evidence.artifactCount} artifacts
                </Badge>
              )}
            </div>
            <p className="text-sm text-[var(--muted)] leading-relaxed">
              Complete evidence pack (changed files, diffs, full test output,
              claim, tokens/cost, sandbox ids, snapshot cleanup log) with a
              sha256 manifest. Snapshots are not kept — this pack is the proof.
            </p>
            {receipt.evidence.artifacts &&
              receipt.evidence.artifacts.length > 0 && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-[var(--ink)] font-medium">
                    What&apos;s inside
                  </summary>
                  <ul className="mt-2 space-y-1 font-mono text-[12px] text-[var(--muted)] max-h-48 overflow-auto">
                    {receipt.evidence.artifacts.map((a) => (
                      <li key={a.path}>
                        {a.path}{" "}
                        <span className="opacity-70">
                          · {a.bytes} B · {a.sha256.slice(0, 12)}…
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            {receipt.evidence.error && (
              <p className="text-sm text-[var(--fail)]">
                {receipt.evidence.error}
              </p>
            )}
          </div>
        )}
      </header>

      {receipt.errorMessage && (
        <Section title="Error">
          <pre className="whitespace-pre-wrap rounded-md bg-[var(--panel)] border border-[var(--line)] p-4 text-sm text-[var(--fail)] font-mono">
            {receipt.errorMessage}
          </pre>
        </Section>
      )}

      <Section title="Claim vs proof">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="rounded-md border border-[var(--line)] bg-[var(--panel)] p-5 space-y-4">
            <h3 className="font-[family-name:var(--font-display)] text-xl text-[var(--ink)]">
              What the agent said
            </h3>
            {!receipt.agentClaim.submitted ? (
              <Badge tone="warn">No claim submitted</Badge>
            ) : (
              <Badge
                tone={receipt.agentClaim.claimedFixed ? "warn" : "neutral"}
              >
                {receipt.agentClaim.claimedFixed
                  ? "submitClaim: fixed=true"
                  : "submitClaim: fixed=false"}
              </Badge>
            )}
            <p className="text-[15px] leading-relaxed text-[var(--ink)]">
              {receipt.agentClaim.summary}
            </p>
            {receipt.agentClaim.submitted && receipt.agentClaim.testsRun && (
              <p className="text-sm text-[var(--muted)]">
                Agent reported tests: {receipt.agentClaim.testsRun}
              </p>
            )}
            <div>
              <p className="text-sm text-[var(--muted)] mb-2">Files changed</p>
              {(receipt.agentClaim.filesChanged?.length
                ? receipt.agentClaim.filesChanged
                : receipt.diffs.map((d) => d.path)
              ).length === 0 ? (
                <p className="text-sm text-[var(--muted)]">None</p>
              ) : (
                <ul className="font-mono text-sm space-y-1">
                  {(receipt.agentClaim.filesChanged?.length
                    ? receipt.agentClaim.filesChanged
                    : receipt.diffs.map((d) => d.path)
                  ).map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="text-sm text-[var(--muted)] mb-2">
                Tests the agent ran
              </p>
              <SuiteSummary suite={receipt.agentTests} />
              {receipt.agentTests && (
                <TestRows tests={receipt.agentTests.tests} />
              )}
            </div>
            {receipt.agentClaim.rawText && (
              <details className="text-sm text-[var(--muted)]">
                <summary className="cursor-pointer">Raw agent text</summary>
                <pre className="mt-2 whitespace-pre-wrap font-mono text-[13px]">
                  {receipt.agentClaim.rawText}
                </pre>
              </details>
            )}
          </div>

          <div className="rounded-md border border-[var(--line)] bg-[var(--panel)] p-5 space-y-4">
            <h3 className="font-[family-name:var(--font-display)] text-xl text-[var(--ink)]">
              What the sandbox proved
            </h3>
            <div className="flex flex-wrap gap-2">
              <Badge
                tone={receipt.verification.verified ? "pass" : "fail"}
              >
                {receipt.verification.verified
                  ? "Independent suite: PASS"
                  : "Independent suite: FAIL"}
              </Badge>
              <Badge tone="neutral">
                fresh sandbox:{" "}
                {String(receipt.verification.verificationSandboxId)}
              </Badge>
              <Badge tone="neutral">
                method: {receipt.verification.method ?? "pristine-plus-diff"}
              </Badge>
            </div>
            <p className="text-sm text-[var(--muted)] leading-relaxed">
              Held-out tests are standard practice (like SWE-bench). This check
              runs in a fresh sandbox the agent never touched: original fixture +
              the agent&apos;s diff + any held-out tests.
            </p>
            <div>
              <p className="text-sm font-semibold text-[var(--ink)] mb-2">
                Visible tests
              </p>
              <TestRows tests={visible} />
            </div>
            <div>
              <p className="text-sm font-semibold text-[var(--ink)] mb-2">
                Hidden / held-out tests
              </p>
              {hidden.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">
                  None recorded on this receipt.
                </p>
              ) : (
                <TestRows tests={hidden} />
              )}
            </div>
            {failingHidden.length > 0 && (
              <div>
                <p className="text-sm font-semibold text-[var(--fail)] mb-2">
                  Failing held-out output
                </p>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-[#1a1f1c] text-[#e8f0ea] p-3 font-mono text-[12px]">
                  {receipt.verification.independentTests.stdout ||
                    failingHidden
                      .map((t) => `${t.fullName}\n${t.errorMessage ?? ""}`)
                      .join("\n\n")}
                </pre>
              </div>
            )}
          </div>
        </div>
      </Section>

      <Section title="Run metadata">
        <div className="flex flex-wrap gap-2 text-sm">
          <Badge tone="neutral">steps: {receipt.llmSteps.length}</Badge>
          <Badge tone="neutral">
            tokens in: {formatTokens(receipt.totals.inputTokens)}
          </Badge>
          <Badge tone="neutral">
            tokens out: {formatTokens(receipt.totals.outputTokens)}
          </Badge>
          <Badge tone="neutral">
            cost USD: {String(receipt.totals.costUsd)}
          </Badge>
          <Badge tone="neutral">model: {receipt.modelConfigured}</Badge>
          <Badge tone="neutral">
            duration: {formatDuration(receipt.durationMs)}
          </Badge>
          {receipt.agentSandboxId && (
            <Badge tone="neutral">
              agent sandbox: {String(receipt.agentSandboxId)}
            </Badge>
          )}
          {receipt.totals.stepsMissingCost > 0 && (
            <Badge tone="warn">
              {receipt.totals.stepsMissingCost} step(s) missing cost
            </Badge>
          )}
        </div>
        {receipt.cleanupLog && receipt.cleanupLog.length > 0 && (
          <div className="mt-4">
            <p className="text-sm text-[var(--muted)] mb-2">
              Snapshot / sandbox cleanup (after evidence write)
            </p>
            <ul className="space-y-1 font-mono text-[12px] text-[var(--muted)]">
              {receipt.cleanupLog.map((c, i) => (
                <li key={`${c.kind}-${c.id}-${i}`}>
                  {c.kind} {c.id}
                  {c.deleted
                    ? ` · deleted ${c.deletedAt ?? ""}`
                    : c.skipped
                      ? " · skipped (evidence not written)"
                      : " · not deleted"}
                  {c.note ? ` — ${c.note}` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}
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

      {receipt.mode === "hidden" && receipt.hiddenTestSource && (
        <Section title="Held-out test source (revealed after verification)">
          <p className="text-sm text-[var(--muted)] mb-3 max-w-3xl">
            Fair reveal: these tests were not present in the agent sandbox. They
            ran only in the independent verification sandbox.
          </p>
          <pre className="overflow-x-auto rounded-md bg-[#1a1f1c] text-[#e8f0ea] p-4 text-[13px] leading-relaxed font-mono">
            {receipt.hiddenTestSource}
          </pre>
        </Section>
      )}

      <Section title="Customer bug report">
        <pre className="whitespace-pre-wrap rounded-md bg-[var(--panel)] border border-[var(--line)] p-5 text-[15px] leading-relaxed text-[var(--ink)] font-mono">
          {receipt.bugReport}
        </pre>
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
