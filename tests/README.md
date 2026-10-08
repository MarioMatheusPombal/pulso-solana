# tests: end-to-end scenarios and MVP reproduction

The program tests live in `programs/pulso/tests/` and run on LiteSVM, with no validator. Scenario F can be reproduced with `scripts/demo.sh --scenario F`: it runs the focused expiry test on LiteSVM, advances the Clock to `expires_at + 1` and shows error 6003 and the preserved states. This result is a simulation of the on-chain program; it does not create or represent an RPC transaction.

## MCP security (#244)

**NOT AUDITED · DEVNET DEMONSTRATION ONLY**

After installing dependencies and building `target/deploy/pulso.so`:

```sh
pnpm --filter @pulso/mcp-server build
pnpm --filter @pulso/mcp-server exec vitest run --config ../tests/mcp-security.config.mts --silent=false
pnpm test:mcp
pnpm test:mcp:e2e
pnpm test:e2e
anchor test --skip-build
```

The `security.mcp.test.ts` harness uses the official MCP client over stdio, protocol pinned to `2026-07-28`, a deliberately deceptive loopback backend and a real Solana validator. RPC/WS use 19008/19009, faucet 20008, gossip 21008 and dynamic ports 21010–21099. The human fixture signs only inside the test process; only the agent key is written, to a private temporary directory outside the repo. The directory is removed at the end.

The flow lists the four base authorization tools and the fifth tool `pay_receipt_challenge`, integrated by #286. The listing checks the full current surface; the attacks in this harness cover the base flow, while the MCP receipt tests cover the fifth tool. The flow executes 5 test units, blocks 100, restarts the server, records the intent with the human fixture and confirms the exact execution. Expected balances in base units: vault `500000000 → 495000000 → 395000000`, recipient `0 → 5000000 → 105000000`, alternate recipient `0`. The real signatures are queried on the RPC; the harness prints those signatures and balances, never keys.

The proofs have distinct boundaries:

- **MCP schema:** extra amount/recipient fields, invalid handle, zero, float and JSON number are rejected before a tool runs. This does not prove on-chain enforcement.
- **Adapter/local state:** a falsely approving backend does not authorize execution; another human, tampered agent/genesis, tampered amount/recipient in the file and an expired request fail without spending. A restart preserves the exact bytes of the request.
- **Program via direct SDK:** tampered amount/recipient with the authorized hash return `PULSO_006_INTENT_MISMATCH` (6005); replay returns `PULSO_005_INTENT_ALREADY_USED` (6004). These are simulations of the real program, with no rejected-transaction signature. A request above the agent's authority through the direct SDK stays blocked. An SPL transfer signed only by the agent cannot spend the program's vault.
- **A–F regression:** `pnpm test:e2e` runs the existing scenarios; C/D/E also provide confirmed rejected transactions and signatures. F uses LiteSVM with a controlled Clock and error `PULSO_004_INTENT_EXPIRED` (6003), with no RPC transaction. Expiry in MCP tests the adapter's fail-closed behavior; it does not replace the F proof in the program.

The secret check inspects results/frames decoded by the MCP client, bodies received by the backend and the process stderr. It looks for keypair bytes as a JSON array, hex, base64 and base58, private field names and the agent key path. It is not a security audit and does not cover every possible encoding. The server stdout must remain exclusively MCP frames accepted by the client.

This harness lives in `tests/`; publishing it requires `mcp-server` and the workspace dependencies, as decided in #246.

## B2B network (#311)

**NOT AUDITED · DEVNET DEMONSTRATION ONLY**

Traceable matrix against `docs/B2B_NETWORK_SPEC.md` section 12 (T-01 to T-40) and against the #311 criteria. Connection, request status and message signature are application state and do not authorize spending; the one that spends, or refuses, is the program. There is no KYC, no on-chain bilateral veto and no mainnet.

Run the E2E, with the compiled `.so` (`anchor build --arch v0`):

```sh
pnpm --filter @pulso/agent-demo exec vitest run --config vitest.e2e.config.ts ../tests/b2b-network.e2e.test.ts
```

`tests/b2b-network.e2e.test.ts` starts a `solana-test-validator` (RPC 8995, faucet 9995), creates two organizations A (pays) and B (receives) with wallets generated in memory, opens a session by signing the challenge as the wallet would, connects, creates a charge and a proposal, exports the package, pays with `executePackage` from `agent-demo` and reconciles. It calls the app libs with a temporary `dir` and the real connection; one block calls the real handlers in `app/app/api/network/**` (without Next). No key, token or cookie is printed, and one test checks that no stored file contains them.

File abbreviations: **N** = `tests/b2b-network.e2e.test.ts` (E2E, real validator); **auth** = `app/test/network-auth.test.ts`; **store** = `app/test/network-store.test.ts`; **req** = `app/test/network-requests.test.ts`; **rec** = `app/test/network-reconcile.test.ts` (test connection); **pkg** = `agent-demo/test/b2b-package.test.ts`; **ad** = `agent-demo/test/b2b.test.ts`; **adE2E** = `agent-demo/test/b2b.e2e.test.ts`; **sdk** = `sdk/test/b2b-terms.test.ts`; **RA** = `tests/receipt-attacks.e2e.test.ts`. Layers: **U** lib unit, **I** lib with the store in a temporary directory, **E** E2E with a validator. Status: **covered** (already existed), **PR** (covered by that PR), **partial** or **gap** (with the reason). Request states appear as the literal protocol tokens (`aguardando autorização` = awaiting authorization, `aguardando contraparte` = awaiting counterparty, `enviado` = sent, `confirmado` = confirmed, `verificado` = verified, `recusado` = refused, `expirado` = expired, `cancelado` = cancelled); `autônomo` and `aprovado` are the receipt modes autonomous and approved.

| ID | Scenario | Where (file: test) | Layer | Status |
|---|---|---|---|---|
| T-01 | `pulso-b2b-terms-v1` vectors | sdk: "vector file declares...", "covers both kinds and amount 2^64-1"; req: "matches shared vector" | U | **partial**: `agent-demo` does not read the vectors, it reuses the SDK `computeTermsDigest` in `validatePackage` |
| T-02 | Changing a field changes the digest | sdk: "every changed-field vector differs"; req: "submit integrity"; N: "T-19/T-23" | U, E | covered, PR |
| T-03 | Handle: case, `@`, space, non-ASCII, length, reserved | store: "normalizes per spec section 3", "creates, rejects duplicates by case, reserved..."; N: "T-04/T-08/T-18" (Cyrillic, case) | U, E | covered, PR |
| T-04 | Near-identical handles | store: "two lookalike handles..."; N: "T-04/T-08/T-18" | I, E | covered, PR |
| T-05 | Login: replay | auth: "rejects replay of a consumed nonce"; N: "T-05/T-07 login" | I, E | covered, PR |
| T-06 | Invalid signature consumes the challenge | auth: "consumes the nonce even when the first attempt is invalid"; N: "T-05/T-07 login" | I, E | covered, PR |
| T-07 | Login: expired, domain, cluster, wrong key | auth: "rejects an expired challenge", "wrong domain", "wrong cluster", "another wallet"; N: "T-05/T-07 login" (expired, cluster, key); wrong Origin in N: "T-10" and "real route handlers" | I, E | covered, PR. Deviation from the spec: the route returns a generic 401 (spec section 13), the specific reason cannot be told apart in the response |
| T-08 | Body `authority` ignored | auth: "rejects a signature over a tampered message"; store: "uses the session authority, not the body"; the body does not even have that field | I | covered |
| T-09 | Concurrent verification of the same challenge | auth: "lets only one of two concurrent verifications win" | I | covered |
| T-10 | Expired session, logout, another org's cookie, no Origin | auth: "network session", "request helpers"; N: "T-10", "real route handlers" (HttpOnly/SameSite=Strict cookie, 401 without cookie, 403 with foreign or missing Origin) | I, E | covered, PR |
| T-11 | Agent tries to log in / take over an organization | N: "T-11" (the agent key does not sign the authority's challenge; its own session sees nothing of A; `AGENT_IS_AUTHORITY`; it does not reassign `payerAgent`) | E | PR |
| T-12 | Receiving account: owner, mint, nonexistent, RPC down | store: "refuses wrong owner field, program, size, state, missing account..."; req: "payer agent, receiving account, policy, vault and mint preconditions", "RPC unavailable refuses with 503"; N: happy path only, with a real account | I | **partial**: negatives only with a test account, not with real accounts |
| T-13 | Invite tampered, reused, expired, own, duplicate, crossed | store: "refuses a tampered, replayed, wrong-signer or expired invite", "a reused invite signature...", "duplicate and crossed invites...", "expires lazily..."; N: "T-13/T-14" | I, E | covered, PR |
| T-14 | Accept by a third party | store: "third parties and the inviter cannot accept..."; N: "T-13/T-14" (404, another's signature: 401, stays `pendente`) | I, E | covered, PR |
| T-15 | Accept and decline at the same time | store: "accept x decline race" | I | covered |
| T-16 | Restart between invite and accept, and between accept and payment | store: "survives a restart"; req: "lazy expiry... restart keeps everything"; N: "T-16/T-33" (new modules over the same `dir`, new agent over the same `stateDir`) | I, E | covered, PR |
| T-17 | IDOR: request, connection, package of another org | store: "isolates organizations", "third parties get 404 everywhere"; req: "lists only the caller's requests..."; N: "IDOR" (C with a valid session and an active connection to A gets 404 on everything of A↔B, state intact) and "real route handlers" | I, E | covered, PR |
| T-18 | Exact search, minimal response | store: "exact match only, minimal result..."; N: "T-04/T-08/T-18" (equality with the 3 fields) | I, E | covered, PR |
| T-19 | Charge without signature / from another authority / digest of another request | req: "consent with the wrong action, signer or terms is refused; replay is refused"; N: "T-19/T-23" | I, E | covered, PR |
| T-20 | Proposal: payment path only after `send.accept`; accept with another digest | req: "accept: only the receiver..."; N: "T-20" (`ready:false` until signed; accept of another digest: 401) | I, E | covered, PR |
| T-21 | Edit becomes a new request, old one `cancelado` with `supersededBy` | req: "edit = cancel with reason edited..." | I | covered |
| T-22 | Repeated nonce; amount 0, negative, fractional, `>= 2^64` | req: "a request id (nonce) is unique inside the lock", "amount %j is refused", "amount 2^64-1 is accepted" | I | covered |
| T-23 | Client sends `status: verificado` or false consent | req: "the client cannot reach 10-13..."; rec: "ignores status, mode, amount and result in the body"; N: "T-19/T-23" and "T-23" (nonexistent signature leaves `enviado`, never green) | I, E | covered, PR |
| T-24 | Forbidden transitions | req: "line %i...", "terminal states do not leave, and every other combination is a 409" | U | covered |
| T-25 | Expired request, signature reported | rec: "cannot be reported on a live request once it expired...", "late payment on an ended request"; N: "T-25/T-34" (`expirado` + `late.reason = after_expiry`) | I, E | covered, PR |
| T-26 | Valid payment, autonomous and approved | N: "T-26 autonomous", "T-26/T-36 approved" (vault and destination balances, `mode`, intent and action hash, consent and payment on the request) | E | PR |
| T-27 | Receipt of another charge | N: "T-27/T-32" (`NONCE_MISMATCH`, request intact; then `SIGNATURE_IN_USE`) | E | PR |
| T-28 | Higher and lower amount | N: "T-28" (`AMOUNT_NOT_EXACT`, `AMOUNT_TOO_LOW`) | E | PR |
| T-29 | Destination, mint, program, cluster, authority swapped | N: "T-29" (`RECIPIENT_MISMATCH`, `AUTHORITY_NOT_ACCEPTED` with another human's policy, `CLUSTER_MISMATCH`); mint and program in rec ("another mint", "another program") and RA 4c/12 | I, E | **partial**: `MINT_MISMATCH` and `NOT_PULSO_TRANSFER` for a swapped program do not run in the network E2E (it would need a second mint with a vault) |
| T-30 | Direct SPL transfer outside the program | N: "T-30" (the agent cannot move the vault by SPL; a direct transfer of the same amount to the destination account arrives, and gets `NOT_PULSO_TRANSFER`) | E | PR |
| T-31 | RPC fails at A and B | rec: "RPC down at step A", "RPC down at step B"; N: "T-31" (real dead RPC: stays `enviado`, then verifies) | I, E | covered, PR |
| T-32 | Two concurrent POSTs; same signature on two requests | rec: "two concurrent verifications...", "signature already used by another request..."; N: "T-32" (4 reconciliations in parallel, 1 verification, no duplicate; same signature on two requests at once) | I, E | covered, PR |
| T-33 | Restart between `enviado`, `confirmado`, `verificado` | N: "T-16/T-33" (`enviado` with RPC down, restart, `verificado`, restart, idempotent repeat) | E | PR. `confirmado` only in rec ("RPC down at step B"), without restart |
| T-34 | Cancel then pay; expire then pay | N: "T-34" (`cancelado` + `late.reason = after_cancel`, money left, no `payment`) and "T-25/T-34" (`expirado` + `after_expiry`); `after_refusal` and `after_expiry_landed` in rec | E | PR |
| T-35 | Autonomous branch, two executions, same nonce | N: "T-35": the 2nd execution **happens on-chain** (the vault loses 10, not 5) and becomes `duplicates`. **There is no on-chain protection of the autonomous nonce**: that is the declared limit. The adapter lock is local only (state file) | E | PR |
| T-36 | Approved branch, repeat | N: "T-26/T-36": `PULSO_005_INTENT_ALREADY_USED`, vault unchanged | E | PR |
| T-37 | Agent: tampered package, false `approved`, expired intent, RPC fails, retry | pkg and ad (tampered fields, "refuses an approved intent that is not exactly the snapshot", "does not resend..."); N: "T-37" (amount/destination/nonce tampered, including with the digest recomputed; backend that says `approved` without an intent: timeout, direct `executeApproved` fails, vault unchanged) | I, E | **partial**: expired intent only in ad ("package that expired meanwhile") and in scenario F (LiteSVM); agent with RPC unavailable during `execute`: gap (only send timeout, in ad) |
| T-38 | Scenarios A–G | `pnpm test:e2e` (agent-demo: A–E and full demo; RA and scenario-g; sdk e2e), scenario F on LiteSVM | E | covered. The CI workflow runs these suites in the `anchor` and `agent-demo-e2e` jobs |
| T-39 | No key, token or personal data | N: "no secret in anything stored..." (seeds and keys as hex, base64, base58 and JSON array, and session tokens: nothing in `dir`, `stateDir` or the package). The network libs and routes have no `console.*` | I | PR. The logs of a real Next server are not scanned |
| T-40 | UI text and docs | N: "what the network UI claims" (scan of `Network*.tsx` and the network pages); `network-*-ui.test.ts` check the warnings | I | **partial**: docs and README are not scanned |

Items from issue #311, mapped to the IDs above:

| Item | IDs | Status |
|---|---|---|
| Impersonation (lookalike handles, same name, key always visible) | T-03, T-04, T-18 | covered, PR (the UI showing the key is checked in `network-ui.test.ts`) |
| Agent as admin | T-11 | PR |
| IDOR between organizations | T-17, T-10 | covered, PR (also through the handlers) |
| Forged invite and consent | T-13, T-14, T-19, T-20 | covered, PR |
| Expired nonce and replay | T-05 to T-09; consent replay in N "T-13/T-14" and "T-19/T-23" | covered, PR |
| Swapped wallet, mint, amount, cluster | T-19, T-28, T-29 | covered, PR. Swapped mint at verification: partial (T-29) |
| Forged backend `approved` | T-23, T-37 | PR |
| Concurrency, retry, restart | T-15, T-16, T-32, T-33 | covered, PR |
| Direct transfer outside the program | T-30 | PR |
| Receipt of another charge | T-27 | PR |
| Cancellation and late payment | T-34, T-25 | PR |
| A–G regression | T-38 | covered |

Limits these tests show, and that no public text should hide:

- **Nonce on the autonomous branch:** only the approved branch has an on-chain single-use guarantee. On the autonomous branch the program only carries the nonce; the request accepts one payment and records the others as `duplicates`, and the money has already left (T-35).
- **Cancelling, refusing or expiring a request does not prevent spending:** the agent does not read the package `status` or `ready` (T-34). A late payment is recorded, never accepted.
- **Whoever holds the agent key stays inside the policy, not the request:** they can pay a different amount or destination than the request; the request is not satisfied, but the program authorizes it (T-28, T-29).
- **Refusal is deterministic per signature:** a signature refused for a request is not re-evaluated for that request (not even if the refusal came from an RPC on the wrong cluster). A new payment is required.
