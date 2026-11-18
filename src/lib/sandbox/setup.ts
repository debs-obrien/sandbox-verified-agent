import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Sandbox } from "@vercel/sandbox";
import {
  FIXTURE_DIRNAME,
  getSandboxCredentials,
  SANDBOX_TIMEOUT_MS,
} from "../config";
import type { CommandLog, DemoMode } from "../types";
import { runLogged } from "./commands";
import { DENY_ALL_POLICY, NPM_INSTALL_POLICY } from "./network";
import { ensureSandboxWorkspace } from "./paths";

const HIDDEN_TEST_SUFFIX = ".hidden.test.ts";

async function collectFiles(
  dir: string,
  base = dir,
  opts?: { excludeHiddenTests?: boolean },
): Promise<Array<{ relative: string; content: Buffer }>> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: Array<{ relative: string; content: Buffer }> = [];

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.name === "node_modules" || entry.name === "vitest-results.json") {
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(full, base, opts)));
    } else if (entry.isFile()) {
      const relative = path.relative(base, full).replaceAll("\\", "/");
      if (opts?.excludeHiddenTests && relative.endsWith(HIDDEN_TEST_SUFFIX)) {
        continue;
      }
      const content = await readFile(full);
      files.push({ relative, content });
    }
  }
  return files;
}

/**
 * Ephemeral sandboxes only — no snapshot retention policy.
 * Demo verification is pristine+diff and does not need snapshots.
 * If a future call still snapshots, keep at most one and delete the rest.
 */
function createOpts() {
  const creds = getSandboxCredentials();
  return {
    timeout: SANDBOX_TIMEOUT_MS,
    persistent: false as const,
    resources: { vcpus: 2 },
    // Safety net only: if anything snapshots this sandbox, keep ≤1 and delete older.
    keepLastSnapshots: {
      count: 1,
      deleteEvicted: true,
    },
    ...(creds
      ? { token: creds.token, teamId: creds.teamId, projectId: creds.projectId }
      : {}),
  };
}

export type PreparedSandbox = {
  sandbox: Sandbox;
  sandboxRoot: string;
  fixtureRoot: string;
};

/**
 * Create a sandbox, copy the fixture (optionally omitting hidden tests),
 * npm install, then deny-all for agent work.
 */
export async function createPreparedSandbox(
  commandLog: CommandLog[],
  opts?: { mode?: DemoMode; includeHiddenTests?: boolean },
): Promise<PreparedSandbox> {
  const mode = opts?.mode ?? "normal";
  const includeHiddenTests = opts?.includeHiddenTests ?? mode === "normal";

  const localFixture = path.join(process.cwd(), "fixtures", "buggy-pricing");
  const st = await stat(localFixture);
  if (!st.isDirectory()) {
    throw new Error(`Fixture missing at ${localFixture}`);
  }

  const sandbox = await Sandbox.create({
    ...createOpts(),
    networkPolicy: NPM_INSTALL_POLICY,
  });

  const { sandboxRoot, fixtureRoot } = await ensureSandboxWorkspace(
    sandbox,
    commandLog,
  );

  const files = await collectFiles(localFixture, localFixture, {
    excludeHiddenTests: !includeHiddenTests,
  });

  await sandbox.writeFiles(
    files.map((f) => ({
      path: `${FIXTURE_DIRNAME}/${f.relative}`,
      content: f.content,
    })),
  );

  const install = await runLogged(sandbox, {
    cmd: "npm",
    args: ["install"],
    cwd: fixtureRoot,
    log: commandLog,
  });
  if (install.exitCode !== 0) {
    throw new Error(
      `npm install failed in sandbox:\n${install.stderr || install.stdout}`,
    );
  }

  await sandbox.update({ networkPolicy: DENY_ALL_POLICY });

  return { sandbox, sandboxRoot, fixtureRoot };
}

export async function createSandboxFromSnapshot(
  snapshotId: string,
  commandLog?: CommandLog[],
): Promise<PreparedSandbox> {
  const sandbox = await Sandbox.create({
    ...createOpts(),
    networkPolicy: DENY_ALL_POLICY,
    source: { type: "snapshot", snapshotId },
    persistent: false,
  });

  const paths = await ensureSandboxWorkspace(sandbox, commandLog);
  return { sandbox, ...paths };
}

export { createOpts, HIDDEN_TEST_SUFFIX };
