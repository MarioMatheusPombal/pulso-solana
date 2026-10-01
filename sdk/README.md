# @pulso/sdk

NOT AUDITED · DEVNET DEMONSTRATION ONLY

TypeScript SDK for PULSO. Today it builds and hashes an intent on the client, byte for byte
the same as the on-chain program (`programs/pulso/src/action_hash.rs`, shared vectors in
`tests/vectors/action_hash.json`). Runs in Node and in the browser.

```ts
import { buildIntent } from "@pulso/sdk";

const { fields, nonce, actionHash } = buildIntent({
  programId, authority, agent, mint, recipient, // PublicKey
  amount: 1_000_000n,
  expiresAt: BigInt(Math.floor(Date.now() / 1000) + 3600),
}); // maxUses defaults to 1; nonce is 16 random bytes (keep it to repeat the action)
```

## Agent client

```ts
import { PulsoClient } from "@pulso/sdk";

const pulso = new PulsoClient({ connection, agent /* Keypair */, human /* PublicKey */, approvalsUrl, activityUrl });

// Blocked actions do not throw: they come back as HUMAN_INTENT_REQUIRED.
const r = await pulso.execute({ amount: 100_000_000n, recipient /* destination token account */ });
if (r.status === "HUMAN_INTENT_REQUIRED") {
  console.log(r.approvalUrl);                 // where the human approves (needs approvalsUrl)
  await pulso.waitForApproval(r);             // polls with backoff; ApprovalTimeoutError / ApprovalDeniedError
  await pulso.executeApproved(r);             // repeats the exact stored action, nothing rebuilt
}

// Or all at once:
await pulso.executeAndWait({ amount: 100_000_000n, recipient });
```

Other PULSO errors (daily limit, cap, unauthorized agent, missing policy...) throw `PulsoProgramError`.
`activityUrl` is optional and only sends structured display telemetry to `/api/activity`. No URL means no activity request. Logging is best-effort and bounded; it never authorizes a transfer or changes a chain result. Without `approvalsUrl`, no approval request is sent; the human records the intent on-chain directly.
The program IDL is versioned in `src/idl/`; refresh it with `pnpm idl` at the repo root.

## Agent tool gate

`createPulsoTransferGate` adapts framework tool inputs to the SDK's supported SPL transfer. It accepts a decimal amount string and a destination token account in base58, then returns a JSON-safe result. It never calls a separate financial callback: the transfer itself goes through `PulsoClient.execute` and the on-chain program.

```ts
import * as z from "zod";
import { tool } from "langchain";
import { createPulsoTransferGate } from "@pulso/sdk";

const gateTransfer = createPulsoTransferGate(pulso);
const transfer = tool(
  ({ amount, recipient }) => gateTransfer({ amount, recipient }),
  {
    name: "transfer_usdc",
    description: "Transfer USDC under the connected PULSO policy.",
    schema: z.object({
      amount: z.string().regex(/^(0|[1-9][0-9]*)$/).describe("Amount in token base units, as a decimal string"),
      recipient: z.string().describe("Destination SPL token account in base58"),
    }),
  },
);
```

When approval is required, the tool returns `human_intent_required`, the reason, approval URL, and exact serializable intent. The tool does not run another callback. To let the SDK wait for the human and submit only that stored intent, create the gate with `{ waitForApproval: true }`; timeout and program errors propagate to the framework. LangChain's current TypeScript tools use a handler plus a Zod input schema and accept structured object results; see [LangChain tools](https://docs.langchain.com/oss/javascript/langchain/tools).

Test: `pnpm test:sdk` · End to end (boots `solana-test-validator`; run `pnpm build` first): `pnpm test:e2e` · Typecheck: `pnpm --filter @pulso/sdk typecheck`
