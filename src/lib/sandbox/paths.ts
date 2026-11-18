import type { Sandbox } from "@vercel/sandbox";
import { FIXTURE_DIRNAME, PREFERRED_SANDBOX_ROOT } from "../config";
import { runLogged } from "./commands";
import type { CommandLog } from "../types";

/**
 * Ensure a writable workspace root exists inside the sandbox.
 * The universal image may not include `/vercel/sandbox` until we mkdir it.
 * Prefer the SDK's reported cwd when it is already absolute and usable.
 */
export async function ensureSandboxWorkspace(
  sandbox: Sandbox,
  commandLog?: CommandLog[],
): Promise<{ sandboxRoot: string; fixtureRoot: string }> {
  const reported = (sandbox.cwd || "").replace(/\/$/, "");
  const sandboxRoot =
    reported && reported !== "/" ? reported : PREFERRED_SANDBOX_ROOT;

  // Create preferred + reported roots so relative writeFiles and absolute cwd agree.
  const mkdir = await runLogged(sandbox, {
    cmd: "mkdir",
    args: ["-p", sandboxRoot, `${sandboxRoot}/${FIXTURE_DIRNAME}`],
    log: commandLog,
  });
  if (mkdir.exitCode !== 0) {
    throw new Error(
      `Failed to create sandbox workspace at ${sandboxRoot}: ${mkdir.stderr || mkdir.stdout}`,
    );
  }

  // Also ensure relative mkDir works for writeFiles rooted at the sandbox FS root.
  await sandbox.mkDir(FIXTURE_DIRNAME).catch(() => undefined);

  return {
    sandboxRoot,
    fixtureRoot: `${sandboxRoot}/${FIXTURE_DIRNAME}`,
  };
}

export function normalizeUnderSandboxRoot(
  p: string,
  sandboxRoot: string,
): string {
  const root = sandboxRoot.replace(/\/$/, "");
  let relative = p;
  if (relative.startsWith(root + "/")) {
    relative = relative.slice(root.length + 1);
  } else if (relative.startsWith(root)) {
    relative = relative.slice(root.length).replace(/^\//, "");
  } else if (relative.startsWith("/vercel/sandbox/")) {
    relative = relative.slice("/vercel/sandbox/".length);
  } else if (relative.startsWith("/vercel/sandbox")) {
    relative = relative.slice("/vercel/sandbox".length).replace(/^\//, "");
  }
  return relative.replace(/^\.\//, "").replaceAll("\\", "/");
}
