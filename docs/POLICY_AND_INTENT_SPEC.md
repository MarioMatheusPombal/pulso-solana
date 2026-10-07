<img src="../assets/chalk-v1/readme/docbar.png" alt="PULSO: human authorization for AI agents. NOT AUDITED · DEVNET DEMONSTRATION ONLY." width="100%">

# PULSO-RFC-0001: Policy and Intent Specification

| | |
|:--|:--|
| **Identifier** | PULSO-RFC-0001 |
| **Version** | v0.1.0-draft |
| **Date** | 2026-10-01 |
| **Status** | Draft, open for comment |
| **Action hash domain** | `PULSO_INTENT_V1` |
| **Reference implementation** | `programs/pulso` (Rust, Anchor) and `sdk/` (TypeScript) in this repository |

> **NOT AUDITED · DEVNET DEMONSTRATION ONLY.** This is a prototype specification, not production custody. Nothing here has been audited.

To cite: "PULSO-RFC-0001 v0.1.0-draft, Policy and Intent Specification". Feedback is welcome, see [section 13](#13-versioning-and-feedback).

## 1. Abstract and scope

PULSO is a layer of human authorization for AI agents that move SPL tokens on Solana. A human delegates *limited* spending authority to an agent through an on-chain **policy**. Actions outside the policy need a human-signed **intent** that is bound to one exact action by a canonical **action hash**. The Solana program enforces both; no off-chain service is trusted to enforce them.

This document specifies the policy account, the intent account, the order of checks in `execute_transfer`, the action hash (v1), the error codes, and the emitted events. Everything stated here corresponds to the reference implementation in this repository at the time of writing. Where this text and the code disagree, the code is authoritative and the text is a bug: please report it.

### Goals

- Delegated, bounded authority: an agent can act only inside limits the human set, and nothing the agent does can enlarge them.
- Exact, scoped, expiring, use-counted, non-reusable human approval for actions outside those limits.
- A hash format simple enough that a third party can implement a verifier from this document and the test vectors alone.

### Non-goals

- PULSO does **not** interpret natural language and does not read prompts.
- PULSO does **not** decide, rank or recommend actions. It only checks whether an action is within delegated authority, or has been explicitly authorized.
- PULSO is not a custody product and does not define key management for the human.

## 2. Terminology

The key words MUST, MUST NOT, SHOULD and MAY are used as in RFC 2119.

| Term | Meaning |
|:--|:--|
| **Human authority** | The wallet (public key) that owns a policy. Only it can create or change the policy, record or revoke intents, approve recipients, and revoke the agent. |
| **Agent** | A public key that signs `execute_transfer`. It never has authority over its own limits. |
| **Policy** | The `AgentPolicy` account: limits and flags for one (human, agent) pair. |
| **Vault** | A token account whose owner is the policy PDA. Only the program can sign for it, so funds move only through instructions that evaluate the policy. |
| **Intent** | The `IntentAuthorization` account: a human-recorded authorization identified by an action hash, with expiry and a use counter. |
| **Action hash** | SHA-256 over a fixed 216-byte preimage that binds every parameter of one action (section 7). |
| **Recipient** | The address of the destination *token account*, not the wallet of its owner. |

## 3. Policy

### 3.1 Account

`AgentPolicy`, seeds `["policy", human, agent]` under the program ID. One policy exists per (human, agent) pair.

| Field | Type | Meaning |
|:--|:--|:--|
| `human` | pubkey | Human authority. |
| `agent` | pubkey | The delegated agent. |
| `enabled` | bool | Pause switch. `true` on creation. |
| `max_per_transaction` | u64 | Hard cap per transfer, in base units of the mint. |
| `daily_limit` | u64 | Cap on the sum of transfers in one window (section 4.4). |
| `require_approval_for_new_recipient` | bool | If set, a destination without a `RecipientApproval` needs an intent. |
| `require_approval_above` | u64 | Transfers with `amount` strictly greater than this need an intent. |
| `policy_version` | u32 | Starts at 1, incremented on each `update_policy`. |
| `spent_in_window` | u64 | Daily counter (section 4.4). |
| `window_start` | i64 | Unix time at which the current window opened; `0` until the first spend. |
| `bump` | u8 | PDA bump. |
| `agent_revoked` | bool | Permanent revocation of the agent. |

### 3.2 Validation

On `create_policy` and `update_policy` the program MUST require

```
require_approval_above <= max_per_transaction <= daily_limit
```

otherwise it fails with `InvalidPolicyLimits` (outside the PULSO_001..011 range, section 10).

### 3.3 Who can change what

- `create_policy`, `update_policy`, `create_vault`, `record_intent`, `approve_recipient` and `revoke_agent` MUST be signed by the policy's human. A different signer fails with `PolicyChangeForbidden` (PULSO_011). `revoke_intent` MUST be signed by the intent's `authority`, with the same error.
- The agent does not sign `create_policy`. It signs only `execute_transfer`.
- A policy MUST NOT be able to widen itself through the agent: no instruction signed by the agent writes to `AgentPolicy` limits. (`execute_transfer` updates only `spent_in_window` and `window_start`.)
- `update_policy` takes the full set of mutable fields (`enabled` and the four limits) and replaces them. It does not reset `spent_in_window` or `window_start`.

### 3.4 Pause and revocation

`enabled = false` pauses the agent and can be reversed by `update_policy`. `revoke_agent` sets `agent_revoked = true`; this is permanent: no instruction clears it. Both are checked at the start of `execute_transfer`.

## 4. Checks performed by `execute_transfer`

Inputs: `amount` (u64), `nonce` (16 bytes), the agent signer, the policy, the vault, the destination token account, and two optional accounts, `intent` and `recipient_approval`. The vault is the PDA with seeds `["vault", policy]` and holds one mint (section 11). The destination MUST be a token account of the vault's mint.

### 4.1 Steps common to both paths

1. `enabled` is false: fail `PolicyDisabled` (PULSO_002).
2. The signer is not `policy.agent`, or `agent_revoked`: fail `UnauthorizedAgent` (PULSO_010).

### 4.2 Without intent

3. `amount > max_per_transaction`: fail `AmountExceedsLimit` (PULSO_008).
4. Let `new_recipient = require_approval_for_new_recipient AND no recipient_approval was supplied`. If `new_recipient` or `amount > require_approval_above`, the program emits `IntentRequired` and fails:
   - `RecipientNotAllowed` (PULSO_007) if `new_recipient`;
   - otherwise `HumanIntentRequired` (PULSO_003).

   When both conditions hold, PULSO_007 wins.
5. Continue to the daily limit (4.4).

### 4.3 With intent

When the `intent` account is supplied, checks run in this order:

3. `intent.authority != policy.human` or `intent.agent != policy.agent`: fail `IntentMismatch` (PULSO_006).
4. `intent.revoked`: fail `IntentRevoked` (outside the spec range).
5. `now > intent.expires_at`: fail `IntentExpired` (PULSO_004). The intent is valid *through* `expires_at`, inclusive. `now` is the on-chain `Clock`, never client time.
6. `used_count >= max_uses`: fail `IntentAlreadyUsed` (PULSO_005).
7. The program recomputes the action hash from the real transaction (section 7) and compares it with `intent.action_hash`. Different: fail `IntentMismatch` (PULSO_006). The recomputation uses `max_uses` and `expires_at` from the stored intent, `amount` and `nonce` from the instruction, `mint` from the vault, `recipient` from the destination account, and `authority`/`agent` from the policy.
8. `amount > max_per_transaction`: fail `AmountExceedsLimit` (PULSO_008). The per-transaction cap is hard: human approval does not lift it. Approval also does not consult the recipient allowlist or `require_approval_above`; the recipient is bound by the hash instead.
9. Continue to the daily limit (4.4).

### 4.4 Daily limit and consumption (both paths)

The window is **fixed**, not sliding, and lasts 86,400 seconds. If `now >= window_start + 86400` (saturating add), then `spent_in_window` is reset to 0 and `window_start` is set to `now`. Since `window_start` is 0 on creation, the first spend opens the first window at its own `now`. The window covers `[window_start, window_start + 86400)`.

Then `spent = spent_in_window + amount`. On u64 overflow, or if `spent > daily_limit`, fail `DailyLimitExceeded` (PULSO_009).

Finally, on the intent path `used_count` is incremented (a checked add), the SPL transfer is executed by a CPI signed by the policy PDA, `spent_in_window` is set to `spent`, and `TransferExecuted` is emitted. Consumption is **atomic** with the transfer: if anything fails, the whole transaction reverts, including the increment of `used_count`.

A transaction that returns an error reverts all state, including the window reset described above. Intent consumption therefore never happens without a transfer.

## 5. Intent

### 5.1 Account

`IntentAuthorization`, seeds `["intent", authority, action_hash]`. Because of the seeds, at most one intent exists per (authority, action_hash); creating a duplicate fails.

| Field | Type | Meaning |
|:--|:--|:--|
| `authority` | pubkey | The human who recorded it. |
| `agent` | pubkey | Copied from the policy at recording time. |
| `action_hash` | [u8; 32] | The hash of the authorized action. |
| `issued_at` | i64 | `Clock` time at recording. |
| `expires_at` | i64 | Last valid second (inclusive). |
| `max_uses` | u16 | Number of times the intent may be consumed. |
| `used_count` | u16 | Times consumed so far. |
| `revoked` | bool | Set by `revoke_intent`. |
| `bump` | u8 | PDA bump. |

### 5.2 Lifecycle

1. **Recording.** The human signs `record_intent(action_hash, expires_at, max_uses)`. It MUST satisfy `expires_at > now` and `max_uses > 0`, else `InvalidIntent`. The program does **not** recompute the hash at this point: the human signs the hash that the client built from the payload it displayed. The hash is checked against the real action at execution.
2. **Consumption.** The agent supplies the intent to `execute_transfer` (section 4.3). Each successful transfer adds 1 to `used_count`.
3. **Expiry.** Valid while `now <= expires_at`.
4. **Revocation.** The human calls `revoke_intent`. A fully consumed intent (`used_count >= max_uses`) cannot be revoked: the call fails with `IntentAlreadyUsed`. A revoked intent fails at execution with `IntentRevoked`.

An intent is *scoped* (one action), *expiring*, *use-counted* and *not reusable* beyond `max_uses`. A client SHOULD use a fresh random `nonce` for every intent.

## 6. Recipient allowlist

`RecipientApproval`, seeds `["recipient", policy, recipient]`, fields `policy`, `recipient`, `bump`. Only the human creates it (`approve_recipient`, otherwise PULSO_011). `recipient` is the address of a destination token account. There is no instruction to remove an approval in v0.1.0. The allowlist is only consulted on the path without intent, and only if `require_approval_for_new_recipient` is set (section 4.2).

## 7. Action hash v1

`action_hash = SHA-256(preimage)`, where the preimage is the concatenation, in this order, of fixed-size fields. There are no separators, no length prefixes and no JSON.

| # | Field | Size (bytes) | Encoding |
|:-:|:--|--:|:--|
| 1 | domain | 15 | ASCII `PULSO_INTENT_V1` |
| 2 | chain | 6 | ASCII `solana` |
| 3 | program_id | 32 | raw public key bytes |
| 4 | instruction | 1 | u8; `1` = `execute_transfer` (SPL transfer) |
| 5 | authority | 32 | raw public key bytes (the human) |
| 6 | agent | 32 | raw public key bytes |
| 7 | mint | 32 | raw public key bytes |
| 8 | amount | 8 | u64, little-endian |
| 9 | recipient | 32 | raw public key bytes (destination token account address) |
| 10 | max_uses | 2 | u16, little-endian |
| 11 | nonce | 16 | raw bytes |
| 12 | expires_at | 8 | i64, little-endian, two's complement |
| | **Total** | **216** | |

Canonicalization rules:

- Public keys are the 32 raw bytes, never the base58 text.
- Integers are fixed width and little-endian. `expires_at` is signed; a negative value is encoded in two's complement (see the `-1` vector).
- The nonce is exactly 16 bytes; any other length is invalid.
- `amount` is in base units of the mint (not decimal-adjusted).
- Values outside the range of their type (for example `amount` above 2^64 - 1) MUST be rejected by the encoder, not truncated.
- Only `instruction = 1` is defined in v1.
- The hash binds the program ID. The vectors use `7rkj3PDx98aZBVR7yt1cLJFmasQJQR5ihs5NpJuWoeGT`, a former development ID, only as test data; it is not the deployed program address.

## 8. Test vectors

All vectors live in [`tests/vectors/action_hash.json`](../tests/vectors/action_hash.json) (six cases: `base`, `amount_changed`, `recipient_changed`, `max_uses_and_nonce_changed`, `max_amount_and_negative_expiry`, `zero_pubkeys_and_zero_values`). The program and the TypeScript SDK both reproduce them. Two are copied here verbatim.

Common to both: `program_id = 7rkj3PDx98aZBVR7yt1cLJFmasQJQR5ihs5NpJuWoeGT`, `instruction = 1`, `authority = 4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi`, `agent = 8qbHbw2BbbTHBW1sbeqakYXVKRQM8Ne7pLK7m6CVfeR`, `mint = CktRuQ2mttgRGkXJtyksdKHjUdc2C4TgDzyB98oEzy8`, `nonce = 000102030405060708090a0b0c0d0e0f` (hex), `expires_at = 1893456000`.

**Vector `base`**

```json
{
  "amount": "1000000",
  "recipient": "GgBaCs3NCBuZN12kCJgAW63ydqohFkHEdfdEXBPzLHq",
  "max_uses": 1,
  "hash": "100561e1ef2c9651a4f61cbfee187ff73b0b3b582431ddcc4fe3f1afd9dbe10a"
}
```

**Vector `amount_changed`** (only `amount` differs, the hash is entirely different)

```json
{
  "amount": "1000001",
  "recipient": "GgBaCs3NCBuZN12kCJgAW63ydqohFkHEdfdEXBPzLHq",
  "max_uses": 1,
  "hash": "9f40e31264a8cb0ee4e9ff653c742a3e908566e815ec358bd0f4b5aeac540671"
}
```

**Vector `max_amount_and_negative_expiry`** (edge values: `amount = 18446744073709551615`, `expires_at = -1`)

```json
{
  "amount": "18446744073709551615",
  "recipient": "GgBaCs3NCBuZN12kCJgAW63ydqohFkHEdfdEXBPzLHq",
  "max_uses": 1,
  "nonce": "000102030405060708090a0b0c0d0e0f",
  "expires_at": "-1",
  "hash": "862a8c0727e816c158ca97156ee688f7db37ad8290248865c31ac755875831d6"
}
```

The JSON encodes `amount` and `expires_at` as decimal strings (they exceed the safe range of a JSON number), `nonce` as lowercase hex, `hash` as lowercase hex of the 32 digest bytes, and public keys as base58.

### Verifying your own implementation

1. Read `tests/vectors/action_hash.json`.
2. For each vector, decode the base58 keys to 32 bytes, parse the integers, decode the nonce from hex, and build the 216-byte preimage of section 7.
3. Compute SHA-256 and compare, as lowercase hex, with `hash`. All six MUST match; a single mismatch means a field order, width or endianness error.
4. Also check that your encoder rejects a nonce that is not 16 bytes and integers out of range.

A reference encoder is in [`sdk/src/intent.ts`](../sdk/src/intent.ts) (`computeActionHash`) and in `programs/pulso/src/action_hash.rs`.

## 9. Events

Events are emitted by the program as Anchor events (base64 in the transaction logs). They contain only public keys, numbers, hashes and booleans.

| Event | Fields |
|:--|:--|
| `PolicyCreated` | `policy`, `human`, `agent`, `max_per_transaction`, `daily_limit`, `require_approval_for_new_recipient`, `require_approval_above`, `policy_version` |
| `PolicyUpdated` | `policy`, `human`, `agent`, `enabled`, `max_per_transaction`, `daily_limit`, `require_approval_for_new_recipient`, `require_approval_above`, `policy_version` |
| `AgentRevoked` | `policy`, `human`, `agent` |
| `RecipientApproved` | `policy`, `recipient` |
| `IntentRecorded` | `intent`, `policy`, `authority`, `agent`, `action_hash`, `expires_at`, `max_uses` |
| `IntentRevocation` | `intent`, `authority` |
| `TransferExecuted` | `policy`, `agent`, `mint`, `recipient`, `amount`, `spent_in_window`, `intent` (optional pubkey) |
| `IntentRequired` | `policy`, `human`, `agent`, `mint`, `recipient`, `amount`, `require_approval_above`, `policy_version` |

`IntentRequired` is emitted immediately before `execute_transfer` fails with PULSO_003 or PULSO_007. An Anchor error carries no data, so a client reads the event from the logs of the failed transaction (or of a simulation of it) and uses it to build the approval request that the human will see and sign. Because the transaction fails, the event is not stored on-chain; it exists only in the logs of that attempt.

## 10. Error codes

An Anchor custom error code is `6000 + position` of the variant in the enum, so PULSO_00N is `6000 + N - 1`. The order is part of the public interface: variants MUST NOT be reordered or inserted. Errors outside the spec are appended after the first eleven.

| Spec code | Anchor | Occurs when |
|:--|:-:|:--|
| PULSO_001_POLICY_NOT_FOUND | 6000 | See note below. |
| PULSO_002_POLICY_DISABLED | 6001 | `enabled` is false. |
| PULSO_003_HUMAN_INTENT_REQUIRED | 6002 | No intent and `amount > require_approval_above`. |
| PULSO_004_INTENT_EXPIRED | 6003 | `now > expires_at`. |
| PULSO_005_INTENT_ALREADY_USED | 6004 | `used_count >= max_uses`; also `revoke_intent` on a fully consumed intent. |
| PULSO_006_INTENT_MISMATCH | 6005 | Intent authority or agent differs from the policy, or the recomputed hash differs from the stored one. |
| PULSO_007_RECIPIENT_NOT_ALLOWED | 6006 | No intent, new-recipient approval required, destination not allowlisted. |
| PULSO_008_AMOUNT_EXCEEDS_LIMIT | 6007 | `amount > max_per_transaction`, on either path. |
| PULSO_009_DAILY_LIMIT_EXCEEDED | 6008 | `spent_in_window + amount > daily_limit` or overflow. |
| PULSO_010_UNAUTHORIZED_AGENT | 6009 | Signer is not the policy's agent, or the agent is revoked. |
| PULSO_011_POLICY_CHANGE_FORBIDDEN | 6010 | A policy or intent mutation not signed by the owning human. |

Outside the spec (appended):

| Name | Anchor | Occurs when |
|:--|:-:|:--|
| InvalidPolicyLimits | 6011 | The ordering in section 3.2 is violated. |
| InvalidIntent | 6012 | `record_intent` with `expires_at <= now` or `max_uses = 0`. |
| IntentRevoked | 6013 | `execute_transfer` with a revoked intent. |

**Policy not found.** The program cannot return 6000 itself. A policy account that does not exist fails Anchor's own account check, error **3012** (`AccountNotInitialized`), before any program code runs. A client MUST treat 3012 on the `policy` account as PULSO_001_POLICY_NOT_FOUND. The TypeScript SDK exposes the table in `sdk/src/errors.ts`.

## 11. Security and privacy considerations

- **Nothing semantic on-chain.** Accounts and events hold only public keys, hashes, limits, timestamps, counters and status flags. No names, document numbers, addresses, prompts or free text are stored or emitted. The *reason* for a payment never reaches the chain.
- **Enforcement is in the program.** The vault is owned by the policy PDA, so the agent cannot move funds by calling the token program directly. Any backend that helps build or route approval requests is a convenience, not a source of authority: if it is compromised or offline, the program still enforces policy and still rejects an intent whose hash does not match.
- **The human's key.** The human signs `record_intent` and policy changes with their own wallet. A client SHOULD show the human the exact fields that go into the hash, not a summary, since the program trusts the signed hash (section 5.2).
- **Binding.** The hash covers chain, program, authority, agent, mint, amount, destination, use count, nonce and expiry; changing any of them yields a different hash (see the changed-field vectors).
- **Replay.** Replays are bounded by `max_uses`, the unique (authority, action_hash) intent account, the nonce and the expiry.
- **Clock.** Expiry and the daily window use only the on-chain clock.

### Known limitations of v0.1.0

- One mint per vault (one vault per policy); a policy cannot hold several assets.
- The daily window is fixed, not sliding: up to twice the daily limit can be spent in a short span around a window boundary.
- The recipient allowlist has no removal instruction.
- Only SPL token transfer (`instruction = 1`) is covered.
- The program ID is provisional and the program is an unaudited prototype for devnet demonstration.

## 12. Compatibility

This RFC describes a single mint per vault, as implemented: the vault's mint is read from the vault token account at execution and is bound into the hash.

## 13. Versioning and feedback

The domain prefix `PULSO_INTENT_V1` versions the action hash. A change to the preimage layout, to the order of checks, or to the meaning of any field MUST use a new domain prefix (for example `PULSO_INTENT_V2`) so that hashes from different versions can never collide. Error codes 6000-6010 are stable; additions go after them. This document's own version (`v0.1.0-draft`) will change as the text is revised, independently of the hash version.

**This is an open request for comment.** If you implement a verifier, find an ambiguity, a mismatch between this text and the code, or a security concern, please open an issue in the public repository: [`MarioMatheusPombal/pulso-solana`](https://github.com/MarioMatheusPombal/pulso-solana/issues). Include the RFC identifier and version, the section number, and, for hash disagreements, the vector name and your computed digest.
