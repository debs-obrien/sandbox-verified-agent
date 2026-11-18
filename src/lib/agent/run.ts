import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  ToolLoopAgent,
  generateText,
  hasToolCall,
  isStepCount,
} from "ai";
import type { Sandbox } from "@vercel/sandbox";
import { resolveAuthStatus } from "../auth";
import { DEFAULT_MODEL, FIXTURE_DIRNAME, NORMAL_MAX_STEPS } from "../config";
import { unifiedDiff } from "../receipt/diff";
import {
  buildEvidencePack,
  evidencePackMetaFailed,
  evidencePackMetaFromWritten,
  withUpdatedCleanupLog,
} from "../receipt/evidence";
import { extractLlmSteps } from "../receipt/extract-llm-steps";
import { saveEvidencePack, saveReceipt } from "../receipt/store";
import { decideVerdict, sumLlmTotals } from "../receipt/totals";
import { disposeSandboxQuietly } from "../sandbox/cleanup";
import { resetCommandCounter } from "../sandbox/commands";
import {
  cleanupAfterEvidence,
  listSandboxSnapshotsQuietly,
  type ObservedSnapshot,
} from "../sandbox/evidence-cleanup";
import { NETWORK_POLICY_NOTES } from "../sandbox/network";
import { createPreparedSandbox } from "../sandbox/setup";
import {
  independentVerify,
  readAgentPricing,
  runFixtureTests,
  UNAVAILABLE,
} from "../sandbox/verify";
import type {
  AgentClaim,
  CommandLog,
  DemoMode,
  EvidencePackMeta,
  FileDiff,
  Receipt,
  SnapshotCleanupEntry,
  VerificationResult,
} from "../types";
import {
  buildForcedClaimFollowUpMessages,
  ensureClaimSubmitted,
  forceClaimPrepareStep,
  SUBMIT_CLAIM_TOOL,
} from "./force-claim";
import {
  createSandboxTools,
  emptyClaim,
  extractSubmitClaim,
  type ClaimBox,
} from "./tools";
import { instructionsFor, userPromptFor } from "./prompts";

const TRACKED_RELATIVE = [`${FIXTURE_DIRNAME}/src/pricing.ts`];

function emptyVerification(): VerificationResult {
  return {
    independentTests: {
      passed: false,
      exitCode: -1,
      stdout: "",
      stderr: "",
      tests: [],
      summary: { total: 0, passed: 0, failed: 0, skipped: 0 },
    },
    visibleTests: [],
    hiddenTests: [],
    verified: false,
    beforeSnapshotId: UNAVAILABLE,
    afterSnapshotId: UNAVAILABLE,
    verificationSandboxId: UNAVAILABLE,
    method: "pristine-plus-diff",
  };
}

async function readSandboxText(
  sandbox: {
    readFileToBuffer: (f: { path: string }) => Promise<Buffer | null>;
  },
  filePath: string,
): Promise<string> {
  const buf = await sandbox.readFileToBuffer({ path: filePath });
  return buf?.toString("utf8") ?? "";
}

function abortClaim(summary: string): AgentClaim {
  return {
    ...emptyClaim(),
    summary,
  };
}

export async function runVerifiedAgent(options: {
  mode: DemoMode;
  model?: string;
}): Promise<Receipt> {
  const mode = options.mode;
  const model = options.model ?? DEFAULT_MODEL;
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const startedMs = Date.now();
  const commandLog: CommandLog[] = [];
  resetCommandCounter();

  const bugReport = await readFile(
    path.join(process.cwd(), "fixtures/buggy-pricing/BUG_REPORT.md"),
    "utf8",
  );

  // Must run inside the request handler so x-vercel-oidc-token is visible.
  const auth = await resolveAuthStatus();
  if (auth.missing.length > 0) {
    const receipt: Receipt = {
      id,
      createdAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
      mode,
      isSample: false,
      bugReport,
      modelConfigured: model,
      agentClaim: abortClaim("Run aborted: missing credentials."),
      commands: [],
      llmSteps: [],
      totals: sumLlmTotals([]),
      diffs: [],
      verification: emptyVerification(),
      verdict: "error",
      errorMessage: `Missing credentials:\n- ${auth.missing.join("\n- ")}`,
      networkPolicyNotes: NETWORK_POLICY_NOTES,
      architectureNotes: architectureNotes(mode),
      evidence: { status: "skipped", error: "Run aborted before evidence." },
      cleanupLog: [],
    };
    await saveReceipt(receipt);
    return receipt;
  }

  let agentSandbox: Sandbox | null = null;
  let verifySandbox: Sandbox | null = null;
  let sandboxRoot = "";
  let fixtureRoot = "";
  let agentSandboxId: string = UNAVAILABLE;

  try {
    // Hidden mode: omit *.hidden.test.ts from the agent sandbox.
    // Sandboxes stay alive until the evidence pack is written.
    const prepared = await createPreparedSandbox(commandLog, { mode });
    agentSandbox = prepared.sandbox;
    sandboxRoot = prepared.sandboxRoot;
    fixtureRoot = prepared.fixtureRoot;
    agentSandboxId = agentSandbox.name || UNAVAILABLE;

    const beforeFiles: Record<string, string> = {};
    for (const f of TRACKED_RELATIVE) {
      beforeFiles[f] = await readSandboxText(agentSandbox, f);
    }

    const agentTestsBefore = await runFixtureTests(
      agentSandbox,
      fixtureRoot,
      commandLog,
    );

    const maxSteps = NORMAL_MAX_STEPS;
    const claimBox: ClaimBox = { current: null };
    const tools = createSandboxTools(agentSandbox, commandLog, {
      sandboxRoot,
      fixtureRoot,
      claimBox,
    });

    const instructions = instructionsFor(mode, fixtureRoot);
    const agent = new ToolLoopAgent({
      model,
      instructions,
      tools,
      stopWhen: [hasToolCall(SUBMIT_CLAIM_TOOL), isStepCount(maxSteps)],
      toolChoice: "auto",
      // Final allowed step: force submitClaim so isStepCount cannot end a
      // green run with narration-only / no-claim.
      prepareStep: ({ stepNumber }) =>
        forceClaimPrepareStep({ stepNumber, maxSteps }),
    });

    const result = await agent.generate({
      prompt: userPromptFor(mode, bugReport),
    });

    const initialClaim =
      claimBox.current ??
      extractSubmitClaim(result.steps, result.text ?? "");

    // Backup: loop ended without claim (early text finish or forced-step miss).
    const ensured = await ensureClaimSubmitted({
      claim: initialClaim,
      steps: [...result.steps],
      rawText: result.text ?? "",
      runFollowUp: async () => {
        const followUp = await generateText({
          model,
          system: instructions,
          tools,
          messages: buildForcedClaimFollowUpMessages(result.responseMessages),
          toolChoice: { type: "tool", toolName: SUBMIT_CLAIM_TOOL },
          stopWhen: hasToolCall(SUBMIT_CLAIM_TOOL),
        });
        return { steps: [...followUp.steps], text: followUp.text };
      },
    });

    const claim = claimBox.current?.submitted
      ? claimBox.current
      : ensured.claim;

    const llmSteps = extractLlmSteps(ensured.steps);

    const diffs: FileDiff[] = [];
    for (const f of TRACKED_RELATIVE) {
      const afterContent = await readSandboxText(agentSandbox, f);
      const beforeContent = beforeFiles[f] ?? "";
      if (beforeContent !== afterContent) {
        const display = f.replace(new RegExp(`^${FIXTURE_DIRNAME}/`), "");
        diffs.push({
          path: display,
          before: beforeContent,
          after: afterContent,
          unifiedDiff: unifiedDiff(display, beforeContent, afterContent),
        });
      }
    }

    const agentTestsAfter = await runFixtureTests(
      agentSandbox,
      fixtureRoot,
      commandLog,
    );

    const agentPricing = await readAgentPricing(agentSandbox);

    // Fresh pristine fixture + agent diff + held-out hidden tests.
    // Caller owns sandbox dispose — only after evidence pack write.
    const verify = await independentVerify(agentPricing, commandLog);
    verifySandbox = verify.sandbox;
    const verified = verify.tests.passed === true;
    const verdict = decideVerdict({
      claimSubmitted: claim.submitted,
      claimedFixed: claim.claimedFixed,
      verified,
    });

    const finishedAt = new Date().toISOString();
    const notes = architectureNotes(mode, maxSteps, fixtureRoot);

    // Observe any snapshots before cleanup (normally none).
    const observed: ObservedSnapshot[] = [
      ...(await listSandboxSnapshotsQuietly(agentSandbox)),
      ...(await listSandboxSnapshotsQuietly(verifySandbox)),
    ];

    let pack = buildEvidencePack({
      receiptId: id,
      mode,
      createdAt,
      finishedAt,
      verdict,
      modelConfigured: model,
      claim,
      diffs,
      agentTests: agentTestsAfter ?? agentTestsBefore,
      independentTests: verify.tests,
      visibleTests: verify.visibleTests,
      hiddenTests: verify.hiddenTests,
      hiddenTestSource:
        mode === "hidden" ? verify.hiddenTestSource : undefined,
      llmSteps,
      totals: sumLlmTotals(llmSteps),
      commands: commandLog,
      agentSandboxId,
      verificationSandboxId: verify.verificationSandboxId,
      snapshotsCreated: observed.map((s) => ({
        snapshotId: s.snapshotId,
        sandboxId: s.sandboxId,
        createdAt: s.createdAt,
        sizeBytes: s.sizeBytes,
      })),
      cleanupLog: [],
      networkPolicyNotes: NETWORK_POLICY_NOTES,
      architectureNotes: notes,
    });

    // Evidence first — never delete snapshots/sandboxes until this succeeds.
    const written = await saveEvidencePack(id, pack);
    let evidence: EvidencePackMeta;
    let cleanupLog: SnapshotCleanupEntry[] = [];

    if (written.ok) {
      evidence = evidencePackMetaFromWritten({
        pathname: written.pathname,
        pack,
        writtenAt: new Date().toISOString(),
      });
      cleanupLog = await cleanupAfterEvidence({
        evidenceWritten: true,
        sandboxes: [
          { sandbox: agentSandbox, role: "agent" },
          { sandbox: verifySandbox, role: "verify" },
        ],
        observedSnapshots: observed,
      });
      agentSandbox = null;
      verifySandbox = null;

      // Refresh pack + receipt with cleanup audit (rewrite pack with hashes).
      pack = withUpdatedCleanupLog(pack, cleanupLog);
      const rewritten = await saveEvidencePack(id, pack);
      if (rewritten.ok) {
        evidence = evidencePackMetaFromWritten({
          pathname: rewritten.pathname,
          pack,
          writtenAt: new Date().toISOString(),
        });
      }
    } else {
      evidence = evidencePackMetaFailed(
        written.error ?? "Evidence pack write failed.",
      );
      cleanupLog = await cleanupAfterEvidence({
        evidenceWritten: false,
        sandboxes: [
          { sandbox: agentSandbox, role: "agent" },
          { sandbox: verifySandbox, role: "verify" },
        ],
        observedSnapshots: observed,
      });
      agentSandbox = null;
      verifySandbox = null;
    }

    const receipt: Receipt = {
      id,
      createdAt,
      finishedAt,
      durationMs: Date.now() - startedMs,
      mode,
      isSample: false,
      bugReport,
      modelConfigured: model,
      agentClaim: claim,
      commands: commandLog,
      llmSteps,
      totals: sumLlmTotals(llmSteps),
      diffs,
      agentTests: agentTestsAfter ?? agentTestsBefore,
      verification: {
        independentTests: verify.tests,
        visibleTests: verify.visibleTests,
        hiddenTests: verify.hiddenTests,
        verified,
        beforeSnapshotId: UNAVAILABLE,
        afterSnapshotId: UNAVAILABLE,
        verificationSandboxId: verify.verificationSandboxId,
        method: "pristine-plus-diff",
      },
      hiddenTestSource: mode === "hidden" ? verify.hiddenTestSource : undefined,
      verdict,
      networkPolicyNotes: NETWORK_POLICY_NOTES,
      architectureNotes: notes,
      agentSandboxId,
      evidence,
      cleanupLog,
    };

    await saveReceipt(receipt);
    return receipt;
  } catch (err) {
    // Error path: still try to avoid silent snapshot loss — stop without
    // orphan delete if we never wrote an evidence pack.
    await disposeSandboxQuietly(agentSandbox, {
      deleteOrphanSnapshots: false,
    });
    await disposeSandboxQuietly(verifySandbox, {
      deleteOrphanSnapshots: false,
    });

    const message = err instanceof Error ? err.message : String(err);
    const receipt: Receipt = {
      id,
      createdAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
      mode,
      isSample: false,
      bugReport,
      modelConfigured: model,
      agentClaim: abortClaim("Run failed with an error."),
      commands: commandLog,
      llmSteps: [],
      totals: sumLlmTotals([]),
      diffs: [],
      verification: emptyVerification(),
      verdict: "error",
      errorMessage: message,
      networkPolicyNotes: NETWORK_POLICY_NOTES,
      architectureNotes: architectureNotes(mode, undefined, fixtureRoot),
      agentSandboxId,
      evidence: {
        status: "failed",
        error: "Run errored before evidence pack could be written.",
      },
      cleanupLog: [],
    };
    await saveReceipt(receipt);
    return receipt;
  }
}

function architectureNotes(
  mode?: DemoMode,
  maxSteps?: number,
  fixtureRoot?: string,
): string[] {
  return [
    fixtureRoot
      ? `Fixture workspace inside sandbox: ${fixtureRoot}`
      : "Fixture workspace created under the sandbox cwd (mkdir -p).",
    "LLM (AI SDK ToolLoopAgent) runs on the Next.js host via AI Gateway — not inside the sandbox.",
    "Auth: getVercelOidcToken() (x-vercel-oidc-token header on Vercel, VERCEL_OIDC_TOKEN locally) or AI_GATEWAY_API_KEY / token trio.",
    "Sandbox tools: runCommand, readFile, writeFile, submitClaim (writeFile allowlisted to src/pricing.ts only).",
    "Final claim is structured via submitClaim (fixed, summary, filesChanged, testsRun); stopWhen=hasToolCall(submitClaim).",
    "Claim guarantee: prepareStep forces toolChoice=submitClaim on the final allowed step; if still missing, one generateText follow-up with the same history + forced submitClaim. Honest fixed=false is allowed; no-claim only after errors/refusal.",
    "Evidence pack (Blob JSON + sha256 manifest) is the durable proof. Sandbox filesystem snapshots (~800 MiB) are not kept; cleanup runs only after the pack writes successfully.",
    "Verification: pristine fixture copy (including held-out *.hidden.test.ts) + agent's pricing.ts only. Sandboxes deleted afterward (deleteOrphanSnapshots) once evidence is stored.",
    mode === "hidden"
      ? "Hidden mode: agent sandbox omits *.hidden.test.ts. A natural threshold-only fix can pass visible tests; held-out multi-line cart tests catch cart-wide discount logic."
      : "Normal mode: agent sees the full suite (visible + hidden). Fixing threshold + per-line cart semantics makes independent verify green.",
    mode
      ? `Mode=${mode}; stopWhen=[hasToolCall(submitClaim), isStepCount(${maxSteps ?? "?"})]; prepareStep forces claim on last step.`
      : "Mode unset.",
    "Held-out tests are standard practice (similar to SWE-bench). The independent check runs in a sandbox the agent cannot edit.",
  ];
}
