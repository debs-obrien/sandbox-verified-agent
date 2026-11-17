import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ToolLoopAgent, isStepCount } from "ai";
import {
  CAUGHT_MAX_STEPS,
  DEFAULT_MODEL,
  NORMAL_MAX_STEPS,
  WORKSPACE_ROOT,
  missingCredentials,
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
import type {
  CommandLog,
  DemoMode,
  FileDiff,
  Receipt,
} from "../types";
import { createSandboxTools } from "./tools";
import {
  instructionsFor,
  parseAgentClaim,
  userPromptFor,
} from "./prompts";

const TRACKED_FILES = [
  "buggy-pricing/src/pricing.ts",
  "buggy-pricing/src/pricing.test.ts",
];

async function readSandboxText(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sandbox: { readFileToBuffer: (f: { path: string }) => Promise<Buffer | null> },
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

  const missing = missingCredentials();
  if (missing.length > 0) {
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
      errorMessage: `Missing credentials:\n- ${missing.join("\n- ")}`,
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

  try {
    const prepared = await createPreparedSandbox(commandLog);
    agentSandbox = prepared.sandbox;

    // Baseline snapshot BEFORE the agent works.
    // snapshot() stops the session — we must recreate from the snapshot.
    const before = await takeSnapshot(agentSandbox);
    beforeSnapshotId = before.snapshotId;

    // Resume work from the before-snapshot in a fresh session.
    agentSandbox = await createSandboxFromSnapshot(before.snapshotId);

    // Capture before-file contents for the diff.
    const beforeFiles: Record<string, string> = {};
    for (const f of TRACKED_FILES) {
      beforeFiles[f] = await readSandboxText(agentSandbox, f);
    }

    // Baseline failing tests (agent evidence, not verification).
    const agentTestsBefore = await runFixtureTests(agentSandbox, commandLog);

    const maxSteps = mode === "caught" ? CAUGHT_MAX_STEPS : NORMAL_MAX_STEPS;
    const tools = createSandboxTools(agentSandbox, commandLog);

    const agent = new ToolLoopAgent({
      model,
      instructions: instructionsFor(mode),
      tools,
      stopWhen: isStepCount(maxSteps),
      toolChoice: "auto",
    });

    const result = await agent.generate({
      prompt: userPromptFor(mode, bugReport),
    });

    const llmSteps = extractLlmSteps(result.steps);
    const claim = parseAgentClaim(result.text ?? "");

    // After-file contents + diff
    const diffs: FileDiff[] = [];
    for (const f of TRACKED_FILES) {
      const after = await readSandboxText(agentSandbox, f);
      const beforeContent = beforeFiles[f] ?? "";
      if (beforeContent !== after) {
        diffs.push({
          path: f.replace(/^buggy-pricing\//, ""),
          before: beforeContent,
          after,
          unifiedDiff: unifiedDiff(
            f.replace(/^buggy-pricing\//, ""),
            beforeContent,
            after,
          ),
        });
      }
    }

    // Agent's own final test run (self-reported; not verification).
    const agentTestsAfter = await runFixtureTests(agentSandbox, commandLog);

    // Snapshot AFTER the agent's work (stops this session).
    const after = await takeSnapshot(agentSandbox);
    afterSnapshotId = after.snapshotId;
    agentSandbox = null; // already stopped by snapshot()

    // Independent verification in a FRESH sandbox from the after-snapshot.
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
      architectureNotes: architectureNotes(mode, maxSteps),
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
      architectureNotes: architectureNotes(),
    };
    await saveReceipt(receipt);
    return receipt;
  }
}

function architectureNotes(mode?: DemoMode, maxSteps?: number): string[] {
  return [
    `Fixture workspace inside sandbox: ${WORKSPACE_ROOT}`,
    "LLM (AI SDK ToolLoopAgent) runs on the Next.js host via AI Gateway — not inside the sandbox.",
    "Sandbox tools: runCommand, readFile, writeFile (SDK from host).",
    "Verification: snapshot before → agent work → snapshot after → restore after into a fresh sandbox → re-run vitest.",
    mode
      ? `Mode=${mode}; stopWhen=isStepCount(${maxSteps ?? "?"}).`
      : "Mode unset.",
    "Caught-it mode uses a weaker prompt + tiny step budget so the agent claims FIXED without a correct fix; independent re-run fails.",
  ];
}
