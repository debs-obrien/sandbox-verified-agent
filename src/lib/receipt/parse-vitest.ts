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
 * Parse Vitest JSON reporter output into a stable TestSuiteResult.
 * Falls back to exit-code-only summary when JSON is missing/malformed.
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
      passed: exitCode === 0,
      exitCode,
      stdout,
      stderr,
      tests: [],
      summary: {
        total: 0,
        passed: exitCode === 0 ? 0 : 0,
        failed: exitCode === 0 ? 0 : 0,
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

    return {
      passed: json.success === true || (exitCode === 0 && failedCount === 0),
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
      passed: exitCode === 0,
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
