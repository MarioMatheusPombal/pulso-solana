> **NOT AUDITED · DEVNET DEMONSTRATION ONLY.** Prototype architecture, not production custody.
> Published spec — see the [README](../README.md) for context.

# PULSO — Policy & Intent Specification

## Policy

```json
{
  "version": "1",
  "authority": "HUMAN_PUBKEY",
  "agent": "AGENT_PUBKEY",
  "assets": {
    "USDC": {
      "max_per_transaction": 50000000,
      "daily_limit": 100000000
    }
  },
  "approval": {
    "new_recipient": true,
    "above": 50000000
  },
  "forbidden": [
    "change_authority",
    "delegate_policy_admin"
  ]
}
```

## Intent

```json
{
  "version": "1",
  "network": "solana",
  "authority": "HUMAN_PUBKEY",
  "agent": "AGENT_PUBKEY",
  "action": {
    "type": "spl_transfer",
    "mint": "USDC_MINT",
    "amount": "250000000",
    "recipient": "MERCHANT_PUBKEY"
  },
  "scope": { "max_uses": 1 },
  "issued_at": 1790822823,
  "expires_at": 1790822943,
  "nonce": "f931..."
}
```

## Properties

Toda autorização deve ser scoped, expiring, bound, non-replayable, inspectable e verifiable.

## Error codes

```text
PULSO_001_POLICY_NOT_FOUND
PULSO_002_POLICY_DISABLED
PULSO_003_HUMAN_INTENT_REQUIRED
PULSO_004_INTENT_EXPIRED
PULSO_005_INTENT_ALREADY_USED
PULSO_006_INTENT_MISMATCH
PULSO_007_RECIPIENT_NOT_ALLOWED
PULSO_008_AMOUNT_EXCEEDS_LIMIT
PULSO_009_DAILY_LIMIT_EXCEEDED
PULSO_010_UNAUTHORIZED_AGENT
PULSO_011_POLICY_CHANGE_FORBIDDEN
```

## Least privilege

Default deny para capacidades não concedidas.

## Delegation futura

Qualquer sub-agent deve receber um escopo igual ou menor que o pai:

```text
child permission ⊆ parent permission
```
