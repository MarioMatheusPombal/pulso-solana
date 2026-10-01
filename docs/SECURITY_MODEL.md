> **NOT AUDITED · DEVNET DEMONSTRATION ONLY.** Prototype architecture, not production custody.
> Published spec — see the [README](../README.md) for context.

# PULSO × Solana — Security Model

## Objective

Um agente comprometido não deve conseguir ultrapassar a autoridade explicitamente concedida.

## Threats

### Compromised agent
Mitigação: policy program, spending caps, exact intent, program-controlled funds.

### Prompt injection
Mitigação: policy enforcement acontece fora do reasoning do modelo. O LLM pode ser enganado; o program não interpreta linguagem natural.

### Modified amount
Mitigação: action hash.

### Modified recipient
Mitigação: recipient bound to intent.

### Replay
Mitigação: one-time usage, nonce, consumed state.

### Expired approval
Mitigação: `expires_at`.

### Agent edits own limits
Mitigação: policy authority exclusiva do human/admin.

### Backend compromised
Backend não deve poder emitir autorização humana sozinho.

## Invariant

```text
AGENT_AUTHORITY
must never be able to increase
AGENT_AUTHORITY
```

Somente human/admin authority amplia policy.

## Warning

Hackathon code deve exibir: **NOT AUDITED. DEVNET DEMONSTRATION ONLY.**

## Privacy

Preferir `action_hash` a dados semânticos sensíveis on-chain.
