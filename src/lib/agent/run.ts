import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ToolLoopAgent, isStepCount } from "ai";
import { resolveAuthStatus } from "../auth";
import {
  CAUGHT_MAX_STEPS,
  DEFAULT_MODEL,
  FIXTURE_DIRNAME,
  NORMAL_MAX_STEPS,
} from "../config";
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
  runFixtureTests,
  takeSnapshot,
  UNAVAILABLE,
} from "../sandbox/verify";
import type { CommandLog, DemoMode, FileDiff, Receipt } from "../types";
import { createSandboxTools } from "./tools";
import {
  instructionsFor,
  parseAgentClaim,
  userPromptFor,
} from "./prompts";

const TRACKED_RELATIVE = [
  `${FIXTURE_DIRNAME}/src/pricing.ts`,
  `${FIXTURE_DIRNAME}/src/pricing.test.ts`,
];

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
      verification: {
        independentTests: {
          passed: false,
          exitCode: -1,
          stdout: "",
          stderr: "",
          tests: [],
          summary: { total: 0, passed: 0, failed: 0, skipped: 0 },
        },
        verified: false,
        beforeSnapshotId: UNAVAILABLE,
        afterSnapshotId: UNAVAILABLE,
        verificationSandboxId: UNAVAILABLE,
      },
      verdict: "error",
      errorMessage: `Missing credentials:\n- ${auth.missing.join("\n- ")}`,
      networkPolicyNotes: NETWORK_POLICY_NOTES,
      architectureNotes: architectureNotes(),
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
    const prepared = await createPreparedSandbox(commandLog);
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

    const maxSteps = mode === "caught" ? CAUGHT_MAX_STEPS : NORMAL_MAX_STEPS;
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

    const after = await takeSnapshot(agentSandbox);
    afterSnapshotId = after.snapshotId;
    agentSandbox = null;

    const verify = await independentVerify(after.snapshotId, commandLog);
    const verified = verify.tests.passed === true;
    const verdict = decideVerdict({
      claimedFixed: claim.claimedFixed,
      verified,
    });

    const receipt: Receipt = {
      id,
      createdAt,
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
        verified,
        beforeSnapshotId,
        afterSnapshotId,
        verificationSandboxId: verify.verificationSandboxId,
      },
      verdict,
      networkPolicyNotes: NETWORK_POLICY_NOTES,
      architectureNotes: architectureNotes(
        mode,
        maxSteps,
        verify.restoredHarness,
        fixtureRoot,
      ),
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
      verification: {
        independentTests: {
          passed: false,
          exitCode: -1,
          stdout: "",
          stderr: "",
          tests: [],
          summary: { total: 0, passed: 0, failed: 0, skipped: 0 },
        },
        verified: false,
        beforeSnapshotId,
        afterSnapshotId,
        verificationSandboxId: UNAVAILABLE,
      },
      verdict: "error",
      errorMessage: message,
      networkPolicyNotes: NETWORK_POLICY_NOTES,
      architectureNotes: architectureNotes(undefined, undefined, undefined, fixtureRoot),
    };
    await saveReceipt(receipt);
    return receipt;
  }
}

function architectureNotes(
  mode?: DemoMode,
  maxSteps?: number,
  restoredHarness?: string[],
  fixtureRoot?: string,
): string[] {
  return [
    fixtureRoot
      ? `Fixture workspace inside sandbox: ${fixtureRoot}`
      : "Fixture workspace created under the sandbox cwd (mkdir -p).",
    "LLM (AI SDK ToolLoopAgent) runs on the Next.js host via AI Gateway — not inside the sandbox.",
    "Auth: getVercelOidcToken() (x-vercel-oidc-token header on Vercel, VERCEL_OIDC_TOKEN locally) or AI_GATEWAY_API_KEY / token trio.",
    "Sandbox tools: runCommand, readFile, writeFile (writeFile allowlisted to src/pricing.ts only).",
    "Verification: snapshot before → agent work → snapshot after → fresh sandbox → restore pristine harness → clear vitest-results.json → re-run vitest.",
    "Snapshot expiration: 1 day (Sandbox API rejects values between 0 and 1 day exclusive).",
    restoredHarness?.length
      ? `Restored trusted harness files before verify: ${restoredHarness.join(", ")}.`
      : "Trusted harness restore runs before independent verify.",
    mode
      ? `Mode=${mode}; stopWhen=isStepCount(${maxSteps ?? "?"}).`
      : "Mode unset.",
    "Caught-it mode uses a weaker prompt + tiny step budget so the agent claims FIXED without a correct fix; independent re-run fails.",
  ];
}
