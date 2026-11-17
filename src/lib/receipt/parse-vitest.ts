import type { TestCaseResult, TestSuiteResult, Unavailable } from "../types";

type VitestJson = {
  testResults?: Array<{
    name?: string;
    status?: string;
    assertionResults?: Array<{
      fullName?: string;
      title?: string;
      status?: string;
      duration?: number;
      failureMessages?: string[];
    }>;
  }>;
  numPassedTests?: number;
  numFailedTests?: number;
  numPendingTests?: number;
  numTotalTests?: number;
  success?: boolean;
};

function mapStatus(status: string | undefined): TestCaseResult["status"] {
  switch (status) {
    case "passed":
    case "failed":
    case "skipped":
    case "pending":
      return status === "pending" ? "skipped" : status;
    default:
      return "unknown";
  }
}

/**
 * A suite passes only when ALL of these hold:
 * - command exitCode === 0
 * - zero failed assertions
 * - json.success is not explicitly false (when present)
 * - at least one test case was parsed (avoids green-on-empty / stale-missing reports)
 *
 * A success:true report never overrides a nonzero exit code.
 */
export function parseVitestJson(
  raw: string | null | undefined,
  exitCode: number,
  stdout: string,
  stderr: string,
): TestSuiteResult {
  const unavailable: Unavailable = "unavailable";

  if (!raw) {
    return {
      passed: false,
      exitCode,
      stdout,
      stderr,
      tests: [],
      summary: {
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
      },
    };
  }

  try {
    const json = JSON.parse(raw) as VitestJson;
    const tests: TestCaseResult[] = [];

    for (const file of json.testResults ?? []) {
      for (const assertion of file.assertionResults ?? []) {
        tests.push({
          name: assertion.title ?? "unknown",
          fullName: assertion.fullName ?? assertion.title ?? "unknown",
          status: mapStatus(assertion.status),
          durationMs:
            typeof assertion.duration === "number"
              ? assertion.duration
              : unavailable,
          errorMessage: assertion.failureMessages?.join("\n") || undefined,
        });
      }
    }

    const passedCount =
      json.numPassedTests ?? tests.filter((t) => t.status === "passed").length;
    const failedCount =
      json.numFailedTests ?? tests.filter((t) => t.status === "failed").length;
    const skippedCount =
      json.numPendingTests ??
      tests.filter((t) => t.status === "skipped").length;
    const total =
      json.numTotalTests ?? passedCount + failedCount + skippedCount;

    const passed =
      exitCode === 0 &&
      failedCount === 0 &&
      json.success !== false &&
      tests.length > 0;

    return {
      passed,
      exitCode,
      stdout,
      stderr,
      tests,
      summary: {
        total,
        passed: passedCount,
        failed: failedCount,
        skipped: skippedCount,
      },
    };
  } catch {
    return {
      passed: false,
      exitCode,
      stdout,
      stderr,
      tests: [],
      summary: {
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
      },
    };
  }
}
