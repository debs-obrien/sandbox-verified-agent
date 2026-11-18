import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ToolLoopAgent, hasToolCall, isStepCount } from "ai";
import { resolveAuthStatus } from "../auth";
import { DEFAULT_MODEL, FIXTURE_DIRNAME, NORMAL_MAX_STEPS } from "../config";
import { unifiedDiff } from "../receipt/diff";
import { extractLlmSteps } from "../receipt/extract-llm-steps";
import { saveReceipt } from "../receipt/store";
import { decideVerdict, sumLlmTotals } from "../receipt/totals";
import { disposeSandboxQuietly } from "../sandbox/cleanup";
import { resetCommandCounter } from "../sandbox/commands";
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
  FileDiff,
  Receipt,
  VerificationResult,
} from "../types";
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
    };
    await saveReceipt(receipt);
    return receipt;
  }

  let agentSandbox: Awaited<
    ReturnType<typeof createPreparedSandbox>
  >["sandbox"] | null = null;
  let sandboxRoot = "";
  let fixtureRoot = "";

  try {
    // Hidden mode: omit *.hidden.test.ts from the agent sandbox.
    // No snapshots — agent works in this session; verify uses a fresh sandbox.
    const prepared = await createPreparedSandbox(commandLog, { mode });
    agentSandbox = prepared.sandbox;
    sandboxRoot = prepared.sandboxRoot;
    fixtureRoot = prepared.fixtureRoot;

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

    const agent = new ToolLoopAgent({
      model,
      instructions: instructionsFor(mode, fixtureRoot),
      tools,
      stopWhen: [hasToolCall("submitClaim"), isStepCount(maxSteps)],
      toolChoice: "auto",
    });

    const result = await agent.generate({
      prompt: userPromptFor(mode, bugReport),
    });

    const llmSteps = extractLlmSteps(result.steps);
    const claim =
      claimBox.current ??
      extractSubmitClaim(result.steps, result.text ?? "");

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

    // Capture agent pricing.ts, then dispose the agent sandbox (no snapshot).
    const agentPricing = await readAgentPricing(agentSandbox);
    await disposeSandboxQuietly(agentSandbox, { deleteOrphanSnapshots: true });
    agentSandbox = null;

    // Fresh pristine fixture + agent diff + held-out hidden tests.
    const verify = await independentVerify(agentPricing, commandLog);
    const verified = verify.tests.passed === true;
    const verdict = decideVerdict({
      claimSubmitted: claim.submitted,
      claimedFixed: claim.claimedFixed,
      verified,
    });

    const finishedAt = new Date().toISOString();
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
      architectureNotes: architectureNotes(mode, maxSteps, fixtureRoot),
    };

    await saveReceipt(receipt);
    return receipt;
  } catch (err) {
    await disposeSandboxQuietly(agentSandbox, { deleteOrphanSnapshots: true });

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
    "No per-run snapshots (Hobby Snapshot Storage is 15 GB lifetime). Agent works in one ephemeral sandbox; verify uses a second fresh sandbox.",
    "Verification: pristine fixture copy (including held-out *.hidden.test.ts) + agent's pricing.ts only. Sandboxes are deleted afterward (deleteOrphanSnapshots).",
    mode === "hidden"
      ? "Hidden mode: agent sandbox omits *.hidden.test.ts. A natural threshold-only fix can pass visible tests; held-out multi-line cart tests catch cart-wide discount logic."
      : "Normal mode: agent sees the full suite (visible + hidden). Fixing threshold + per-line cart semantics makes independent verify green.",
    mode
      ? `Mode=${mode}; stopWhen=[hasToolCall(submitClaim), isStepCount(${maxSteps ?? "?"})].`
      : "Mode unset.",
    "Held-out tests are standard practice (similar to SWE-bench). The independent check runs in a sandbox the agent cannot edit.",
  ];
}
