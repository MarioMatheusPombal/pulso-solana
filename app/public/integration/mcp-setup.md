# PULSO MCP configuration review instructions

NOT AUDITED · DEVNET DEMONSTRATION ONLY

This is a generic review prompt/document, not a universal SKILL.md or connection
command. Inspector CLI 2.9.0 was tested on localnet, negotiating MCP 2025-11-25.
The run observed permitted/pending transfers, UI HTTP 200, fixture-signed intent
and execution. Manual browser-wallet approval and other hosts were not validated.
Public availability depends on the release update (#246). No public remote server
or published npm package is offered.

Help prepare PULSO configuration for my existing MCP client:

1. Identify my OS, MCP host/version, its documented stdio configuration format,
   Node and pnpm versions. Inspect existing tools; preserve them. Propose minimal
   changes for review. Do not install anything merely because I visited a page.
2. Read the current checkout's mcp-server/README.md and docs/MCP_CONTRACT.md.
   Use docs/MCP_QUICKSTART.md and its timestamped MCP_INSPECTOR_CAPTURE.txt.
   Stop if these or mcp-server/ are missing from the checkout. Do not infer
   other host support from Inspector.
   The workspace @pulso/mcp-server is private, version 0.0.0. Node 22 and pnpm 12
   are CI prerequisites. The observed macOS arm64 run used Node 26.10.0, pnpm
   12.8.1, Anchor 1.2.0 and Solana CLI 4.3.0; Rust 1.89.0 is also needed for setup.
   Do not invent npm installation or hosting. From the checkout root run:

   pnpm install --frozen-lockfile
   anchor build --arch v0
   pnpm --filter @pulso/mcp-server build

   Follow the quickstart for isolated validator and disposable test setup. Review
   reset/ledger paths before any command that discards test chain state.
3. Prepare a private stdio configuration, outside the repository, according to
   the chosen host's documented format. Review the existing entrypoint in
   mcp-server/README.md. The operator supplies PULSO_NETWORK (devnet/localnet),
   PULSO_RPC_URL, PULSO_AUTHORITY (human PUBLIC key), PULSO_AGENT_KEYPAIR (absolute
   local agent signer path outside the repo), PULSO_STATE_DIR (private 0700
   directory outside the repo), PULSO_MINT and PULSO_APPROVALS_URL (loopback UI).
   These belong in the operator environment, never in model-controlled tool
   arguments. Never include real credentials in this prompt, source control or
   logs. Never request, copy, export or store the human private key.
4. Explain manual operator configuration and human wallet actions separately.
   Only the human sets and signs autonomous threshold, allowed recipients, hard
   per-transfer cap and daily budget on /policy. The human signs in their wallet.
   The agent cannot enlarge its own authority. Approval is not a bypass for hard
   caps or the remaining daily budget.
5. Follow the validated quickstart for Inspector CLI 2.9.0. Record host/version
   and negotiated MCP protocol. Require operator review before changing client
   configuration. From mcp-server/, discover tools with:

   npx --yes @modelcontextprotocol/inspector@2.9.0 --cli --config /absolute/private/path/inspector.json --server pulso --method tools/list --format json

   Inspector needs the operator values in config env and cwd set to mcp-server/;
   it does not inherit the shell environment. Preserve other entries. Check tools:
   Four base-flow tools: get_policy, request_transfer, get_approval_status,
   execute_approved. The checkout may also expose pay_receipt_challenge for
   receipt flows. Inspect the current tool list; its presence does not establish
   support for every host or validate a receipt integration.
   Destinations are existing SPL token accounts for the configured vault mint.
6. Verify using demonstration tokens on devnet/localnet: observe one autonomous
   permitted transfer and one blocked attempt through the actual MCP client.
   Preserve exact approvalId and action on HUMAN_INTENT_REQUIRED. It stays pending
   until the human reviews and signs the exact payload; execute_approved accepts
   only approvalId. Never approve for the human or bypass using another tool.
   Check chain state and balances before retrying ambiguous execution responses.
   Do not label installation verified until both outcomes are observed. Report
   transaction signatures/rejection codes, host/version and remaining manual work.
7. Explain configuration -> autonomous permitted action -> approval request ->
   human signs exact payload -> execution. Authorizations are scoped, expiring,
   use-counted and non-reusable. PULSO protects only actions/funds routed through
   its vault, not every existing tool or wallet. The prompt is guidance; the
   Solana program, not this document or backend, enforces the policy.
