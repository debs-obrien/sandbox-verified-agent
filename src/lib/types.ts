/** Shared receipt / run types for the sandbox-verified-agent demo. */

export type DemoMode = "normal" | "caught";

export type Unavailable = "unavailable";

export type CommandLog = {
  id: string;
  command: string;
  args: string[];
  cwd?: string;
  exitCode: number | Unavailable;
  stdout: string;
  stderr: string;
  truncated: boolean;
  at: string;
};

export type LlmStepLog = {
  stepNumber: number;
  /** Model id as returned by the SDK / Gateway, or unavailable. */
  modelId: string | Unavailable;
  /** Resolved provider from Gateway routing metadata, or unavailable. */
  provider: string | Unavailable;
  /** Canonical slug from Gateway routing, or unavailable. */
  canonicalSlug: string | Unavailable;
  /** Generation id for Gateway lookup, or unavailable. */
  generationId: string | Unavailable;
  /** Prompt tokens from usage, or unavailable. */
  inputTokens: number | Unavailable;
  /** Completion tokens from usage, or unavailable. */
  outputTokens: number | Unavailable;
  /** Total tokens from usage, or unavailable. */
  totalTokens: number | Unavailable;
  /**
   * Cost as a decimal USD string from providerMetadata.gateway.cost,
   * or unavailable when Gateway did not return it.
   */
  costUsd: string | Unavailable;
  finishReason: string | Unavailable;
  textPreview: string;
  toolCalls: Array<{ toolName: string; inputPreview: string }>;
  notes: string[];
};

export type TestCaseResult = {
  name: string;
  fullName: string;
  status: "passed" | "failed" | "skipped" | "unknown";
  durationMs: number | Unavailable;
  errorMessage?: string;
};

export type TestSuiteResult = {
  passed: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  tests: TestCaseResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
};

export type AgentClaim = {
  claimedFixed: boolean;
  summary: string;
  rawText: string;
};

export type VerificationResult = {
  /** Independent re-run in a fresh sandbox restored from the after-snapshot. */
  independentTests: TestSuiteResult;
  /** Whether independent verification agrees the bug is fixed. */
  verified: boolean;
  beforeSnapshotId: string | Unavailable;
  afterSnapshotId: string | Unavailable;
  /** Sandbox name (SDK has no separate sandboxId getter). */
  verificationSandboxId: string | Unavailable;
};

export type FileDiff = {
  path: string;
  before: string;
  after: string;
  unifiedDiff: string;
};

export type ReceiptTotals = {
  inputTokens: number | Unavailable;
  outputTokens: number | Unavailable;
  totalTokens: number | Unavailable;
  /** Sum of per-step costs when every step has a numeric cost; else unavailable. */
  costUsd: string | Unavailable;
  stepsWithCost: number;
  stepsMissingCost: number;
};

export type Receipt = {
  id: string;
  createdAt: string;
  mode: DemoMode;
  /** True for checked-in sample receipts used for UI/tests only. */
  isSample: boolean;
  sampleLabel?: string;
  bugReport: string;
  modelConfigured: string;
  agentClaim: AgentClaim;
  commands: CommandLog[];
  llmSteps: LlmStepLog[];
  totals: ReceiptTotals;
  diffs: FileDiff[];
  /** Tests the agent may have run inside its sandbox (self-reported evidence). */
  agentTests?: TestSuiteResult;
  verification: VerificationResult;
  /**
   * High-level verdict for the receipt banner.
   * - verified: agent claimed fixed AND independent re-run passed
   * - claim-failed-verification: agent claimed fixed but independent re-run failed
   * - not-fixed: agent did not claim fixed (or verification inconclusive)
   */
  verdict:
    | "verified"
    | "claim-failed-verification"
    | "not-fixed"
    | "error";
  errorMessage?: string;
  networkPolicyNotes: string[];
  architectureNotes: string[];
};

export type RunRequest = {
  mode: DemoMode;
  model?: string;
};
