import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Sandbox } from "@vercel/sandbox";
import { FIXTURE_DIRNAME } from "../config";
import { parseVitestJson } from "../receipt/parse-vitest";
import type {
  CommandLog,
  TestCaseResult,
  TestSuiteResult,
  Unavailable,
} from "../types";
import { disposeSandboxQuietly } from "./cleanup";
import { runLogged } from "./commands";
import { createPreparedSandbox } from "./setup";

const UNAVAILABLE: Unavailable = "unavailable";
const RESULTS_REL = `${FIXTURE_DIRNAME}/vitest-results.json`;
const PRICING_REL = `${FIXTURE_DIRNAME}/src/pricing.ts`;

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

function splitVisibleHidden(tests: TestCaseResult[]): {
  visibleTests: TestCaseResult[];
  hiddenTests: TestCaseResult[];
} {
  const visibleTests: TestCaseResult[] = [];
  const hiddenTests: TestCaseResult[] = [];
  for (const t of tests) {
    const heldOut = /\(hidden\)/i.test(t.fullName) || /\(hidden\)/i.test(t.name);
    const tagged = { ...t, heldOut };
    if (heldOut) hiddenTests.push(tagged);
    else visibleTests.push(tagged);
  }
  return { visibleTests, hiddenTests };
}

/**
 * Independent verification the agent cannot touch:
 * fresh pristine fixture (including hidden tests) + agent's pricing.ts only.
 * No snapshots — avoids Hobby Snapshot Storage accumulation.
 *
 * Caller owns cleanup: dispose the returned sandbox only AFTER the evidence
 * pack is successfully written (see cleanupAfterEvidence).
 */
export async function independentVerify(
  agentPricingSource: string,
  commandLog: CommandLog[],
): Promise<{
  tests: TestSuiteResult;
  visibleTests: TestCaseResult[];
  hiddenTests: TestCaseResult[];
  verificationSandboxId: string;
  hiddenTestSource: string;
  /** Live verify sandbox — dispose via cleanupAfterEvidence after pack write. */
  sandbox: Sandbox;
}> {
  const prepared = await createPreparedSandbox(commandLog, {
    includeHiddenTests: true,
  });
  const { sandbox: verifyBox, fixtureRoot } = prepared;

  try {
    await verifyBox.writeFiles([
      {
        path: PRICING_REL,
        content: Buffer.from(agentPricingSource, "utf8"),
      },
    ]);

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
    const { visibleTests, hiddenTests } = splitVisibleHidden(tests.tests);

    const hiddenTestSource = await readFile(
      path.join(
        process.cwd(),
        "fixtures/buggy-pricing/src/pricing.hidden.test.ts",
      ),
      "utf8",
    );

    return {
      tests,
      visibleTests,
      hiddenTests,
      verificationSandboxId: verifyBox.name || UNAVAILABLE,
      hiddenTestSource,
      sandbox: verifyBox,
    };
  } catch (err) {
    // On verify failure before return, still hand sandbox back via throw path:
    // dispose best-effort so we do not leak if caller never gets the handle.
    await disposeSandboxQuietly(verifyBox, { deleteOrphanSnapshots: false });
    throw err;
  }
}

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

export async function readAgentPricing(sandbox: Sandbox): Promise<string> {
  const buf = await sandbox.readFileToBuffer({ path: PRICING_REL });
  if (!buf) throw new Error("Agent pricing.ts missing after run");
  return buf.toString("utf8");
}

export { UNAVAILABLE, PRICING_REL };
