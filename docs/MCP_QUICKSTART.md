# Local MCP quickstart

**NOT AUDITED · DEVNET DEMONSTRATION ONLY**

PULSO is a human authorization layer. This guide connects one concrete client, **MCP Inspector CLI 2.9.0**, to the local stdio server. It does not establish compatibility with every agent host. The SDK remains available without MCP; see [SDK](../README.md#sdk).

## Source availability and prerequisites

Use a checkout containing `mcp-server/`. This repository includes the package, its locked workspace, the technical contract and CI. Confirm the package exists in your checkout before running these commands.

Install Node.js 22 (CI major), pnpm 12.8.1, Rust 1.89.0, Anchor CLI 1.2.0 and Solana/Agave CLI. Validation used macOS arm64, Node 26.10.0, pnpm 12.8.1, Anchor 1.2.0 and Solana CLI 4.3.0. Inspector is fetched separately, pinned below. This is localnet with test tokens, not a production wallet setup.

From the source root:

```sh
pnpm install --frozen-lockfile
anchor build --arch v0
pnpm --filter @pulso/mcp-server build
```

In terminal 1, start an isolated local validator with the built program. Keep it running:

```sh
solana-test-validator --reset --ledger /tmp/pulso-mcp-ledger \
  --rpc-port 8899 --faucet-port 9900 \
  --bpf-program 4jdHys9YsHTbVQxB6YAr7R8jsmoEy7wqcpxC9tk2dqQi \
  target/deploy/pulso.so
```

Use an unused ledger and ports. `--reset` destroys that ledger's previous test chain. The program ID is fixed in the SDK IDL.

## Test policy, funds and UI

In terminal 2:

```sh
bash scripts/setup-demo.sh localnet
NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8899 pnpm --filter @pulso/app dev
```

Setup creates a six-decimal test mint, a 500-token vault, a destination SPL token account, and a policy: autonomous up to 10 tokens, maximum 500 per transfer and 1,000 per day. Setup is idempotent and writes public addresses to `.demo/localnet/addresses.json`.

**Fixture limitation:** this setup also generates local test key files in the ignored `.demo/localnet/` directory. These are disposable fixtures, not real human wallets. Never use real funds or copy a real human private key into the repository, MCP config, server, tools, chat or logs. The MCP server receives only the authority public key. For a separate wallet exercise, connect a disposable localnet wallet matching the setup authority; the wallet signs locally. The measured run below uses an in-memory authority fixture to record the intent, and does not demonstrate manual wallet approval.

Copy only the **agent** fixture to an external private directory before configuring MCP:

```sh
mkdir -m 700 /tmp/pulso-mcp-operator
cp .demo/localnet/agent.json /tmp/pulso-mcp-operator/agent.json
chmod 600 /tmp/pulso-mcp-operator/agent.json
mkdir -m 700 /tmp/pulso-mcp-operator/state
```

The server refuses an agent signer equal to the human authority. It also refuses signer/state paths resolving inside the source repository. Use a persistent private directory instead of `/tmp` when requests must survive reboot.

## Inspector configuration

Save this as `/tmp/pulso-mcp-operator/inspector.json`, mode `0600`. Replace the absolute checkout path and public keys using `addresses.json`: `human` becomes `PULSO_AUTHORITY`; `mint` becomes `PULSO_MINT`. Never put private key bytes in this JSON.

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
        "PULSO_AUTHORITY": "<addresses.json human public key>",
        "PULSO_AGENT_KEYPAIR": "/tmp/pulso-mcp-operator/agent.json",
        "PULSO_STATE_DIR": "/tmp/pulso-mcp-operator/state",
        "PULSO_MINT": "<addresses.json mint public key>",
        "PULSO_APPROVALS_URL": "http://127.0.0.1:3000",
        "PULSO_REQUEST_LIFETIME_SECONDS": "120",
        "PULSO_MAX_LIFETIME_SECONDS": "300"
      }
    }
  }
}
```

Inspector does not forward the shell's inherited operator environment to the child server. Put the values in `env`. `cwd` must be the package directory so `tsx` resolves. The CLI launches the server for each command; do not also start a separate MCP listener. If running the server directly, use `pnpm --filter @pulso/mcp-server start` with those variables exported. Its stdout is reserved for MCP frames.

## Discover, transfer, approve, execute

In terminal 3, from `mcp-server/`:

```sh
npx --yes @modelcontextprotocol/inspector@2.9.0 --cli \
  --config /tmp/pulso-mcp-operator/inspector.json --server pulso \
  --method tools/list --format json
```

Current discovery returns five tools: `get_policy`, `request_transfer`, `pay_receipt_challenge`, `get_approval_status`, and `execute_approved`. This guide exercises the four policy/transfer tools. `pay_receipt_challenge` is the separate receipt-challenge payment adapter; see the server README. Run the same prefix with these method arguments:

```sh
# Read the standing policy; takes no authority or agent override.
--method tools/call --tool-name get_policy --tool-args-json '{}'

# Autonomous 5-token transfer at six decimals.
--method tools/call --tool-name request_transfer \
  --tool-args-json '{"amount":"5000000","recipientTokenAccount":"<merchantTokenAccount>"}'

# Protected 100-token transfer.
--method tools/call --tool-name request_transfer \
  --tool-args-json '{"amount":"100000000","recipientTokenAccount":"<merchantTokenAccount>"}'
```

These are suffixes to the full `npx … --config … --server pulso` command, not standalone shell commands. Use `merchantTokenAccount` from `addresses.json`, **not** `merchant` or a wallet address. The destination must already exist as an SPL token account with the vault's mint. Amounts are decimal strings of base units; no floats or formatted token values.

The first request returns `executed` and a Solana signature. The protected request returns `pending`, `reason`, an `approvalId`, an `approvalUrl`, and the exact public payload. Pending does not move tokens. Open the returned URL, inspect the exact amount, recipient, mint, authority, agent, nonce, expiry and use count, and connect the separate authority test wallet. Sign `record_intent` in that wallet before expiry. The agent must never sign this approval.

After approval, use the original `approvalId`:

```sh
--method tools/call --tool-name get_approval_status \
  --tool-args-json '{"approvalId":"<64 lowercase hex characters>"}'
--method tools/call --tool-name execute_approved \
  --tool-args-json '{"approvalId":"<same approvalId>"}'
```

Status must become `approved` from the program-owned chain intent. Execution returns `executed` with a signature; status then becomes `used`. Neither a backend `approved` flag nor possession of the URL grants authority. `execute_approved` takes only the ID and reloads the exact saved request; it accepts no changed amount or recipient.

## Observed run and evidence

The [timestamped terminal capture](MCP_INSPECTOR_CAPTURE.txt) records real Inspector calls, real validator transactions and balance reads on source before the receipt adapter (#286). It discovered the original four tools; the current interface adds `pay_receipt_challenge`. The capture is text from execution, not a mock screenshot. All funds and keys were disposable local fixtures. The authority remained in the fixture process; only the agent keypair was serialized outside the checkout. The UI returned HTTP 200, but no browser wallet was connected and no manual approval time was measured.

Observed on 2 October 2026, starting at 20:17:26.844 UTC:

- Warm policy/mint/vault setup, Inspector discovery and policy read: **4.136 s**.
- Autonomous 5-token result: **5.594 s** from start; vault 500 to 495, recipient 0 to 5.
- Protected request returned pending at **7.058 s**; opening its UI URL returned HTTP 200.
- Pending to fixture `record_intent` confirmation: **4.450 s**, including the UI fetch and status read. This is fixture signing time, not human decision time.
- Pending to protected execution and final balance read: **6.365 s**. First protected result at **13.423 s** from start.
- Final vault: **395 tokens**; recipient: **105 tokens**. Status becomes `used`. Full public signatures and exact payload appear in the capture.

Inspector used its default legacy protocol era and negotiated MCP `2025-11-25`; the server's pinned official SDK is `@modelcontextprotocol/server@2.2.0` and also supports `2026-07-28`. Check actual negotiation when changing clients. The automated official-client tests are separate from this Inspector run.

These timings cover a warm local run after dependency installation/build and validator/UI startup. They do not measure a clean machine, dependency downloads, human decision time or a third-party onboarding session. This is not zero configuration. External partner validation remains pending.

## Troubleshooting and boundaries

- **RPC unavailable / wrong network:** verify the validator is running and ports are free. Localnet RPC must be loopback. Devnet must use HTTPS and match the canonical devnet genesis. RPC failures fail closed. A local validator reset changes genesis even at the same URL; old pending records cannot be reused on the new chain.
- **Backend unavailable / URL fails:** start the app on the configured loopback port. The browser and MCP must use the same RPC. The backend/UI stores requests in memory; restarting it loses that queue. A persisted MCP request does not repopulate the UI. Create a fresh request only after checking that the previous action did not execute; do not invent an approval from backend data.
- **MCP restart:** keep the same private state directory and identical chain, signer, authority and mint. Each Inspector command starts a new server, which exercised restart recovery in this run. A missing, corrupt or mismatched record fails closed. Do not reconstruct records from an approval ID.
- **Recipient invalid:** use an existing token account with the configured mint. A wallet public key or another mint is rejected; no silent ATA derivation occurs.
- **Expired / used / revoked:** do not retry an old authorization. The default request expires after 120 seconds, with a 300-second operator cap. Human approval cannot override hard per-transfer or daily policy limits.
- **Ambiguous result:** check the chain signature, intent and balances before retrying. Repeating `request_transfer` may create another autonomous transfer. No exactly-once guarantee applies to that request path.
- **State permissions:** external directory must be owned by the process user and mode `0700`; pending files use `0600`. Do not put a human key in the agent keypair file.

Only funds in the PULSO program-controlled vault are protected. Other wallets, tools or direct transfers outside this vault are not intercepted. The operator fixes the RPC, agent signer, authority, mint and UI URL; the model cannot widen its own policy. No generic signer or policy-editing tool exists.

The [SDK example](../README.md#sdk) is still the direct integration path: `PulsoClient.execute` for autonomous/pending transfers and `executeApproved` for the preserved approved action. MCP standardizes tool calls; on-chain policy and intent provide enforcement. HTTP/cloud MCP, remote hosting, OAuth, mainnet and managed-service operation are outside this MVP.
