import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Sandbox } from "@vercel/sandbox";
import { FIXTURE_DIRNAME } from "../config";

/**
 * Trusted harness paths restored before independent verification.
 * The agent may edit pricing.ts; everything else must match the repo fixture.
 */
export const TRUSTED_HARNESS_FILES = [
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "vitest.config.ts",
  "BUG_REPORT.md",
  "src/pricing.visible.test.ts",
  "src/pricing.hidden.test.ts",
] as const;

/** Only this implementation file may be written by the agent. */
export const ALLOWED_WRITE_PATHS = new Set([
  `${FIXTURE_DIRNAME}/src/pricing.ts`,
  "src/pricing.ts",
]);

export function normalizeSandboxPath(p: string, sandboxRoot?: string): string {
  let relative = p;
  const roots = [
    sandboxRoot,
    "/vercel/sandbox",
  ].filter(Boolean) as string[];

  for (const root of roots) {
    const prefix = root.replace(/\/$/, "");
    if (relative.startsWith(prefix + "/")) {
      relative = relative.slice(prefix.length + 1);
      break;
    }
    if (relative.startsWith(prefix)) {
      relative = relative.slice(prefix.length).replace(/^\//, "");
      break;
    }
  }

  return relative.replace(/^\.\//, "").replaceAll("\\", "/");
}

export function isAllowedWritePath(p: string, sandboxRoot?: string): boolean {
  const relative = normalizeSandboxPath(p, sandboxRoot);
  return ALLOWED_WRITE_PATHS.has(relative);
}

/**
 * Overwrite harness files in the sandbox with pristine copies from the host
 * fixture so agent-tampered tests/config/lockfile cannot fake a pass.
 */
export async function restoreTrustedHarness(sandbox: Sandbox): Promise<string[]> {
  const localFixture = path.join(process.cwd(), "fixtures", "buggy-pricing");
  const restored: string[] = [];
  const files: Array<{ path: string; content: Buffer }> = [];

  for (const rel of TRUSTED_HARNESS_FILES) {
    const content = await readFile(path.join(localFixture, rel));
    files.push({ path: `${FIXTURE_DIRNAME}/${rel}`, content });
    restored.push(rel);
  }

  await sandbox.writeFiles(files);
  return restored;
}
