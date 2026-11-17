import type { Sandbox } from "@vercel/sandbox";
import { WORKSPACE_ROOT } from "../config";
import { parseVitestJson } from "../receipt/parse-vitest";
import type { CommandLog, TestSuiteResult, Unavailable } from "../types";
import { runLogged } from "./commands";
import { restoreTrustedHarness } from "./harness";
import { createSandboxFromSnapshot } from "./setup";

const UNAVAILABLE: Unavailable = "unavailable";
const RESULTS_PATH = "buggy-pricing/vitest-results.json";

/**
 * Snapshot the current sandbox filesystem. Note: snapshot() stops the session.
 */
export async function takeSnapshot(
  sandbox: Sandbox,
): Promise<{ snapshotId: string }> {
  const snap = await sandbox.snapshot({
    expiration: 60 * 60_000,
  });
  return { snapshotId: snap.snapshotId };
}

async function clearStaleResults(sandbox: Sandbox): Promise<void> {
  // Empty / missing report forces a fresh parse; never reuse a prior JSON file.
  await sandbox.writeFiles([
    { path: RESULTS_PATH, content: Buffer.from("", "utf8") },
  ]);
}

async function readFreshResults(
  sandbox: Sandbox,
): Promise<string | null> {
  const buf = await sandbox.readFileToBuffer({ path: RESULTS_PATH });
  const text = buf?.toString("utf8")?.trim() ?? "";
  return text.length > 0 ? text : null;
}

/**
 * Restore the after-snapshot into a FRESH sandbox, reinstall trust in the
 * test harness from the host fixture, then re-run Vitest. Agent edits to
 * tests/config/lockfile cannot survive into the verification evidence.
 */
export async function independentVerify(
  afterSnapshotId: string,
  commandLog: CommandLog[],
): Promise<{
  tests: TestSuiteResult;
  verificationSandboxId: string;
  restoredHarness: string[];
}> {
  const verifyBox = await createSandboxFromSnapshot(afterSnapshotId);

  try {
    const restoredHarness = await restoreTrustedHarness(verifyBox);
    await clearStaleResults(verifyBox);

    const run = await runLogged(verifyBox, {
      cmd: "npm",
      args: ["test"],
      cwd: WORKSPACE_ROOT,
      log: commandLog,
    });

    const jsonText = await readFreshResults(verifyBox);
    const tests = parseVitestJson(
      jsonText,
      run.exitCode,
      run.stdout,
      run.stderr,
    );

    return {
      tests,
      verificationSandboxId: verifyBox.name || UNAVAILABLE,
      restoredHarness,
    };
  } finally {
    await verifyBox.stop().catch(() => undefined);
  }
}

/**
 * Run tests in the agent's sandbox (self-check). Not used as verification.
 */
export async function runFixtureTests(
  sandbox: Sandbox,
  commandLog: CommandLog[],
): Promise<TestSuiteResult> {
  await clearStaleResults(sandbox);

  const run = await runLogged(sandbox, {
    cmd: "npm",
    args: ["test"],
    cwd: WORKSPACE_ROOT,
    log: commandLog,
  });

  const jsonText = await readFreshResults(sandbox);
  return parseVitestJson(jsonText, run.exitCode, run.stdout, run.stderr);
}

export { UNAVAILABLE };
