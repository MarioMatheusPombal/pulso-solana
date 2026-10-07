<img src="../assets/chalk-v1/readme/docbar.png" alt="PULSO: human authorization for AI agents. NOT AUDITED · DEVNET DEMONSTRATION ONLY." width="100%">

> **NOT AUDITED · DEVNET DEMONSTRATION ONLY.** Prototype architecture, not production custody.
> Published spec — see the [README](../README.md) for context.

# PULSO × Solana — Security Model

## Objective

A compromised agent must not exceed the authority explicitly granted to it.

## Threats

### Compromised agent
Mitigation: on-chain policy, spending caps, exact intent, and program-controlled funds.

### Prompt injection
Mitigation: policy enforcement does not depend on the model's reasoning. An LLM can be misled; the program does not interpret natural language.

### Modified amount
Mitigation: `action_hash`.

### Modified recipient
Mitigation: recipient bound to the intent.

### Replay
Mitigation: use count (`max_uses`), nonce, and consumed state.

### Expired approval
Mitigation: `expires_at`.

### Agent edits its own limits
Mitigation: only the policy's human authority can change the policy.

### Compromised backend
The backend must not be able to issue human authorization on its own.

## Invariant

```text
AGENT_AUTHORITY
must never be able to increase
AGENT_AUTHORITY
```

Only the policy's human authority can expand the policy.

## Warning

Hackathon code must display: **NOT AUDITED. DEVNET DEMONSTRATION ONLY.**

## Privacy

Prefer `action_hash` over sensitive semantic data on-chain.
