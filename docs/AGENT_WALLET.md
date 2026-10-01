> **NOT AUDITED · DEVNET DEMONSTRATION ONLY.** Prototype architecture, not production custody.
> Published spec — see the [README](../README.md) for context.

# PULSO Agent Wallet

## Conceito

Uma wallet para agentes que não recebem autoridade irrestrita sobre fundos.

Modelo tradicional:

```text
agent has private key
↓
agent can sign
↓
agent can spend
```

Modelo PULSO:

```text
agent requests action
↓
policy evaluated
↓
autonomous OR human-gated OR forbidden
```

## Exemplo

```text
PULSO AGENT WALLET

Balance: 1,000 USDC
Agent: Travel Assistant

AUTONOMOUS
✓ APIs up to 2 USDC
✓ airline fee up to 20 USDC
✓ max 50 USDC/day

HUMAN APPROVAL
! flight purchases
! hotels
! new recipients
! payments > 20 USDC

FORBIDDEN
× transfer wallet authority
× edit own policy
× unlimited delegation
```

## SDK conceitual

```ts
const result = await pulso.execute({
  type: "transfer",
  mint: USDC,
  amount: 250,
  recipient: merchant
})

if (result.status === "HUMAN_INTENT_REQUIRED") {
  console.log(result.approvalUrl)
}
```

## x402 future

Pequenos pagamentos de API podem ocorrer automaticamente dentro do budget; valores acima da policy exigem aprovação humana.

O diferencial não é swap, portfolio ou UI. É **programmable delegated authority**.
