# PULSO SDK setup instructions

NOT AUDITED · DEVNET DEMONSTRATION ONLY

This is a generic setup prompt/document, not a universally installable SKILL.md.
Give it to your existing coding assistant after reviewing it. Visiting the page or
downloading this file does not install anything.

Help integrate PULSO into my existing agent with minimal changes:

1. Identify my OS, Node version, package manager, TypeScript framework and current
   Solana integration. Inspect existing tools/configuration; preserve other tools.
   Propose a diff before editing. Do not replace my agent or create a hosted agent.
2. Use the PULSO repository checkout, not an invented npm package. @pulso/sdk is
   private, version 0.0.0, source entry sdk/src/index.ts (workspace dependency).
   Review sdk/src/client.ts, sdk/src/errors.ts and agent-demo/src/ before proposing
   how my code consumes the source. There is no packaged SDK or managed service.
   Require Node 22 and pnpm 12; check package.json and pnpm-lock.yaml first.
   From the checkout root run:

   pnpm install --frozen-lockfile
   pnpm --filter @pulso/sdk typecheck
   pnpm test:sdk

3. Inspect PulsoClient and ExecuteParams in sdk/src/client.ts. Construct the client
   with an operator-configured Connection, local agent Keypair, human PublicKey
   and optional approvalsUrl. Use the configured vault mint and an existing SPL
   destination token account. Use bigint amounts in token base units. Do not
   invent a remote endpoint, a package install command, or a new API signature.
4. Ask the operator to configure RPC/network, public authority, vault mint,
   approvals URL and local agent signer outside model-controlled action arguments.
   Keep agent signer files outside the repository. Never request, copy, log,
   export or store the human private key. Never put credentials into this prompt,
   source control or logs. The human connects their own browser wallet.
5. Ask the human to choose autonomous threshold, allowed recipients, hard
   per-transfer cap and daily budget on /policy. Only the human signs policy
   creation/updates. Never choose or enlarge authority on the human's behalf.
6. Route selected transfers through the PULSO vault. Configuration -> permitted
   autonomous action -> approval request -> human reviews and signs exact payload
   -> execution. HUMAN_INTENT_REQUIRED means pending, not success. Keep the exact
   action, nonce, expiry and use count; wait for the human's signature before
   retrying the saved action. Never switch wallets/tools to bypass a denial.
   Approval cannot bypass the hard per-transfer cap or remaining daily budget.
7. Verify on devnet/localnet with demonstration tokens only. Review scripts/demo.sh
   and its prerequisites (Anchor, Cargo, Solana CLI, solana-test-validator). Run:

   bash scripts/demo.sh

   This builds the program and exercises the SDK demo. Also test my actual agent
   integration: observe one permitted transfer and one blocked attempt. Record
   signatures or rejection codes and balances without secrets. Do not call the
   installation verified until both outcomes are observed through my integration.
   An approval-needed attempt stays pending until the human signs. Check chain
   state before retrying an ambiguous RPC response; do not blindly resend.
8. Report changed files, requirements checked, observed results and manual steps
   still pending. PULSO protects only actions/funds routed through its vault; it
   does not intercept all existing tools or wallets. These instructions are not
   the security barrier: the Solana program enforces human-granted authority.
