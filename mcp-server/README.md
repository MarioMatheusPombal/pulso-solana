# PULSO local MCP server

**NOT AUDITED · DEVNET DEMONSTRATION ONLY**

Local stdio adapter for the PULSO SDK. The program controls the vault and enforces policy on-chain. `get_policy` reads the configured policy; `request_transfer` can execute an autonomous transfer or return an exact pending approval. `get_approval_status` checks that saved request against the current chain intent. `execute_approved` accepts only its `approvalId` and repeats the preserved action after validating the program-owned intent. A pending request does not authorize bypass through another tool.

Requires Node 22 and pnpm 12. The official MCP TypeScript SDK is pinned to `@modelcontextprotocol/server@2.2.0`. The stdio entry serves MCP `2026-07-28` and legacy clients; the automated client smoke test pins and records `2026-07-28`. A host's negotiated version must be checked rather than assumed. No HTTP listener starts.

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @pulso/mcp-server typecheck
pnpm --filter @pulso/mcp-server build
pnpm test:mcp
pnpm test:mcp:e2e # builds the MCP CLI; requires the built Solana program and solana-test-validator
pnpm --filter @pulso/mcp-server start
```

Configure the operator environment before starting the process:

| Variable | Value |
|---|---|
| `PULSO_NETWORK` | `devnet` or `localnet` |
| `PULSO_RPC_URL` | HTTPS devnet RPC or loopback localnet RPC |
| `PULSO_AUTHORITY` | Human authority **public key** |
| `PULSO_AGENT_KEYPAIR` | Absolute path to agent keypair JSON **outside this repository**; no human key |
| `PULSO_STATE_DIR` | Private directory outside this repository, owned by the process user, mode `0700`; pending records use `0600` |
| `PULSO_MINT` | Mint public key for the configured PULSO vault |
| `PULSO_APPROVALS_URL` | Loopback approval UI base URL |
| `PULSO_REQUEST_LIFETIME_SECONDS` | Optional request duration; default `120` |
| `PULSO_MAX_LIFETIME_SECONDS` | Optional hard cap; default `300`, greater than request duration |

The bundled SDK IDL fixes the PULSO program ID. The agent signer must differ from the human authority. No tool argument can replace the RPC, signer, authority, mint, or program ID. Startup checks the chain genesis hash; each transfer checks it again and reads the on-chain Clock. Devnet RPCs must match the canonical devnet RPC, and localnet must be loopback and cannot report known mainnet/testnet genesis hashes. Startup errors go to stderr without printing key contents or URL credentials. stdout is reserved for MCP frames.

The Inspector CLI does not pass inherited environment variables to the child server. Create a private Inspector config outside the repository with the same operator values, then run from `mcp-server/`:

```sh
npx --yes @modelcontextprotocol/inspector@2.9.0 --cli \
  --config /path/outside/repo/inspector.json --server pulso \
  --method tools/list --format json
```

The config's `mcpServers.pulso` entry needs `type: "stdio"`, `command: "node"`, `args: ["--import", "tsx", "dist/index.js"]`, `cwd` set to this package directory, and `env` holding the variables in the table. For example:

```json
{
  "mcpServers": {
    "pulso": {
      "type": "stdio",
      "command": "node",
      "args": ["--import", "tsx", "dist/index.js"],
      "cwd": "/absolute/path/to/pulso/mcp-server",
      "env": {
        "PULSO_NETWORK": "localnet",
        "PULSO_RPC_URL": "http://127.0.0.1:8899",
        "PULSO_AUTHORITY": "<human-public-key>",
        "PULSO_AGENT_KEYPAIR": "/absolute/path/outside/repo/agent.json",
        "PULSO_STATE_DIR": "/absolute/private/directory/outside/repo",
        "PULSO_MINT": "<vault-mint-public-key>",
        "PULSO_APPROVALS_URL": "http://127.0.0.1:3000"
      }
    }
  }
}
```

Keep that file private; put only the agent keypair **path** in it. Inspector 2.9.0 negotiated legacy MCP `2025-11-25` by default in our local smoke; the pinned official client 2.2.0 negotiated `2026-07-28`. Those earlier M1 smoke runs listed the original four tools, before `pay_receipt_challenge` was added. The protocol smoke used a stub RPC; the tests also exercise approval and transfer through the official MCP client against a real local validator.

The tool names are `get_policy`, `request_transfer`, `pay_receipt_challenge`, `get_approval_status`, and `execute_approved`. The transfer destination must be an existing SPL token account with the configured vault mint. A pending request is written to a private local record before the tool returns; it is not a completed transfer and does not permit a different tool or wallet to bypass the PULSO policy. The backend and its approval URL do not authorize an action: only a matching, unexpired, unused program-owned intent on-chain can unlock `execute_approved`. Backend `approved` without that intent stays `pending`; backend `denied` is only a hint when no intent exists. On restart, keep the same private state directory and chain context. If the record is missing or mismatched, ask the operator to verify local state and the chain; never reconstruct it from backend data.

`execute_approved` takes only `approvalId`. Expired, revoked, consumed, malformed and wrong-context intents fail closed. An ambiguous RPC response is not proof of execution: check chain state and balances before retrying. The server does not automatically retransmit. Retrying `request_transfer` can create a new transfer on the autonomous path. Only transfers from the PULSO vault are within this boundary. The contract and security gate are in [`docs/MCP_CONTRACT.md`](../docs/MCP_CONTRACT.md).

## pay_receipt_challenge

NOT AUDITED · DEVNET DEMONSTRATION ONLY. Pays a `pulso-receipt-v1` 402 challenge that the client already read. Input (strict, no extra fields, no URL): `scheme` (`pulso-receipt-v1`), `programId`, `recipient` (token account), `mint`, `minAmount` (u64 decimal string), `nonce` (32 hex), `expiresAt` (Unix seconds), optional `cluster` (informative). It pays exactly `minAmount` to `recipient` through the same path as `request_transfer`, with the challenge nonce. Output: `{ status: "executed", signature, challengeNonce }`, then re-present to the receiver with `X-PULSO-Receipt: <signature>` and `X-PULSO-Challenge: <challengeNonce>`; or the same `pending` payload as `request_transfer`, resumed only by `execute_approved`; a pending approval never outlives the challenge `expiresAt`. Errors: `CHALLENGE_INVALID`, `CHALLENGE_CONTEXT_MISMATCH` (program or mint differs from configuration), `CHALLENGE_EXPIRED` (on-chain clock; ask the receiver for a new challenge), plus the `request_transfer` codes. It does not fetch URLs, read the resource, choose what to buy or how much to pay, or offer any shortcut to reuse a receipt.

The [measured MCP Inspector quickstart](../docs/MCP_QUICKSTART.md) includes complete local test setup, operator config and real transaction evidence, with explicit fixture approval limitations.
