import { createHash } from "node:crypto";
import type {
  AgentClaim,
  CommandLog,
  DemoMode,
  EvidenceArtifactMeta,
  EvidencePack,
  EvidencePackMeta,
  FileDiff,
  LlmStepLog,
  Receipt,
  ReceiptTotals,
  SnapshotCleanupEntry,
  TestCaseResult,
  TestSuiteResult,
  Unavailable,
  Verdict,
} from "../types";

export const EVIDENCE_PACK_VERSION = 1 as const;

/** Paths inside the pack (manifest keys). */
export const EVIDENCE_ARTIFACT_PATHS = {
  meta: "meta.json",
  claim: "claim.json",
  totals: "llm/totals.json",
  steps: "llm/steps.json",
  independentSuite: "tests/independent.json",
  independentStdout: "tests/independent.stdout.txt",
  independentStderr: "tests/independent.stderr.txt",
  agentSuite: "tests/agent.json",
  agentStdout: "tests/agent.stdout.txt",
  agentStderr: "tests/agent.stderr.txt",
  hiddenSource: "hidden-tests/pricing.hidden.test.ts",
  sandboxes: "sandboxes.json",
  snapshots: "snapshots.json",
  cleanup: "cleanup-log.json",
  commands: "commands.json",
  notes: "notes.json",
} as const;

const SECRET_PATTERNS: RegExp[] = [
  /Bearer\s+[A-Za-z0-9._\-]+/gi,
  /(?:AI_GATEWAY_API_KEY|BLOB_READ_WRITE_TOKEN|VERCEL_OIDC_TOKEN|VERCEL_TOKEN|RUN_SECRET|OIDC)[=:\s]+[^\s"',}]+/gi,
  /x-vercel-oidc-token[=:\s]+[^\s"',}]+/gi,
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
];

/** Strip credential-shaped strings from evidence text. */
export function scrubSecrets(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, "[REDACTED]");
  }
  return out;
}

function scrubJson<T>(value: T): T {
  return JSON.parse(scrubSecrets(JSON.stringify(value))) as T;
}

export function sha256Utf8(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function artifact(
  path: string,
  content: string,
): { path: string; content: string; meta: EvidenceArtifactMeta } {
  const safe = scrubSecrets(content);
  return {
    path,
    content: safe,
    meta: {
      path,
      sha256: sha256Utf8(safe),
      bytes: Buffer.byteLength(safe, "utf8"),
    },
  };
}

function jsonArtifact(path: string, value: unknown) {
  return artifact(path, `${JSON.stringify(value, null, 2)}\n`);
}

export type BuildEvidencePackInput = {
  receiptId: string;
  mode: DemoMode;
  createdAt: string;
  finishedAt?: string;
  verdict: Verdict;
  modelConfigured: string;
  claim: AgentClaim;
  diffs: FileDiff[];
  agentTests?: TestSuiteResult;
  independentTests: TestSuiteResult;
  visibleTests: TestCaseResult[];
  hiddenTests: TestCaseResult[];
  hiddenTestSource?: string;
  llmSteps: LlmStepLog[];
  totals: ReceiptTotals;
  commands: CommandLog[];
  agentSandboxId: string | Unavailable;
  verificationSandboxId: string | Unavailable;
  /** Snapshot ids observed before cleanup (usually empty — we don't create snaps). */
  snapshotsCreated: Array<{
    snapshotId: string;
    sandboxId?: string;
    createdAt?: string;
    sizeBytes?: number;
  }>;
  /** Filled after cleanup; may be empty at first build, then updated. */
  cleanupLog: SnapshotCleanupEntry[];
  networkPolicyNotes: string[];
  architectureNotes: string[];
};

/**
 * Build a tamper-evident evidence pack: discrete artifacts + sha256 manifest.
 * Snapshots (~800 MiB FS images) are not evidence; this pack is.
 */
export function buildEvidencePack(input: BuildEvidencePackInput): EvidencePack {
  const parts: Array<{ path: string; content: string; meta: EvidenceArtifactMeta }> =
    [];

  const metaBody = {
    version: EVIDENCE_PACK_VERSION,
    receiptId: input.receiptId,
    mode: input.mode,
    createdAt: input.createdAt,
    finishedAt: input.finishedAt,
    verdict: input.verdict,
    modelConfigured: input.modelConfigured,
    purpose:
      "Durable proof of the agent run. Sandbox filesystem snapshots are deleted after this pack is written (Hobby Snapshot Storage is limited); the receipt + evidence pack are the retained record.",
    excludes:
      "No environment variables, API tokens, OIDC values, or Blob credentials.",
  };
  parts.push(jsonArtifact(EVIDENCE_ARTIFACT_PATHS.meta, metaBody));
  parts.push(jsonArtifact(EVIDENCE_ARTIFACT_PATHS.claim, scrubJson(input.claim)));

  for (const d of input.diffs) {
    parts.push(
      artifact(`files/${d.path}`, scrubSecrets(d.after)),
      artifact(`diffs/${d.path}.diff`, scrubSecrets(d.unifiedDiff)),
      artifact(`files-before/${d.path}`, scrubSecrets(d.before)),
    );
  }

  parts.push(
    jsonArtifact(EVIDENCE_ARTIFACT_PATHS.independentSuite, {
      suite: scrubJson(input.independentTests),
      visibleTests: scrubJson(input.visibleTests),
      hiddenTests: scrubJson(input.hiddenTests),
    }),
  );
  parts.push(
    artifact(
      EVIDENCE_ARTIFACT_PATHS.independentStdout,
      input.independentTests.stdout ?? "",
    ),
  );
  parts.push(
    artifact(
      EVIDENCE_ARTIFACT_PATHS.independentStderr,
      input.independentTests.stderr ?? "",
    ),
  );

  if (input.agentTests) {
    parts.push(
      jsonArtifact(EVIDENCE_ARTIFACT_PATHS.agentSuite, scrubJson(input.agentTests)),
    );
    parts.push(
      artifact(
        EVIDENCE_ARTIFACT_PATHS.agentStdout,
        input.agentTests.stdout ?? "",
      ),
    );
    parts.push(
      artifact(
        EVIDENCE_ARTIFACT_PATHS.agentStderr,
        input.agentTests.stderr ?? "",
      ),
    );
  }

  if (input.hiddenTestSource) {
    parts.push(
      artifact(
        EVIDENCE_ARTIFACT_PATHS.hiddenSource,
        input.hiddenTestSource,
      ),
    );
  }

  parts.push(
    jsonArtifact(EVIDENCE_ARTIFACT_PATHS.steps, scrubJson(input.llmSteps)),
  );
  parts.push(
    jsonArtifact(EVIDENCE_ARTIFACT_PATHS.totals, scrubJson(input.totals)),
  );
  parts.push(
    jsonArtifact(EVIDENCE_ARTIFACT_PATHS.sandboxes, {
      agentSandboxId: input.agentSandboxId,
      verificationSandboxId: input.verificationSandboxId,
    }),
  );
  parts.push(
    jsonArtifact(EVIDENCE_ARTIFACT_PATHS.snapshots, {
      created: input.snapshotsCreated,
      note:
        "This demo does not create before/after snapshots. Any ids listed were observed on the sandbox before dispose (usually none).",
    }),
  );
  parts.push(
    jsonArtifact(EVIDENCE_ARTIFACT_PATHS.cleanup, scrubJson(input.cleanupLog)),
  );
  parts.push(
    jsonArtifact(EVIDENCE_ARTIFACT_PATHS.commands, scrubJson(input.commands)),
  );
  parts.push(
    jsonArtifact(EVIDENCE_ARTIFACT_PATHS.notes, {
      networkPolicyNotes: input.networkPolicyNotes,
      architectureNotes: input.architectureNotes,
    }),
  );

  const artifacts: Record<string, string> = {};
  const manifestArtifacts: EvidenceArtifactMeta[] = [];
  for (const p of parts) {
    artifacts[p.path] = p.content;
    manifestArtifacts.push(p.meta);
  }

  const pack: EvidencePack = {
    version: EVIDENCE_PACK_VERSION,
    receiptId: input.receiptId,
    mode: input.mode,
    createdAt: input.createdAt,
    finishedAt: input.finishedAt,
    verdict: input.verdict,
    manifest: {
      algorithm: "sha256",
      createdAt: new Date().toISOString(),
      artifacts: manifestArtifacts,
    },
    artifacts,
  };

  return pack;
}

/** Recompute hashes and verify every artifact matches the manifest. */
export function verifyEvidencePackIntegrity(pack: EvidencePack): {
  ok: boolean;
  mismatches: string[];
} {
  const mismatches: string[] = [];
  for (const meta of pack.manifest.artifacts) {
    const content = pack.artifacts[meta.path];
    if (content === undefined) {
      mismatches.push(`${meta.path}: missing`);
      continue;
    }
    const hash = sha256Utf8(content);
    const bytes = Buffer.byteLength(content, "utf8");
    if (hash !== meta.sha256) {
      mismatches.push(`${meta.path}: sha256 mismatch`);
    }
    if (bytes !== meta.bytes) {
      mismatches.push(`${meta.path}: bytes mismatch`);
    }
  }
  for (const path of Object.keys(pack.artifacts)) {
    if (!pack.manifest.artifacts.some((a) => a.path === path)) {
      mismatches.push(`${path}: not in manifest`);
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}

export function evidencePackBytes(pack: EvidencePack): number {
  return Buffer.byteLength(JSON.stringify(pack), "utf8");
}

export function evidencePackMetaFromWritten(args: {
  pathname: string;
  pack: EvidencePack;
  writtenAt: string;
}): EvidencePackMeta {
  const json = JSON.stringify(args.pack);
  return {
    status: "written",
    pathname: args.pathname,
    bytes: Buffer.byteLength(json, "utf8"),
    sha256: sha256Utf8(json),
    writtenAt: args.writtenAt,
    artifactCount: args.pack.manifest.artifacts.length,
    artifacts: args.pack.manifest.artifacts,
  };
}

export function evidencePackMetaFailed(error: string): EvidencePackMeta {
  return {
    status: "failed",
    error,
    writtenAt: new Date().toISOString(),
  };
}

/** Attach cleanup log into pack artifacts + remanifest (after dispose). */
export function withUpdatedCleanupLog(
  pack: EvidencePack,
  cleanupLog: SnapshotCleanupEntry[],
): EvidencePack {
  const content = `${JSON.stringify(scrubJson(cleanupLog), null, 2)}\n`;
  const path = EVIDENCE_ARTIFACT_PATHS.cleanup;
  const meta = {
    path,
    sha256: sha256Utf8(content),
    bytes: Buffer.byteLength(content, "utf8"),
  };
  const artifacts = { ...pack.artifacts, [path]: content };
  const manifestArtifacts = pack.manifest.artifacts.map((a) =>
    a.path === path ? meta : a,
  );
  if (!manifestArtifacts.some((a) => a.path === path)) {
    manifestArtifacts.push(meta);
  }
  return {
    ...pack,
    artifacts,
    manifest: {
      ...pack.manifest,
      createdAt: new Date().toISOString(),
      artifacts: manifestArtifacts,
    },
  };
}

/** Build pack input fields from a finished receipt (+ optional cleanup). */
export function buildEvidencePackFromReceipt(
  receipt: Receipt,
  extras?: {
    cleanupLog?: SnapshotCleanupEntry[];
    snapshotsCreated?: BuildEvidencePackInput["snapshotsCreated"];
    agentSandboxId?: string | Unavailable;
  },
): EvidencePack {
  return buildEvidencePack({
    receiptId: receipt.id,
    mode: receipt.mode,
    createdAt: receipt.createdAt,
    finishedAt: receipt.finishedAt,
    verdict: receipt.verdict,
    modelConfigured: receipt.modelConfigured,
    claim: receipt.agentClaim,
    diffs: receipt.diffs,
    agentTests: receipt.agentTests,
    independentTests: receipt.verification.independentTests,
    visibleTests: receipt.verification.visibleTests,
    hiddenTests: receipt.verification.hiddenTests,
    hiddenTestSource: receipt.hiddenTestSource,
    llmSteps: receipt.llmSteps,
    totals: receipt.totals,
    commands: receipt.commands,
    agentSandboxId:
      extras?.agentSandboxId ?? receipt.agentSandboxId ?? "unavailable",
    verificationSandboxId: receipt.verification.verificationSandboxId,
    snapshotsCreated: extras?.snapshotsCreated ?? [],
    cleanupLog: extras?.cleanupLog ?? receipt.cleanupLog ?? [],
    networkPolicyNotes: receipt.networkPolicyNotes,
    architectureNotes: receipt.architectureNotes,
  });
}
