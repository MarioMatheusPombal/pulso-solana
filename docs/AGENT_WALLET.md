<img src="../assets/chalk-v1/readme/docbar.png" alt="PULSO: human authorization for AI agents. NOT AUDITED · DEVNET DEMONSTRATION ONLY." width="100%">

> **NOT AUDITED · DEVNET DEMONSTRATION ONLY.** Prototype design, not production custody.
> Published spec — see the [README](../README.md) for context.

# PULSO Agent Wallet

## Concept

A wallet for agents that do not receive unrestricted authority over funds.

Traditional model:

```text
agent has private key
↓
agent can sign
↓
agent can spend
```

PULSO model:

```text
agent requests action
↓
policy evaluated
↓
autonomous OR human-gated OR forbidden
```

## Example

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

## Conceptual SDK

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

## Future: x402

Small API payments can happen automatically within the budget; amounts above the policy require human approval.

The differentiator is not swaps, portfolios, or UI. It is **programmable delegated authority**.
