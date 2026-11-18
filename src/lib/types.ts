/** Shared receipt / run types for the sandbox-verified-agent demo. */

/** `normal` = agent sees all tests. `hidden` = agent sees visible tests only. */
export type DemoMode = "normal" | "hidden";

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
  modelId: string | Unavailable;
  provider: string | Unavailable;
  canonicalSlug: string | Unavailable;
  generationId: string | Unavailable;
  inputTokens: number | Unavailable;
  outputTokens: number | Unavailable;
  totalTokens: number | Unavailable;
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
  /** Whether this test was held out from the agent (hidden mode). */
  heldOut?: boolean;
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

/** Structured claim from the required `submitClaim` tool. */
export type AgentClaim = {
  /** False when the agent never called submitClaim. */
  submitted: boolean;
  /** Null when no claim was submitted. */
  claimedFixed: boolean | null;
  summary: string;
  filesChanged: string[];
  testsRun: string;
  rawText: string;
};

export type VerificationResult = {
  /** Independent re-run in a fresh pristine sandbox + agent diff (+ hidden tests). */
  independentTests: TestSuiteResult;
  visibleTests: TestCaseResult[];
  hiddenTests: TestCaseResult[];
  verified: boolean;
  beforeSnapshotId: string | Unavailable;
  afterSnapshotId: string | Unavailable;
  verificationSandboxId: string | Unavailable;
  /** How verification was constructed. */
  method: "pristine-plus-diff";
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
  costUsd: string | Unavailable;
  stepsWithCost: number;
  stepsMissingCost: number;
};

export type Verdict =
  | "verified"
  | "claim-failed-verification"
  | "not-fixed"
  | "no-claim"
  | "error";

export type Receipt = {
  id: string;
  createdAt: string;
  finishedAt?: string;
  durationMs?: number | Unavailable;
  mode: DemoMode;
  isSample: boolean;
  sampleLabel?: string;
  bugReport: string;
  modelConfigured: string;
  agentClaim: AgentClaim;
  commands: CommandLog[];
  llmSteps: LlmStepLog[];
  totals: ReceiptTotals;
  diffs: FileDiff[];
  agentTests?: TestSuiteResult;
  verification: VerificationResult;
  /** Revealed after verification in hidden mode — source of held-out tests. */
  hiddenTestSource?: string;
  verdict: Verdict;
  errorMessage?: string;
  networkPolicyNotes: string[];
  architectureNotes: string[];
};

export type RunRequest = {
  mode: DemoMode;
  model?: string;
};
