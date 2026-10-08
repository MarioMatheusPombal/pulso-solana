<img src="https://raw.githubusercontent.com/MarioMatheusPombal/pulso-solana/main/assets/chalk-v1/readme/docbar.png" alt="PULSO: human authorization for AI agents. NOT AUDITED · DEVNET DEMONSTRATION ONLY." width="100%">

# PULSO agent demo: scenarios A–G

Reproducible demonstration on localnet/devnet. It is not a managed service: a hosted service is planned and not available yet.

With `pnpm`, Anchor, Cargo via rustup and the Solana CLI installed, run `scripts/demo.sh` at the repository root. The script installs the locked dependencies, builds the program for SBF v0 and runs A–G. The full mode needs the local RPC port `8899` free; if a validator is already answering there, it aborts before the scenario and leaves that process untouched. Local validators started by the demo are restarted between A/B, C, D and E to keep state isolated; F manipulates the LiteSVM Clock and does not send an RPC transaction.

The command stops at the first error and marks each result `PASS`. In A/B, 5 USDC executes below the limit and 100 USDC pauses until the local fixture records the human authorization. C tries to change the authorized amount from 100 to 150 USDC; D changes the recipient; E sends concurrent and sequential replays against a single-use authorization; F tries to execute with the Clock at `expires_at + 1`.

To run one scenario alone, use `scripts/demo.sh --scenario C` (D, E, F or G also work). A/B alone remains available as `scripts/demo.sh --scenario AB`.

## Scenario G: a receiver that only delivers against an authority receipt

`scripts/demo.sh --scenario G` (or `pnpm demo -- --scenario G`) starts a minimal HTTP receiver (`src/receiver.ts`, `node:http` only) that sells fixed resources at a fixed price and checks the proof. It does not choose a product, does not recommend and does not read the agent's request. Protocol `pulso-receipt-v1` (`docs/AUTHORITY_RECEIPT_SPEC.md`, section 11): a `GET` without proof returns `402` with the challenge; the agent pays and repeats the request with `X-PULSO-Receipt` (signature) and `X-PULSO-Challenge` (nonce).

- **G1:** 5 USDC, within the agent's authority. The agent pays through PULSO with no human and the receiver delivers. Receipt `mode: autonomous`.
- **G2:** 100 USDC, above the agent's authority. `HUMAN_INTENT_REQUIRED`, local fixture approval, execution. The receiver requires an approved receipt and sees `mode: approved`, the human key that authorized it and `hashVerified: true`.
- **G3:** the agent pays the same 5 USDC with a direct SPL transfer, outside PULSO. The money arrives, and the receiver refuses with `NOT_PULSO_TRANSFER`: no proof of authority, no delivery.
- **G4:** the agent presents the G1 signature to a new challenge (`NONCE_MISMATCH`) and to the already redeemed challenge (`CHALLENGE_CONSUMED`).

Test: `pnpm --filter @pulso/agent-demo exec vitest run --config vitest.e2e.config.ts ../tests/scenario-g.e2e.test.ts`.

## Run a B2B request (`pnpm b2b`)

The agent has no backend session. An authenticated participant exports the **request package** (`pulso-b2b-package-v1`, `docs/B2B_NETWORK_SPEC.md`, section 7) as a JSON file, and the agent operator runs it:

```bash
pnpm --filter @pulso/agent-demo b2b -- --package request.json [--cluster localnet|devnet] [--rpc <url>] [--state-dir <dir>] [--approve ui|auto] [--approvals-url <url>] [--json]
```

Before sending anything, `src/b2b-package.ts` validates everything locally, without trusting the backend: it recomputes the digest, checks `requestId == nonce`, re-reads every consent (10-line envelope, action, signer, `cluster`, `terms`, Ed25519 over the message bytes), requires the receiver's consent, and checks agent, policy (PDA of `payerAuthority` + `agent`), program, RPC genesis hash and `expiry`. The package `status` and `ready` fields are hints only. Any failure ends with `REFUSED <code>` (exit 2) and nothing is sent. Codes: `BAD_PACKAGE`, `UNKNOWN_VERSION`, `AMOUNT_INVALID`, `DIGEST_MISMATCH`, `REQUEST_ID_MISMATCH`, `RECEIVER_CONSENT_REQUIRED`, `CONSENT_MISSING`, `CONSENT_BAD_ENVELOPE`, `CONSENT_ACTION_MISMATCH`, `CONSENT_SIGNER_MISMATCH`, `CONSENT_AUTHORITY_MISMATCH`, `CONSENT_CLUSTER_MISMATCH`, `CONSENT_TERMS_MISMATCH`, `CONSENT_BAD_SIGNATURE`, `AGENT_MISMATCH`, `POLICY_MISMATCH`, `PROGRAM_MISMATCH`, `GENESIS_MISMATCH`, `EXPIRED`, plus `INTENT_MISMATCH` (the approved intent is not exactly the snapshot) and `SEND_PENDING` (exit 4).

It then calls `PulsoClient.execute({ amount, recipient, nonce })` with the exact snapshot values (the request's 16-byte nonce, never the zero default). If the policy allows it, it executes (`mode=autonomous`). If the policy requires a human: `HUMAN_INTENT_REQUIRED`, the client publishes the approval through the existing path (action hash v1), the agent waits for the on-chain intent, **revalidates terms and authorization** and executes (`mode=approved`). `--approve auto` uses the local human fixture (localnet only, as in scenarios A/B). The output carries `EXECUTED mode=... signature=...`: this is the signature a participant reports to the request. The hard cap, daily limit and revocation apply as always: a program rejection comes out as `REJECTED PULSO_0NN_...` (exit 3) and is never bypassed. The agent only uses its own key.

**Retry and the limit of exactly-once.** Before resending, the agent reads the status of the signature already sent for the request (`getSignatureStatuses`) and only resends if the previous transaction failed on-chain or the blockhash expired without confirming; once confirmed, it only reports the signature. The state (`<requestId>.json`: blockhash, signature, mode) lives in `.demo/<cluster>/b2b-state/` (outside Git), or in `--state-dir` / `PULSO_B2B_STATE_DIR`, and survives a timeout and a restart. This is client-side protection, not an on-chain guarantee:

- **Approved branch:** the nonce goes into the action hash and the intent is single-use; the program refuses a repeat (`INTENT_ALREADY_USED`). On-chain guarantee.
- **Autonomous branch:** the program only carries the nonce. **Nothing on-chain prevents repeating** the execution with the same nonce; the state file does not protect against another process, another machine or erased state. The demo uses a policy that requires an intent for the request amount, so non-repetition comes from the approved branch.

Tests: `pnpm --filter @pulso/agent-demo test` (unit, no validator) and `pnpm --filter @pulso/agent-demo exec vitest run --config vitest.e2e.config.ts test/b2b.e2e.test.ts` (real validator).

## B2B demo: two companies (`b2b-demo`)

`pnpm --filter @pulso/agent-demo b2b-demo -- [--cluster localnet|devnet]` narrates the flow between two companies using the app's real libs and the agent adapter: signature login, organizations `@demo_acme` and `@demo_globex`, connection, charge, proposal, the main scene of 100 units (agent blocked, human signs the exact payload, agent executes, B reconciles) and the failures (program cap, tampered package, replay, missing consent, expired request). The human signature in the rehearsal comes from the fixture `src/b2b-wallet-fixture.ts`; the agent only has its own key. On devnet use `--keys-dir` and `--funder` pointing outside the repo. Full walkthrough and the record of the real rehearsal: `docs/B2B_DEMO.md`.

Test (local validator): `pnpm --filter @pulso/agent-demo exec vitest run --config vitest.e2e.config.ts test/b2b-demo.e2e.test.ts`. `pnpm b2b` also accepts `--agent-keypair <file>` (or `PULSO_AGENT_KEYPAIR`) to use an agent key stored outside the repo.

Optionally, set `PULSO_ACTIVITY_URL` to the base URL of the local app, for example `PULSO_ACTIVITY_URL=http://localhost:3000 scripts/demo.sh --scenario AB`. The demo sends structured A/B events to the `/api/activity` endpoint for display in the timeline. Without this variable no activity request is made; telemetry failures or timeouts do not change approval, execution or the on-chain result.

Each scenario that runs on a local validator prints, at the end, the authorization trail of its policy read from the chain. The same reader runs on its own: `pnpm trail -- --policy <pubkey> [--rpc <url>] [--json]` (default RPC: local validator). It reads the transactions that touch the policy and lists, in chronological order, policy created or changed, approvals recorded (which human key, which hash, validity and uses), autonomous or approved transfers and refused attempts with the `PULSO_0NN` code. For each approved transfer it recomputes the action hash from public data and checks it against the hash stored in the intent. It is read-only: it does not sign, does not send a transaction and does not open any key file.

NOT AUDITED · DEVNET DEMONSTRATION ONLY
