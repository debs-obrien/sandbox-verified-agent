import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Sandbox } from "@vercel/sandbox";
import {
  FIXTURE_DIRNAME,
  getSandboxCredentials,
  SANDBOX_TIMEOUT_MS,
  SNAPSHOT_EXPIRATION_MS,
} from "../config";
import type { CommandLog } from "../types";
import { runLogged } from "./commands";
import { DENY_ALL_POLICY, NPM_INSTALL_POLICY } from "./network";
import { ensureSandboxWorkspace } from "./paths";

async function collectFiles(
  dir: string,
  base = dir,
): Promise<Array<{ relative: string; content: Buffer }>> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: Array<{ relative: string; content: Buffer }> = [];

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.name === "node_modules" || entry.name === "vitest-results.json") {
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(full, base)));
    } else if (entry.isFile()) {
      const content = await readFile(full);
      files.push({
        relative: path.relative(base, full).replaceAll("\\", "/"),
        content,
      });
    }
  }
  return files;
}

function createOpts() {
  const creds = getSandboxCredentials();
  return {
    timeout: SANDBOX_TIMEOUT_MS,
    persistent: false as const,
    resources: { vcpus: 2 },
    // Snapshot TTL must be 0 (never) or >= 1 day per Sandbox API.
    snapshotExpiration: SNAPSHOT_EXPIRATION_MS,
    keepLastSnapshots: {
      count: 3,
      expiration: SNAPSHOT_EXPIRATION_MS,
    },
    ...(creds
      ? { token: creds.token, teamId: creds.teamId, projectId: creds.projectId }
      : {}),
  };
}

/**
 * Create a sandbox, ensure the workspace root exists, copy the fixture in,
 * npm install with a registry allow-list, then lock the network to deny-all.
 */
export async function createPreparedSandbox(commandLog: CommandLog[]): Promise<{
  sandbox: Sandbox;
  sandboxRoot: string;
  fixtureRoot: string;
}> {
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

  const files = await collectFiles(localFixture);
  // writeFiles paths are relative to the sandbox filesystem root.
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

  // Lock down egress for the agent phase — model calls stay on the host.
  await sandbox.update({ networkPolicy: DENY_ALL_POLICY });

  return { sandbox, sandboxRoot, fixtureRoot };
}

export async function createSandboxFromSnapshot(
  snapshotId: string,
  commandLog?: CommandLog[],
): Promise<{ sandbox: Sandbox; sandboxRoot: string; fixtureRoot: string }> {
  const sandbox = await Sandbox.create({
    ...createOpts(),
    networkPolicy: DENY_ALL_POLICY,
    source: { type: "snapshot", snapshotId },
    persistent: false,
  });

  const paths = await ensureSandboxWorkspace(sandbox, commandLog);
  return { sandbox, ...paths };
}

export { createOpts };
