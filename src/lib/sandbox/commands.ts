import type { Sandbox } from "@vercel/sandbox";
import { LOG_TRUNCATE_CHARS } from "../config";
import type { CommandLog } from "../types";

let commandCounter = 0;

export type RunLoggedOptions = {
  cmd: string;
  args?: string[];
  cwd?: string;
  sudo?: boolean;
  env?: Record<string, string>;
  log?: CommandLog[];
};

function truncate(text: string): { text: string; truncated: boolean } {
  if (text.length <= LOG_TRUNCATE_CHARS) {
    return { text, truncated: false };
  }
  return {
    text:
      text.slice(0, LOG_TRUNCATE_CHARS) +
      `\n…[truncated ${text.length - LOG_TRUNCATE_CHARS} chars]`,
    truncated: true,
  };
}

/**
 * Run a command in the sandbox and optionally append a CommandLog entry.
 * runCommand does not throw on non-zero exit — we always check exitCode.
 */
export async function runLogged(
  sandbox: Sandbox,
  options: RunLoggedOptions,
): Promise<{ exitCode: number; stdout: string; stderr: string; log: CommandLog }> {
  const args = options.args ?? [];
  const result = await sandbox.runCommand({
    cmd: options.cmd,
    args,
    cwd: options.cwd,
    sudo: options.sudo,
    env: options.env,
  });

  const rawStdout = await result.stdout();
  const rawStderr = await result.stderr();
  const out = truncate(rawStdout);
  const err = truncate(rawStderr);
  const truncated = out.truncated || err.truncated;

  const log: CommandLog = {
    id: `cmd-${++commandCounter}-${Date.now()}`,
    command: options.cmd,
    args,
    cwd: options.cwd,
    exitCode: result.exitCode,
    stdout: out.text,
    stderr: err.text,
    truncated,
    at: new Date().toISOString(),
  };

  options.log?.push(log);
  return {
    exitCode: result.exitCode,
    stdout: rawStdout,
    stderr: rawStderr,
    log,
  };
}

export function resetCommandCounter() {
  commandCounter = 0;
}
