import { tool } from "ai";
import type { Sandbox } from "@vercel/sandbox";
import { z } from "zod";
import type { CommandLog } from "../types";
import { runLogged } from "../sandbox/commands";
import { isAllowedWritePath, normalizeSandboxPath } from "../sandbox/harness";

/**
 * Agent tools that operate on a Vercel Sandbox from the host process.
 * The LLM never runs inside the sandbox — only its file/command effects do.
 *
 * writeFile is restricted to the implementation file; independent verification
 * also restores a pristine test harness from the host fixture.
 */
export function createSandboxTools(
  sandbox: Sandbox,
  commandLog: CommandLog[],
) {
  return {
    runCommand: tool({
      description:
        "Run a command inside the sandbox (no shell unless you invoke bash -c). Check exit codes yourself. Prefer `npm test` in /vercel/sandbox/buggy-pricing.",
      inputSchema: z.object({
        cmd: z.string().describe("Binary to run, e.g. npm or bash"),
        args: z
          .array(z.string())
          .optional()
          .describe("Arguments array (no shell globs)"),
        cwd: z
          .string()
          .optional()
          .describe("Working directory, prefer /vercel/sandbox/buggy-pricing"),
      }),
      execute: async ({ cmd, args, cwd }) => {
        const result = await runLogged(sandbox, {
          cmd,
          args: args ?? [],
          cwd,
          log: commandLog,
        });
        return {
          exitCode: result.exitCode,
          stdout: truncate(result.stdout, 6_000),
          stderr: truncate(result.stderr, 6_000),
        };
      },
    }),

    readFile: tool({
      description: "Read a UTF-8 text file from the sandbox filesystem.",
      inputSchema: z.object({
        path: z
          .string()
          .describe(
            "Path relative to /vercel/sandbox or absolute under /vercel/sandbox",
          ),
      }),
      execute: async ({ path: filePath }) => {
        const relative = normalizeSandboxPath(filePath);
        const buf = await sandbox.readFileToBuffer({ path: relative });
        if (!buf) {
          return { ok: false as const, error: `File not found: ${relative}` };
        }
        const text = buf.toString("utf8");
        return {
          ok: true as const,
          path: relative,
          content: truncate(text, 20_000),
        };
      },
    }),

    writeFile: tool({
      description:
        "Write the pricing implementation file only (buggy-pricing/src/pricing.ts). Other paths are rejected so the agent cannot rewrite the test harness.",
      inputSchema: z.object({
        path: z
          .string()
          .describe("Must resolve to buggy-pricing/src/pricing.ts"),
        content: z.string().describe("Full file contents to write"),
      }),
      execute: async ({ path: filePath, content }) => {
        const relative = normalizeSandboxPath(filePath);
        if (!isAllowedWritePath(relative)) {
          return {
            ok: false as const,
            error: `writeFile denied for ${relative}. Only buggy-pricing/src/pricing.ts is writable.`,
          };
        }
        const target = "buggy-pricing/src/pricing.ts";
        await sandbox.writeFiles([
          { path: target, content: Buffer.from(content, "utf8") },
        ]);
        return { ok: true as const, path: target, bytes: content.length };
      },
    }),
  };
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + `\n…[truncated ${s.length - n} chars]`;
}
