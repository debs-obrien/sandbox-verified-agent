import type { Sandbox } from "@vercel/sandbox";
import { WORKSPACE_ROOT } from "../config";
import { parseVitestJson } from "../receipt/parse-vitest";
import type { CommandLog, TestSuiteResult, Unavailable } from "../types";
import { runLogged } from "./commands";
import { createSandboxFromSnapshot } from "./setup";

const UNAVAILABLE: Unavailable = "unavailable";

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

/**
 * Restore the after-snapshot into a FRESH sandbox and re-run the full test
 * suite independently of the agent. This is the verification half of the demo.
 */
export async function independentVerify(
  afterSnapshotId: string,
  commandLog: CommandLog[],
): Promise<{
  tests: TestSuiteResult;
  verificationSandboxId: string;
}> {
  const verifyBox = await createSandboxFromSnapshot(afterSnapshotId);

  try {
    const run = await runLogged(verifyBox, {
      cmd: "npm",
      args: ["test"],
      cwd: WORKSPACE_ROOT,
      log: commandLog,
    });

    // Vitest JSON reporter writes vitest-results.json in the fixture cwd.
    const buf = await verifyBox.readFileToBuffer({
      path: "buggy-pricing/vitest-results.json",
    });
    const jsonText = buf?.toString("utf8") ?? null;

    const tests = parseVitestJson(
      jsonText,
      run.exitCode,
      run.stdout,
      run.stderr,
    );

    return {
      tests,
      verificationSandboxId: verifyBox.name || UNAVAILABLE,
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
  const run = await runLogged(sandbox, {
    cmd: "npm",
    args: ["test"],
    cwd: WORKSPACE_ROOT,
    log: commandLog,
  });

  const buf = await sandbox.readFileToBuffer({
    path: "buggy-pricing/vitest-results.json",
  });
  const jsonText = buf?.toString("utf8") ?? null;

  return parseVitestJson(jsonText, run.exitCode, run.stdout, run.stderr);
}

export { UNAVAILABLE };
