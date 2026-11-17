# sandbox-verified-agent

**Agents that show their work.**

A Vercel DevRel demo template: an AI SDK coding agent edits a real failing Vitest suite inside [Vercel Sandbox](https://vercel.com/docs/vercel-sandbox), then a **fresh** sandbox restored from a snapshot re-runs the tests. The result is a **receipt** — bug report, agent claim, commands, diff, independent pass/fail, and AI Gateway model/provider/tokens/cost per step.

A green chat message is not evidence. The receipt is.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fdebs-obrien%2Fsandbox-verified-agent&env=AI_GATEWAY_API_KEY&envDescription=AI%20Gateway%20API%20key%20(or%20use%20OIDC%20on%20Vercel)%20plus%20Sandbox%20access%20via%20project%20link&project-name=sandbox-verified-agent&repository-name=sandbox-verified-agent)

## Who has this problem?

Teams adopting coding agents (support fixes, small refactors, “just make the tests green”) keep asking:

> Did the agent really fix it — and how do I know?

Chat UIs collapse the answer into a confident sentence. This template separates **the agent’s claim** from **independent verification**.

## Why Vercel Sandbox + AI Gateway?

| Piece | Role |
| --- | --- |
| **Vercel Sandbox** | Firecracker microVM for untrusted agent edits + test runs. Snapshots capture before/after filesystem state; restore into a new VM for a clean re-run. Network policies lock egress (npm during install, then deny-all). |
| **AI Gateway** | One model string (`provider/model`), OIDC or API key auth, and real `providerMetadata.gateway` fields for provider routing, `generationId`, and `cost` — recorded on the receipt without inventing values. |
| **AI SDK `ToolLoopAgent`** | Tool-calling agent loop (`runCommand`, `readFile`, `writeFile`) with `stopWhen: isStepCount(N)`. |

**Credential choice in this demo:** the LLM runs on the **Next.js host** via AI Gateway. The sandbox never receives `AI_GATEWAY_API_KEY` / OIDC. While the agent works, sandbox egress is **deny-all**. (Docs also support Gateway-only allow-lists with firewall header transforms if you ever move model calls into the VM — see `src/lib/sandbox/network.ts`.)

## Architecture

```mermaid
flowchart LR
  subgraph Host["Next.js host"]
    UI[Receipt UI]
    API["/api/run"]
    Agent["ToolLoopAgent + AI Gateway"]
    API --> Agent
    Agent -->|providerMetadata cost/tokens| Receipt[(Receipt JSON)]
    UI --> Receipt
  end

  subgraph SBX["Vercel Sandbox"]
    Fix[fixtures/buggy-pricing]
    SnapBefore[Snapshot before]
    SnapAfter[Snapshot after]
    Fix --> SnapBefore
    Agent -->|runCommand / readFile / writeFile| Fix
    Fix --> SnapAfter
  end

  subgraph Verify["Fresh sandbox"]
    Restore[Restore after-snapshot]
    Tests[vitest re-run]
    Restore --> Tests
    Tests --> Receipt
  end

  SnapAfter --> Restore
```

## The fixture

`fixtures/buggy-pricing/` is a boring TypeScript pricing helper with an off-by-one:

- Promo: **buy 3, get 10% off**
- Bug: threshold uses `>` instead of `>=` (quantity `3` never discounts)
- Vitest suite: one failing test matching the customer report in `BUG_REPORT.md`

Unit tests only — no Playwright.

## Two modes

| Mode | What happens | Receipt verdict |
| --- | --- | --- |
| **normal** | Full prompt + `isStepCount(12)`. Agent should fix `>` → `>=` and pass tests. | `verified` when claim + independent re-run agree |
| **caught-it** | Weaker prompt that tells the agent to stop early and emit `CLAIM: FIXED` without a correct fix, plus `isStepCount(2)`. | `claim-failed-verification` (“Agent claimed fixed — verification failed”) |

Caught-it is intentional theater for demos: the mechanism is an honest step-limit + prompt, not a hidden mock of the verifier.

## Setup

### 1. Clone & install

```bash
npm install
```

### 2. Link a Vercel project (Sandbox + OIDC)

```bash
npx vercel link
npx vercel env pull .env.local
```

### 3. AI Gateway auth

Pick one:

- **On Vercel / linked local:** `VERCEL_OIDC_TOKEN` from `vercel env pull` (also works for Sandbox).
- **API key:** create a Gateway key and set `AI_GATEWAY_API_KEY` in `.env.local`.

Optional:

```bash
AI_GATEWAY_MODEL=anthropic/claude-haiku-4.5   # must exist in https://ai-gateway.vercel.sh/v1/models
```

External CI without OIDC also needs:

```bash
VERCEL_TOKEN=…
VERCEL_TEAM_ID=…
VERCEL_PROJECT_ID=…
```

See `.env.example`.

### Required credentials (checklist)

| Variable | Used for |
| --- | --- |
| `AI_GATEWAY_API_KEY` **or** `VERCEL_OIDC_TOKEN` | Model calls via AI Gateway |
| `VERCEL_OIDC_TOKEN` **or** (`VERCEL_TOKEN` + `VERCEL_TEAM_ID` + `VERCEL_PROJECT_ID`) | `@vercel/sandbox` create / snapshot / commands |

## Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000):

- **Run normal** → live agent + verification receipt
- **Run caught-it** → false claim caught by independent re-run
- Sample receipts (offline UI): `/receipt/sample-verified`, `/receipt/sample-caught`

Fixture-only (no Sandbox):

```bash
npm run test:fixture   # expects 1 failing test in the buggy fixture
npm test               # receipt-building unit tests
```

## Deploy

Use the Deploy button above, or:

```bash
npx vercel --prod
```

On Vercel, OIDC covers Sandbox + Gateway for the deployment. Still set `AI_GATEWAY_API_KEY` if you prefer a key over OIDC for Gateway. Ensure the project has Sandbox enabled for the team.

Function duration: `/api/run` sets `maxDuration = 800` (Sandbox + agent + verify is slow).

## Receipt fields

- Customer bug report
- Agent claim (`CLAIM: FIXED` marker) vs independent result
- Every command: exit code, truncated stdout/stderr
- Diff of tracked source files
- Per-test pass/fail from the **fresh** sandbox re-run
- Per LLM step: model, provider, tokens, cost (from real Gateway `providerMetadata`; missing fields → `"unavailable"`, never invented)
- **Download JSON** of the same payload

## What we learned / rough edges

Real DX friction hit while building this template:

1. **Alias / resolved `modelId`** — Gateway may echo the requested alias rather than a versioned resolved id. Related: [vercel/ai#21213](https://github.com/vercel/ai/issues/21213). The receipt records whatever came back and notes when original/canonical slugs match.
2. **`providerMetadata.gateway.cost` is not always present** — when absent we store `"unavailable"` and bump `stepsMissingCost`. Generation Lookup (`GET /v1/generation?id=…`) is async and can 404 briefly after a call; we prefer the inline metadata and do not invent costs.
3. **`sandbox.snapshot()` stops the session** — you must create a new sandbox from `snapshotId` to keep working. Easy to miss on first read of the SDK.
4. **`runCommand` has no shell** — pipes/`&&` need `bash -c`. Non-zero exits do **not** throw; always check `exitCode`.
5. **File methods vs cwd** — `writeFiles` / `readFileToBuffer` are rooted at `/vercel/sandbox`, but command cwd defaults may differ. Prefer absolute paths under `/vercel/sandbox`.
6. **Network policy shape** — allow-lists are domain → rule objects (with optional `transform` for credential brokering). Install needs registry hosts; agent phase in this demo is `deny-all` because the model stays on the host.
7. **Local auth matrix** — Sandbox wants OIDC or the token trio; Gateway wants OIDC or `AI_GATEWAY_API_KEY`. Easy to have one and not the other locally.
8. **AI SDK stop helpers** — use `isStepCount` (AI SDK 7); older `stepCountIs` / `maxSteps` memories will fail typecheck.
9. **Long runs on serverless** — plan `maxDuration` (and patience). Snapshot + npm install + multi-step tool loops are not “edge instant.”
10. **Vitest JSON reporter in the sandbox** — parse defensively; if the JSON file is missing, fall back to exit code without fabricating per-test rows.

## Project layout

```
fixtures/buggy-pricing/   # intentional bug + Vitest + BUG_REPORT.md
src/lib/agent/            # ToolLoopAgent, tools, prompts, run pipeline
src/lib/sandbox/          # create, network policies, snapshot verify
src/lib/receipt/          # parse tests, extract LLM steps, totals, store
src/app/                  # UI + /api/run + receipt pages
samples/                  # offline sample receipts (isSample: true)
tests/                    # receipt-building unit tests
```

## License

MIT
