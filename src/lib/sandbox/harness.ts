import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Sandbox } from "@vercel/sandbox";

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
  "src/pricing.test.ts",
] as const;

/** Only this implementation file may be written by the agent. */
export const ALLOWED_WRITE_PATHS = new Set([
  "buggy-pricing/src/pricing.ts",
  "src/pricing.ts",
]);

export function normalizeSandboxPath(p: string): string {
  const prefix = "/vercel/sandbox/";
  let relative = p;
  if (relative.startsWith(prefix)) relative = relative.slice(prefix.length);
  else if (relative.startsWith("/vercel/sandbox")) {
    relative = relative.slice("/vercel/sandbox".length).replace(/^\//, "");
  }
  relative = relative.replace(/^\.\//, "");
  return relative.replaceAll("\\", "/");
}

export function isAllowedWritePath(p: string): boolean {
  const relative = normalizeSandboxPath(p);
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
    files.push({ path: `buggy-pricing/${rel}`, content });
    restored.push(rel);
  }

  await sandbox.writeFiles(files);
  return restored;
}
