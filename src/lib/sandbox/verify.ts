import type { Sandbox } from "@vercel/sandbox";
import { FIXTURE_DIRNAME, SNAPSHOT_EXPIRATION_MS } from "../config";
import { parseVitestJson } from "../receipt/parse-vitest";
import type { CommandLog, TestSuiteResult, Unavailable } from "../types";
import { runLogged } from "./commands";
import { restoreTrustedHarness } from "./harness";
import { createSandboxFromSnapshot } from "./setup";

const UNAVAILABLE: Unavailable = "unavailable";
const RESULTS_REL = `${FIXTURE_DIRNAME}/vitest-results.json`;

/**
 * Snapshot the current sandbox filesystem. Note: snapshot() stops the session.
 * Expiration must be 0 (never) or >= 1 day.
 */
export async function takeSnapshot(
  sandbox: Sandbox,
): Promise<{ snapshotId: string }> {
  const snap = await sandbox.snapshot({
    expiration: SNAPSHOT_EXPIRATION_MS,
  });
  return { snapshotId: snap.snapshotId };
}

async function clearStaleResults(sandbox: Sandbox): Promise<void> {
  await sandbox.writeFiles([
    { path: RESULTS_REL, content: Buffer.from("", "utf8") },
  ]);
}

async function readFreshResults(sandbox: Sandbox): Promise<string | null> {
  const buf = await sandbox.readFileToBuffer({ path: RESULTS_REL });
  const text = buf?.toString("utf8")?.trim() ?? "";
  return text.length > 0 ? text : null;
}

/**
 * Restore the after-snapshot into a FRESH sandbox, restore the trusted
 * harness from the host fixture, then re-run Vitest.
 */
export async function independentVerify(
  afterSnapshotId: string,
  commandLog: CommandLog[],
): Promise<{
  tests: TestSuiteResult;
  verificationSandboxId: string;
  restoredHarness: string[];
}> {
  const { sandbox: verifyBox, fixtureRoot } = await createSandboxFromSnapshot(
    afterSnapshotId,
    commandLog,
  );

  try {
    const restoredHarness = await restoreTrustedHarness(verifyBox);
    await clearStaleResults(verifyBox);

    const run = await runLogged(verifyBox, {
      cmd: "npm",
      args: ["test"],
      cwd: fixtureRoot,
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
  fixtureRoot: string,
  commandLog: CommandLog[],
): Promise<TestSuiteResult> {
  await clearStaleResults(sandbox);

  const run = await runLogged(sandbox, {
    cmd: "npm",
    args: ["test"],
    cwd: fixtureRoot,
    log: commandLog,
  });

  const jsonText = await readFreshResults(sandbox);
  return parseVitestJson(jsonText, run.exitCode, run.stdout, run.stderr);
}

export { UNAVAILABLE };
