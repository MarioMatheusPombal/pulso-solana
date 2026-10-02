<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/readme/docbar-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="../assets/readme/docbar-light.svg">
  <img src="../assets/readme/docbar-dark.svg" alt="PULSO: human authorization for AI agents. NOT AUDITED · DEVNET DEMONSTRATION ONLY." width="100%">
</picture>

# PULSO Authority Receipt v1

| | |
|:--|:--|
| **Scheme** | `pulso-receipt-v1` |
| **Version** | v1 |
| **Status** | Draft, open for comment |
| **Companion to** | [PULSO-RFC-0001](POLICY_AND_INTENT_SPEC.md) (action hash domain `PULSO_INTENT_V1`) |
| **Reference implementation** | `sdk/src/receipt.ts` (verifier), `agent-demo/src/receiver.ts` (payee) and the `/receipt/<signature>` page in `app/` |

> **NOT AUDITED · DEVNET DEMONSTRATION ONLY.** This is a prototype specification, not production custody. Nothing here has been audited.

## 1. What it is

Whoever receives a payment from an agent has no way to know whether that agent had authority to pay. The **authority receipt** answers, from public chain data alone:

1. The payment left a vault controlled by a PULSO policy.
2. The policy was defined by a key (`human`) different from the agent's key.
3. The payment was **autonomous** (inside the delegated limit) or **approved** (the human signed that exact action).
4. What the payee asked for (recipient, mint, amount, nonce) is what was paid.

The receipt is **derived**: the transaction signature plus what the verifier reads on-chain. Nothing is written for it. No new account and no change to the program.

PULSO never interprets what the agent meant to buy. The verifier compares numbers and keys. There is no intent detection, category or text.

Design rules this document keeps:

- The receipt enforces nothing. It shows that the program enforced: the transaction succeeded, so the checks of `execute_transfer` passed. The verifier never replaces the program.
- Only pubkeys, hashes, limits and timestamps are read. The challenge and the refusal reasons stay off-chain.

## 2. Source of truth: the instruction, not the logs

| Source | Decision | Reason |
|---|---|---|
| Logs and events (`TransferExecuted`) | **Not trusted** | Any program can print a `Program data:` line with the same shape. Logs can also be truncated. |
| Top-level instruction | **Primary source** | The signed message says which program was invoked and with which bytes. It cannot be forged without changing the signature. |
| `meta.postTokenBalances` and `preTokenBalances` | **Mint and amount cross-check** | They come from execution, not from what the caller wrote. |

If the transaction has `meta.err == null` and a top-level instruction invoked the PULSO program ID, the program ran `execute_transfer` to the end, the token transfer of `amount` from the vault to the recipient happened, and every earlier check passed. A different program has a different ID and is refused at step 4. A fake log inside another instruction is ignored because logs are never read.

**Inner instructions (CPI) are not accepted in v1.** If `execute_transfer` was called by another program, the receipt is refused (`NOT_PULSO_TRANSFER`).

## 3. Receipt fields

Only keys, hashes, numbers and dates. Keys in base58, hashes and nonce in lowercase hex, 64-bit integers as decimal strings in JSON.

| Field | Type | Origin |
|---|---|---|
| `signature` | base58 string | verifier input |
| `cluster` | string | verifier configuration (informational) |
| `commitment` | `"confirmed"` or `"finalized"` | verifier configuration |
| `slot` | u64 | `getTransaction` response |
| `blockTime` | i64 or null | `getTransaction` response, informational |
| `programId` | pubkey | program ID of the instruction (equal to the expected one) |
| `policy` | pubkey | instruction account 1 |
| `human` | pubkey | `policy.human` |
| `agent` | pubkey | `policy.agent` (equal to account 0, which signed) |
| `vault` | pubkey | instruction account 2 |
| `mint` | pubkey | `postTokenBalances[recipient].mint` |
| `recipient` | pubkey | account 3: the destination **token account** (not its owner) |
| `decimals` | u8 | `postTokenBalances[recipient].uiTokenAmount.decimals`; display only, not part of the action hash |
| `amount` | u64 | instruction data |
| `nonce` | 16 bytes, 32 hex | instruction data |
| `mode` | `"autonomous"` or `"approved"` | account 5 present (`approved`) or absent |
| `intent` | pubkey or absent | account 5, only in `approved` |
| `actionHash` | 32 bytes, 64 hex or absent | `intent.action_hash`, only in `approved` |
| `hashVerified` | bool or absent | recomputed hash equals `intent.action_hash`; only in `approved` |

A receipt exists only as `ok: true`. Any failure returns `ok: false` with a reason (section 5), never a partial receipt.

## 4. Layout of the `execute_transfer` instruction

Source: `programs/pulso/src/lib.rs` and `sdk/src/idl/pulso.json`.

**Instruction data, 32 bytes:**

| Offset | Size | Content |
|---|---|---|
| 0 | 8 | `execute_transfer` discriminator `[233,126,160,184,235,206,31,119]` = hex `e97ea0b8ebce1f77` |
| 8 | 8 | `amount`, u64 little-endian |
| 16 | 16 | `nonce`, raw bytes |

`data.length` must be exactly 32, otherwise `NOT_PULSO_TRANSFER`.

**Accounts, by position in the instruction account list:**

| Pos. | Name | Role |
|---|---|---|
| 0 | `agent` | signer (index below `header.numRequiredSignatures`) |
| 1 | `policy` | PDA `["policy", human, agent]`, writable |
| 2 | `vault` | PDA `["vault", policy]`, token account, writable |
| 3 | `recipient` | destination token account, writable |
| 4 | `token_program` | must be `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` |
| 5 | `intent` | optional |
| 6 | `recipient_approval` | optional |

**Absent optional account.** Anchor encodes `None` by placing the program ID itself at the position. The verifier treats a list that ends before position 5, or an address equal to the program ID there, as absent: `accounts.length <= 5` or `accounts[5] == programId` means autonomous. Any other address at position 5 means `approved`. Position 6 does not enter the v1 verdict (section 9).

**Message account keys.** For a `v0` transaction the key list is `staticAccountKeys`, then `meta.loadedAddresses.writable`, then `meta.loadedAddresses.readonly`. The request uses `maxSupportedTransactionVersion: 0`. `programIdIndex` and the instruction account indexes resolve in that list.

## 5. Verification algorithm

Verifier input: `signature`, the issued challenge (section 7: `recipient`, `mint`, `minAmount`, `nonce`), the expected `programId`, `commitment` (default `confirmed`), and optionally `acceptedAuthorities` and `requireApproved`.

Fail closed: the first step that does not pass ends with its reason. No step is best effort.

| # | Step | Refusal reason |
|---|---|---|
| 1 | `getTransaction(signature, { commitment, maxSupportedTransactionVersion: 0 })`. Network error, timeout, malformed response or rate limit. | `RPC_ERROR` |
| 2 | The response is `null` (not present at that commitment) or the signature is not base58 of 64 bytes. | `TX_NOT_FOUND` |
| 3 | `meta.err` is not null. | `TX_FAILED` |
| 4 | Resolve account keys (section 4). Filter the **top-level** instructions with `accountKeys[programIdIndex] == programId`, `data.length == 32` and `data[0..8] == e97ea0b8ebce1f77`. Refuse if the set is empty, accounts 0-4 do not exist, account 0 is not a signer, or account 4 is not the Token program. | `NOT_PULSO_TRANSFER` |
| 5 | Among the candidates of step 4, keep those whose `nonce` equals the challenge nonce. There must be **exactly one**. Zero or more than one. | `NONCE_MISMATCH` |
| 6 | Read `amount` (u64 LE) and accounts 0-6 from the instruction. Account 3 must equal `challenge.recipient`. | `RECIPIENT_MISMATCH` |
| 7 | Find the recipient account in `meta.postTokenBalances` (by `accountIndex`). Missing, or `mint` differs from `challenge.mint`, or `uiTokenAmount.decimals` is not an integer from 0 to 255. | `MINT_MISMATCH` |
| 8 | `amount >= challenge.minAmount`. | `AMOUNT_TOO_LOW` |
| 9 | Defense in depth: the recipient balance in `postTokenBalances` minus the one in `preTokenBalances` is `>= amount`. A missing pre or post entry, or a smaller increase. | `BALANCE_MISMATCH` |
| 10 | `getAccountInfo(policy, { commitment, minContextSlot: slot })`. An RPC failure is `RPC_ERROR`. Refuse if `human == agent` (the program does not prevent it in `create_policy`), the account is missing, `owner != programId`, `data.length != 120`, or the discriminator is not `[148,193,218,129,21,96,195,77]` (`AgentPolicy`). Read `human = data[8..40]`, `agent = data[40..72]`. Refuse if the PDA `["policy", human, agent]` is not the policy, if `agent` differs from account 0, or if the PDA `["vault", policy]` is not the vault (account 2). | `POLICY_INVALID` |
| 11 | If `acceptedAuthorities` was given, `human` must be in the list. | `AUTHORITY_NOT_ACCEPTED` |
| 12 | Mode (section 4). `requireApproved` is set and the mode is `autonomous`. | `APPROVAL_REQUIRED` |
| 13 | `approved` only: `getAccountInfo(intent, ...)`. Refuse if the account is missing, `owner != programId`, `data.length != 126`, the discriminator is not `[150,220,148,182,20,199,128,11]` (`IntentAuthorization`), `authority` (`data[8..40]`) differs from `human`, or `agent` (`data[40..72]`) differs from `policy.agent`. | `INTENT_INVALID` |
| 14 | `approved` only: recompute the action hash (section 6) with `max_uses` = u16 LE `data[120..122]` and `expires_at` = i64 LE `data[112..120]` of the intent, and compare it with `intent.action_hash` = `data[72..104]`. Also confirm that the PDA `["intent", human, action_hash]` equals the intent. Either one differs. | `HASH_MISMATCH` |

Without a challenge (`describeAuthorityReceipt`, used by the public receipt page) the same steps run without the payee's `nonce`, `recipient`, `mint` and `minAmount`: the transaction must contain exactly one `execute_transfer`, and the recipient, mint and amount are read from the transaction itself. This proves the authority, not that the payment answers a specific request.

Account reads use `minContextSlot = slot` of the transaction so a lagging node is not read. If the node has not reached that slot the result is `RPC_ERROR` (retrying is safe).

Challenge binding, on the payee side, before step 1:

| Check | Reason |
|---|---|
| No challenge with that `nonce` was ever issued by this payee. | `CHALLENGE_UNKNOWN` |
| The challenge was already redeemed. | `CHALLENGE_CONSUMED` |
| `now > challenge.expiresAt`. | `CHALLENGE_EXPIRED` |

A challenge is marked redeemed only **after** the whole algorithm returns `ok: true`. A refusal does not burn the challenge.

Full list of reasons: `RPC_ERROR`, `TX_NOT_FOUND`, `TX_FAILED`, `NOT_PULSO_TRANSFER`, `NONCE_MISMATCH`, `RECIPIENT_MISMATCH`, `MINT_MISMATCH`, `AMOUNT_TOO_LOW`, `BALANCE_MISMATCH`, `POLICY_INVALID`, `AUTHORITY_NOT_ACCEPTED`, `APPROVAL_REQUIRED`, `INTENT_INVALID`, `HASH_MISMATCH`, `CHALLENGE_UNKNOWN`, `CHALLENGE_CONSUMED`, `CHALLENGE_EXPIRED`. Only `RPC_ERROR` and `TX_NOT_FOUND` are worth retrying.

### Why reading the policy now is safe

- `human` and `agent` are written in one place only, at `init` in `create_policy`. No other instruction assigns them. `update_policy` changes only `enabled`, limits and `policy_version`; `revoke_agent` only sets `agent_revoked`.
- No `close`, `realloc` or lamport withdrawal exists in the program, so the policy account is never closed. Its address is the PDA `["policy", human, agent]`.
- Therefore the `(human, agent)` read today are the ones at execution time.
- The same holds for the intent: `authority`, `agent`, `action_hash`, `expires_at` and `max_uses` are assigned only at `init` in `record_intent`, and the account is never closed. Only `used_count` and `revoked` change later, and neither enters the recomputation.

This guarantee belongs to the **current** program code. See section 8.

## 6. Recomputed action hash

The canonical definition is in `programs/pulso/src/action_hash.rs` and `sdk/src/intent.ts` (`computeActionHash`), and in PULSO-RFC-0001. SHA-256 over 216 bytes in this order, with no separator:

| Field | Bytes | Value in the receipt |
|---|---|---|
| domain | 15 | ASCII `PULSO_INTENT_V1` |
| chain | 6 | ASCII `solana` |
| program_id | 32 | `programId` |
| instruction | 1 | `1` (execute_transfer) |
| authority | 32 | `human` |
| agent | 32 | `agent` |
| mint | 32 | `mint` (step 7) |
| amount | 8 | `amount`, u64 LE (from the instruction) |
| recipient | 32 | `recipient` (token account) |
| max_uses | 2 | `intent.max_uses`, u16 LE |
| nonce | 16 | `nonce` (from the instruction) |
| expires_at | 8 | `intent.expires_at`, i64 LE |

A verifier should reuse `computeActionHash` instead of reimplementing it. `hashVerified: true` means: the human recorded, with their own key, a hash that covers exactly this recipient, mint, amount and nonce.

## 7. Binding to the payee's request

1. The payee generates a random 16-byte nonce and issues the **challenge**:

```json
{
  "scheme": "pulso-receipt-v1",
  "cluster": "devnet",
  "programId": "4jdH...dQi",
  "recipient": "<destination token account>",
  "mint": "<mint>",
  "minAmount": "1000000",
  "nonce": "<32 hex>",
  "expiresAt": 1790000000
}
```

2. The agent calls `execute_transfer(amount, nonce)` with that nonce and a `recipient` equal to the requested account.
3. The payee receives the signature and verifies it (section 5).

**In `approved` mode** the nonce is part of the action hash (section 6). The human approved exactly that challenge: that recipient, amount and nonce. A changed nonce changes the hash and the program refuses (`IntentMismatch`).

**In `autonomous` mode** the program only **carries** the nonce: it arrives as an argument and is neither read nor checked. Binding to the challenge is done purely by the verifier, comparing the instruction argument with the challenge. That is enough for the payee because the nonce is inside the message the agent signed.

**Single use is the payee's responsibility.** The program does not stop the same signature from being presented twice, nor two challenges from using the same nonce. The SDK ships a minimal **in-memory** ledger (`ChallengeLedger`): `issue(...)` issues and stores, `redeem(nonce)` marks a challenge redeemed once. It is single-process and demonstration level. It does not survive a restart and does not serve several processes. Production should use the payee's own storage.

The signature is a bearer proof. Whoever copies it from the chain can present it before the agent does. Since the payment already reached the payee's account for that challenge, the effect is that the payee releases the service to whoever presented first. Authenticating the presenter is out of scope for v1.

### Mint and received amount

The program requires `recipient.mint == vault.mint`, but the mint is not in the instruction data or accounts. It therefore comes from `meta.postTokenBalances`.

- The RPC returns `mint`, `owner` and `uiTokenAmount.amount` (a string in minimum units) for every token account touched by the transaction, including zero-balance ones. This is workable for the use case (legacy Token program, existing account).
- **Where it is not workable:** a node that omits `pre/postTokenBalances` (transaction too old for the node, or pruned history), or an old node that does not list zero-balance accounts in `pre`. Verification then fails closed (`MINT_MISMATCH` if the post entry is missing, `BALANCE_MISMATCH` if the pre entry is missing). There is no plan B in v1: the mint is not inferred any other way.
- Step 9 is only defense in depth. Several transfers to the same recipient in one transaction only make the increase larger than `amount`, never smaller.

## 8. What it proves and what it does not

**It proves**, from public chain state:

- A `human` key **different** from the agent's key defined the policy (per-transaction and daily limits, approval for large amounts or new recipients) and is the only key that can change it.
- The payment of `amount` from the vault to `recipient` happened at that `slot`, passing the checks of `execute_transfer`: active policy, agent not revoked, limits respected.
- In `approved` mode, the same `human` key signed a hash covering that exact action, and the program consumed it.

**It does not prove:**

- **Identity.** Not even that `human` is a person. Anyone can create a policy in which they control both keys, `human` and `agent`. The receipt says "a second key defined this", not "an accountable person defined this".
- **That the human saw or understood the payment** in `autonomous` mode. There only the delegated limit applies.
- **That the good or service paid for is what the agent wanted.** PULSO does not interpret purchases.

**Against the first point: `acceptedAuthorities`.** The payee can refuse any `human` outside a list of keys it already knows (step 11). Because the list is the payee's, the mapping from key to identity happens **off-chain** (registration, contract, the payee's own checks). PULSO does not try to solve identity on-chain.

**Trust in the program.** The receipt is worth as much as the code at that program ID. The program is upgradeable by its upgrade authority and **has not been audited**. A future version could change what `execute_transfer` checks, or add a `close`, without changing the ID. A possible mitigation, outside v1, is for the payee to pin the hash of the deployed binary or to require an immutable program. The receipt states what the program at that ID did at that slot.

**Publicity.** Everything in the receipt is public: anyone reading the chain sees policy, human, agent, recipient and amount. The receipt adds no information, it only gathers it.

## 9. Later state

The receipt states **what happened at that `slot`**. Nothing that happens afterwards invalidates it:

- Pausing (`enabled = false`), `revoke_agent`, `revoke_intent`, a later change of limits or `policy_version` do not enter the verdict.
- `intent.used_count`, `intent.revoked`, `policy.spent_in_window` and `agent_revoked` change over time and are **not read as criteria**: the policy read today may be stricter than it was at execution.
- What the verifier does read (`human`, `agent`, `authority`, `action_hash`, `expires_at`, `max_uses`) is immutable (section 5).
- The `recipient_approval` account (position 6) does not enter the v1 verdict: the program result already includes it, since the transaction only succeeded if the new-recipient rule passed.

If the payee needs to know whether the agent **still** has authority, that is a different question, about current state, and is outside the receipt.

## 10. Fail closed: what the verifier never does

- It never returns `ok: true` with a skipped step or with data it could not read.
- It never trusts logs, events, instruction names or text.
- It never accepts an inner instruction (CPI).
- It never uses a weaker commitment than requested. `processed` is not an option.
- It never holds secrets: it only reads the public chain.

**Commitment.** `confirmed` (default) is voted by a supermajority but can, rarely, be dropped by a fork. It is fast (seconds); the risk is releasing the service and then losing the transaction. `finalized` is never reverted but slower (around half a minute or more); the risk is user-experience delay. The receipt records the commitment used.

## 11. HTTP 402 and x402

**The demo uses its own scheme over the HTTP 402 status, `pulso-receipt-v1`. It does not claim compatibility with x402.**

Flow:

1. The client requests the resource without proof. The server answers `402 Payment Required` with the challenge of section 7 as the JSON body.
2. The agent pays through `execute_transfer` with the challenge nonce.
3. The client repeats the request with the headers `X-PULSO-Receipt: <base58 signature>` and `X-PULSO-Challenge: <nonce hex>` (the server needs to know which challenge is being redeemed).
4. The server runs the algorithm of section 5. `ok: true` releases the resource; otherwise it answers 402 with the `reason` and a new challenge.

**What was read of x402** (read on 2 October 2026): the x402 specification v2 and its `exact` scheme for SVM. The server answers with a `PaymentRequired` object; the client resends with a `PAYMENT-SIGNATURE` header; between server and facilitator there are verify and settle steps. The `exact` scheme on Solana is client-driven: the client signs a **partially signed** transaction, the facilitator is the `feePayer`, checks the layout, signs and submits later.

| Point | x402 `exact` (SVM) | `pulso-receipt-v1` |
|---|---|---|
| When it settles | After verification, by the facilitator | **Before**: the transaction is already on-chain and the server only verifies |
| Proof sent | Partially signed base64 transaction | Signature of an already confirmed transaction |
| Payment instruction | Token or Token-2022 `TransferChecked`, 3 to 6 instructions in a fixed order | PULSO `execute_transfer`, which would not pass the facilitator's layout check |
| Who pays the fee | The facilitator | The agent |
| Binding to the request | `extra.memo` or a random nonce | 16-byte nonce in the `execute_transfer` arguments |
| Destination | ATA of `(payTo, asset)` | Explicit token account |

What would be missing: a new scheme registered in x402 with a facilitator that understands `execute_transfer` and the PULSO accounts; the `PAYMENT-SIGNATURE` header carrying the scheme payload; a choice between post-settlement proof (this model) and a pre-signed transaction; and a binding through `memo`, or x402 accepting the nonce in the arguments. None of this was implemented or tested. **Compatibility: not verified.** The x402 HTTP transport specification and schemes other than `exact` SVM were not read; any claim about them is unverified.

## 12. Out of scope for v1

- Inner instructions (CPI) and transactions where PULSO is called by another program.
- Token-2022 (the IDL fixes the legacy Token program).
- Authenticating who presents the signature.
- A persistent or cross-process challenge registry.
- The identity of `human` and any check of who the person is.
- Verifying that the deployed program is the expected code.
- Anything semantic: category, product, description of the purchase.

## Feedback

This is an open request for comment. If you implement a verifier, find an ambiguity, a mismatch between this text and the code, or a security concern, please open an issue in the public repository: [`MarioMatheusPombal/pulso-solana`](https://github.com/MarioMatheusPombal/pulso-solana/issues). Include the section number and the transaction signature.
