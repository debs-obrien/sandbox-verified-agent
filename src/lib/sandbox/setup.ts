import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Sandbox } from "@vercel/sandbox";
import {
  getSandboxCredentials,
  SANDBOX_TIMEOUT_MS,
  WORKSPACE_ROOT,
} from "../config";
import type { CommandLog } from "../types";
import { runLogged } from "./commands";
import { DENY_ALL_POLICY, NPM_INSTALL_POLICY } from "./network";

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
    ...(creds
      ? { token: creds.token, teamId: creds.teamId, projectId: creds.projectId }
      : {}),
  };
}

/**
 * Create a sandbox, copy the buggy-pricing fixture in, npm install with a
 * registry allow-list, then lock the network to deny-all for agent work.
 */
export async function createPreparedSandbox(commandLog: CommandLog[]): Promise<{
  sandbox: Sandbox;
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
    keepLastSnapshots: { count: 3, expiration: 60 * 60_000 },
  });

  await sandbox.mkDir("buggy-pricing");

  const files = await collectFiles(localFixture);
  // writeFiles paths are relative to /vercel/sandbox
  await sandbox.writeFiles(
    files.map((f) => ({
      path: `buggy-pricing/${f.relative}`,
      content: f.content,
    })),
  );

  const install = await runLogged(sandbox, {
    cmd: "npm",
    args: ["install"],
    cwd: WORKSPACE_ROOT,
    log: commandLog,
  });
  if (install.exitCode !== 0) {
    throw new Error(
      `npm install failed in sandbox:\n${install.stderr || install.stdout}`,
    );
  }

  // Lock down egress for the agent phase — model calls stay on the host.
  await sandbox.update({ networkPolicy: DENY_ALL_POLICY });

  return { sandbox, fixtureRoot: WORKSPACE_ROOT };
}

export async function createSandboxFromSnapshot(
  snapshotId: string,
): Promise<Sandbox> {
  return Sandbox.create({
    ...createOpts(),
    networkPolicy: DENY_ALL_POLICY,
    source: { type: "snapshot", snapshotId },
    persistent: false,
  });
}

export { createOpts };
