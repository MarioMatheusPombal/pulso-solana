> **NOT AUDITED · DEVNET DEMONSTRATION ONLY.** Prototype architecture, not production custody.
> Published spec — see the [README](../README.md) for context.

# PULSO × Solana — On-chain Architecture

## Visão

```text
Human
  ↓ biometric/sign
PULSO App
  ↓ exact approval
Solana
  ├── Policy PDA
  ├── Intent PDA
  └── PULSO Program
          ↓ allow/reject
       AI Agent
          ↓
    USDC / SPL / Programs
```

## AgentPolicy PDA

Seed conceitual:

```text
["policy", human_pubkey, agent_pubkey]
```

Campos:

```rust
pub struct AgentPolicy {
    pub human: Pubkey,
    pub agent: Pubkey,
    pub enabled: bool,
    pub max_per_transaction: u64,
    pub daily_limit: u64,
    pub require_approval_for_new_recipient: bool,
    pub require_approval_above: u64,
    pub policy_version: u32,
    pub bump: u8,
}
```

## IntentAuthorization PDA

```text
["intent", authority, intent_hash]
```

```rust
pub struct IntentAuthorization {
    pub authority: Pubkey,
    pub agent: Pubkey,
    pub action_hash: [u8; 32],
    pub issued_at: i64,
    pub expires_at: i64,
    pub max_uses: u16,
    pub used_count: u16,
    pub revoked: bool,
    pub bump: u8,
}
```

## Action hash

Deve vincular version, chain, program, instruction, agent, asset, amount, recipient, constraints, nonce e expiration.

## Lifecycle

Dentro da policy: execute automaticamente.

Fora da policy: `HUMAN_INTENT_REQUIRED`.

Depois da aprovação humana, o agent repete exatamente a mesma ação. O program verifica hash, validade, uso e authority antes de permitir.

## Enforcement no MVP

Para hackathon, o caminho mais demonstrável é um **program-controlled demo vault** em devnet. Isso garante enforcement real e evita que o agente simplesmente ignore o backend.

A demo deve deixar explícito: **prototype architecture ≠ audited production custody**.

## Privacidade

Não colocar nome, CPF, endereço, prompt ou histórico pessoal on-chain. Armazenar pubkeys, hashes, limites, timestamps e status.

## Framework

Para velocidade: **Anchor + Rust**.
