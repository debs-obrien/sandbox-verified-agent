import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ToolLoopAgent, isStepCount } from "ai";
import { resolveAuthStatus } from "../auth";
import { DEFAULT_MODEL, FIXTURE_DIRNAME, NORMAL_MAX_STEPS } from "../config";
import { unifiedDiff } from "../receipt/diff";
import { extractLlmSteps } from "../receipt/extract-llm-steps";
import { saveReceipt } from "../receipt/store";
import { decideVerdict, sumLlmTotals } from "../receipt/totals";
import { resetCommandCounter } from "../sandbox/commands";
import { NETWORK_POLICY_NOTES } from "../sandbox/network";
import {
  createPreparedSandbox,
  createSandboxFromSnapshot,
} from "../sandbox/setup";
import {
  independentVerify,
  readAgentPricing,
  runFixtureTests,
  takeSnapshot,
  UNAVAILABLE,
} from "../sandbox/verify";
import type {
  CommandLog,
  DemoMode,
  FileDiff,
  Receipt,
  VerificationResult,
} from "../types";
import { createSandboxTools } from "./tools";
import {
  instructionsFor,
  parseAgentClaim,
  userPromptFor,
} from "./prompts";

const TRACKED_RELATIVE = [`${FIXTURE_DIRNAME}/src/pricing.ts`];

function emptyVerification(
  beforeSnapshotId: string | typeof UNAVAILABLE = UNAVAILABLE,
  afterSnapshotId: string | typeof UNAVAILABLE = UNAVAILABLE,
): VerificationResult {
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
    beforeSnapshotId,
    afterSnapshotId,
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
      agentClaim: {
        claimedFixed: false,
        summary: "Run aborted: missing credentials.",
        rawText: "",
      },
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

  let beforeSnapshotId: string | typeof UNAVAILABLE = UNAVAILABLE;
  let afterSnapshotId: string | typeof UNAVAILABLE = UNAVAILABLE;
  let agentSandbox: Awaited<
    ReturnType<typeof createPreparedSandbox>
  >["sandbox"] | null = null;
  let sandboxRoot = "";
  let fixtureRoot = "";

  try {
    // Hidden mode: omit *.hidden.test.ts from the agent sandbox.
    const prepared = await createPreparedSandbox(commandLog, { mode });
    agentSandbox = prepared.sandbox;
    sandboxRoot = prepared.sandboxRoot;
    fixtureRoot = prepared.fixtureRoot;

    // Baseline snapshot BEFORE the agent works (stops this session).
    const before = await takeSnapshot(agentSandbox);
    beforeSnapshotId = before.snapshotId;

    // Resume work from the before-snapshot in a fresh session.
    const resumed = await createSandboxFromSnapshot(
      before.snapshotId,
      commandLog,
    );
    agentSandbox = resumed.sandbox;
    sandboxRoot = resumed.sandboxRoot;
    fixtureRoot = resumed.fixtureRoot;

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
    const tools = createSandboxTools(agentSandbox, commandLog, {
      sandboxRoot,
      fixtureRoot,
    });

    const agent = new ToolLoopAgent({
      model,
      instructions: instructionsFor(mode, fixtureRoot),
      tools,
      stopWhen: isStepCount(maxSteps),
      toolChoice: "auto",
    });

    const result = await agent.generate({
      prompt: userPromptFor(mode, bugReport),
    });

    const llmSteps = extractLlmSteps(result.steps);
    const claim = parseAgentClaim(result.text ?? "");

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

    // Capture agent pricing.ts before tearing down the agent sandbox.
    const agentPricing = await readAgentPricing(agentSandbox);

    const after = await takeSnapshot(agentSandbox);
    afterSnapshotId = after.snapshotId;
    agentSandbox = null;

    // Fresh pristine fixture + agent diff + held-out hidden tests.
    const verify = await independentVerify(agentPricing, commandLog);
    const verified = verify.tests.passed === true;
    const verdict = decideVerdict({
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
      agentClaim: {
        claimedFixed: claim.claimedFixed,
        summary: claim.summary,
        rawText: result.text ?? "",
      },
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
        beforeSnapshotId,
        afterSnapshotId,
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
    if (agentSandbox) {
      await agentSandbox.stop().catch(() => undefined);
    }

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
      agentClaim: {
        claimedFixed: false,
        summary: "Run failed with an error.",
        rawText: "",
      },
      commands: commandLog,
      llmSteps: [],
      totals: sumLlmTotals([]),
      diffs: [],
      verification: emptyVerification(beforeSnapshotId, afterSnapshotId),
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
    "Sandbox tools: runCommand, readFile, writeFile (writeFile allowlisted to src/pricing.ts only).",
    "Verification: pristine fixture copy (including held-out *.hidden.test.ts) + agent's pricing.ts only, in a fresh sandbox the agent never touched.",
    "Snapshot expiration: 1 day (Sandbox API rejects values between 0 and 1 day exclusive).",
    mode === "hidden"
      ? "Hidden mode: agent sandbox omits *.hidden.test.ts. Agent may honestly pass visible tests with an incomplete fix; held-out tests catch it."
      : "Normal mode: agent sees the full suite (visible + hidden). A real fix must satisfy both.",
    mode
      ? `Mode=${mode}; stopWhen=isStepCount(${maxSteps ?? "?"}).`
      : "Mode unset.",
    "Held-out tests are standard practice (similar to SWE-bench). The independent check runs in a sandbox the agent cannot edit.",
  ];
}
