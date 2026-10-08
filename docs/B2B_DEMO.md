# B2B demo: two companies transacting

**NOT AUDITED · DEVNET DEMONSTRATION ONLY**

Two companies (A pays, B receives), each with its own administrating authority, exchange a charge and a proposal and settle through an agent that can only pay through the PULSO program. Spec: [B2B_NETWORK_SPEC.md](B2B_NETWORK_SPEC.md). PULSO does not decide what to buy. It is the authorization layer the agent passes through.

## Limits to keep in mind

- Commercial consent (request, accept) is a wallet signature over text. **It does not authorize spending.** The signed text says `NOT A TRANSACTION · grants no spending authority`.
- The receiver **neither co-signs nor vetoes** on-chain.
- **Cancelling or letting a request expire does not prevent spending**: only the program refuses or pays. The app status is a record of what the chain showed.
- Autonomous branch: the program only carries the nonce, **nothing on-chain prevents paying the same request twice**. The large payment in the demo uses the approved branch (single-use intent), which the program enforces.
- No KYC, no "verified company", no mainnet.
- The automatic rehearsal signs for the human with a **fixture wallet** (`WALLET FIXTURE, not the agent`). In a live run, the human signs in the browser.

## Prerequisites

Node 22, pnpm 12, and `pnpm install --frozen-lockfile` at the repository root. The localnet rehearsal also needs the built program (`anchor build --arch v0`, which produces `target/deploy/pulso.so`) and `solana-test-validator` (Solana CLI / Agave). Devnet runs need a funded wallet file kept **outside** the repository.

## Two ways to run it

### 1. Automatic rehearsal (one command, narrates everything)

`agent-demo/src/b2b-demo.ts` uses the app's real libs (`app/lib/network-*`, its own data directory, erased on every run, outside Git) and the agent adapter (`b2b.ts`). The human signature of the rehearsal comes from `agent-demo/src/b2b-wallet-fixture.ts`, labeled in the output as `WALLET FIXTURE, not the agent`. It is the only file that holds a human key; the agent receives only its own key and public keys. No private key is printed or sent to the backend.

Localnet (starts a `solana-test-validator` if port 8899 is free; run `anchor build --arch v0` first):

```bash
pnpm --filter @pulso/agent-demo b2b-demo -- --cluster localnet
```

Devnet (demo keys and the wallet that pays fees stay OUTSIDE the repo):

```bash
pnpm --filter @pulso/agent-demo b2b-demo -- --cluster devnet \
  --keys-dir <folder outside the repo> --funder <wallet file with devnet SOL> [--rpc <url>]
```

`--keys-dir` stores the demo keypairs (created on the first run, mode 0600) and `--funder` pays the minimum SOL (about 0.09 SOL on the first run). `PULSO_B2B_KEYS_DIR` and `PULSO_FUNDER_KEYPAIR` also work. Later runs reuse keys, policy and vault. If the funder has no SOL, the command stops and says how much is missing.

What it shows, in order: sign-in (the authority signs the challenge), two organizations (`@demo_acme`, `@demo_globex`), a connection invited and accepted (exact signed text), a **charge B→A of 5** (the agent pays on its own), a **proposal A→B of 8** (refused by the agent before `send.accept`, paid after), the **main scene: a charge of 100, above the autonomous limit of 10**, and the failures:

| Scene | Actual result |
|---|---|
| Charge of 100 | the agent validates the package, the program asks for the human (`HUMAN_INTENT_REQUIRED`), the agent stops; the exact payload and the action hash are printed; the (fixture) wallet records the intent; the agent executes (`mode approved`); B reconciles and the request becomes verified, with `/receipt/<signature>` |
| (a) 600 units | `PULSO_008_AMOUNT_EXCEEDS_LIMIT` (cap of 500 per transaction), refused by the program |
| (b) tampered package | `DIGEST_MISMATCH`; with the digest recomputed, `CONSENT_TERMS_MISMATCH`. The agent refuses before sending; balance intact |
| (c) replay | `PULSO_005_INTENT_ALREADY_USED`, refused by the program |
| (d) missing consent | `RECEIVER_CONSENT_REQUIRED`: a proposal without `send.accept` |
| (e) expired request | waits 14 s of real clock; the agent refuses with `EXPIRED` and the app shows expired |

Honesty about (a) and (c): the SDK runs a simulation against the live program before sending (preflight), and the refusal comes from it. **No failure transaction was sent**, so there is no failure signature to show (scenarios C/D/E of the A–G demo have a confirmed failure receipt; this one does not). On (c), the adapter's local state also returns the same signature instead of paying again, but that is client-side only.

At the end it prints cluster, genesis, program ID, signatures, balances before and after, per-step timings and `NOT AUDITED · DEVNET DEMONSTRATION ONLY`.

Test of the deterministic rehearsal (local validator, 1 test, ~25 s; checks balances, the 5 failure codes, the receipt link and that no key appears in the log or the data files):

```bash
pnpm --filter @pulso/agent-demo exec vitest run --config vitest.e2e.config.ts test/b2b-demo.e2e.test.ts
```

### 2. Record of the real devnet rehearsal (2026-10-03, one run)

Program `4jdHys9YsHTbVQxB6YAr7R8jsmoEy7wqcpxC9tk2dqQi`, genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`, public RPC `https://api.devnet.solana.com`. Fresh keys for this demo only; only public keys here.

| Role | Public key |
|---|---|
| A, authority | `3BjGz5Ym9PQuYGCvkhioy9juiYhaJ18s3bpmJZQVCnDV` |
| A, agent | `CfxFWh3kd2y1e2KBLSxwBJmTEK6dcKAcCK37xjv7hp3V` |
| A, vault | `CQLNV16aPutixMUDooHfGmhMPNYNDvYjxVEdqA6SpKTq` |
| B, authority | `2Efqt3NiZwgk6vjq4k3DD8EsBPtrgTWennT2fcsce1f9` |
| B, receiving account | `56q6UtSg48cuNAJJmeLzx1wQ2WWZmiiGw7hkPsPBrjPr` |
| Test mint (6 decimals) | `FKGac1jfMXhJa2tFU4vN71j4wyn1yZ233ExQeb52KCDo` |

| Step | Signature (devnet) |
|---|---|
| Charge 5, autonomous | `5ufyzQxGDpPLJeHf9MoQ8ugcmSep5sogcTcdSczqk73Ge7v64n4HZXr79pLvGRHtmNhKyLdA1VtHC7ckvSttJHFa` |
| Proposal 8, autonomous | `2QFaBXhM5KdZmUgdtar3QRXCbZXT9cH5rpMhKjMUXVSd72THJhS8VAaCDVG24HNNv9dMpzDWGcMUCwH2yEkFSMiB` |
| Main: `record_intent` (A's human, fixture) | `5yhzVZdu8zwH69zXwKZ7AhP8nm11fiRewbtsgnqdJ1iqGc7zphfZy8JiAUFAj2J5ALTTfiscbA1N71mahcuqu4UT` |
| Main: payment of 100, approved | `3JCGHVu1B1zQh84rBtfinmtVcxHGrKmZiSm96nTpSJrVaMK3X2JMEkJB6ehzcM4uXVykK5bQVciEUgV74Ns7TG37` |

Action hash of the main approval: `051e665eb8587730bf8aa6a7579b82f9e7e68103dddf0b882dc5e59173c93104`. Balances (test token): vault 1000 → 887, B 0 → 113 (5 + 8 + 100, nothing on the failures). SOL spent by the funder: 0.090015.

| Time (ms) | Step |
|---|---|
| 9630 | setup: SOL, mint, policy, vault |
| 6370 | charge 5: issue, agent pays, B reconciles |
| 6509 | proposal 8: propose, refusal without accept, accept, pay, reconcile |
| 12559 | main: issue, block, human signs, agent pays, reconciliation |
| 2123 | the human's `record_intent` alone |
| ~0 | sign-in, organizations, connection (disk only, no chain) |

Observed limitations: the public devnet RPC returned `429 Too Many Requests` 18 times during the run (web3.js retries on its own; there was also a `ws error: 429` websocket warning, with no effect on the result). Each chain step took 2 to 6 s because of that and of confirmation. For a live run use your own RPC (`--rpc` in the rehearsal and `NEXT_PUBLIC_RPC_URL` in the app). The rehearsal's intent is valid for 120 s.

## Live walkthrough (browser, two wallets)

Browser evidence with real wallets has **not** been recorded in this repository: this walkthrough is the procedure to run it yourself.

Preparation (once):

1. Two devnet wallet accounts (A and B) in two browser profiles (or a browser + a private window). A needs ~0.05 devnet SOL; B needs no SOL (it only signs text).
2. Prepare the infrastructure, with the wallets' public keys only:
   ```bash
   pnpm --filter @pulso/agent-demo b2b-demo -- --cluster devnet --keys-dir <folder outside the repo> --funder <wallet with SOL> \
     --live-setup --human-a <pubkey of A> --human-b <pubkey of B>
   ```
   It prints A's agent public key, the test mint and B's receiving account, and sends SOL to A if it is short.
3. Start the app with the test mint and its own data (outside Git):
   ```bash
   NEXT_PUBLIC_RPC_URL=<devnet rpc> NEXT_PUBLIC_MINT=<test mint> PULSO_NETWORK_DIR=<folder outside the repo> \
     pnpm --filter @pulso/app dev
   ```
4. Profile A, `http://localhost:3000/policy`: create the policy with the agent printed in step 2, the test mint, "Autonomous limit" 10, "Per-transaction cap" 500, "Daily limit" 5000 and **untick** "Require approval for new recipients". Then run the step 2 command again: it funds the vault with 1000 of the test token.

Scene (about 4 min):

1. **Profile A**, `/network`: connect the wallet, sign the challenge (the screen shows the text), create the organization `demo_acme` with the paying agent. **Profile B**: the same, `demo_globex`, with the receiving account from step 2.
2. A searches `@demo_globex`, checks the full key the screen shows, invites and signs the text. B accepts and signs.
3. **B** creates a **charge of 100** for A. A sees the request in the inbox.
4. **A** opens `/network/requests/<id>`, "Copy agent package" and saves it as `request.json` (outside the repo).
5. Agent terminal (the agent key only; no backend session):
   ```bash
   pnpm --filter @pulso/agent-demo b2b -- --package request.json --cluster devnet \
     --agent-keypair <keys folder>/agent-a.json --approve ui --approvals-url http://localhost:3000
   ```
   Output: the package is validated and the agent **stays blocked** (`HUMAN_INTENT_REQUIRED`, action hash and link).
6. **A**, `/approvals`: the exact payload appears; check that the action hash is the one in the terminal; approve in the wallet. The agent resumes, revalidates the terms and executes: `EXECUTED mode=approved signature=...`.
7. **Restart in the middle**: stop `next dev` and start it again with the same variables. Sessions, organizations, the connection and the request remain (they live in `PULSO_NETWORK_DIR`). **Do not restart between the block and the approval**: the `/approvals` queue is in memory only (a known limit, `app/lib/store.ts`).
8. **B** (or A) opens the request and pastes the signature into "Report payment". The screen passes through sent and becomes verified, with the evidence of both sides and the `/receipt/<signature>` link.
9. Optional live failures, in seconds: repeat the step 5 command with the same `request.json` (returns the already-sent signature without paying again; the program refuses the intent replay with `PULSO_005`); edit the amount in `request.json` (`REFUSED DIGEST_MISMATCH`); a charge of 600 (`REJECTED PULSO_008...`).

If the RPC fails:

- Switch the RPC and restart the app (`--rpc` on `b2b`, `NEXT_PUBLIC_RPC_URL` in the app). Reconciliation with the RPC down leaves the request sent, never green; with the RPC back, "Report payment" again completes it.
- No devnet at all: run the local rehearsal (`--cluster localnet`) and narrate the output, saying it is local and that the human's signature is the fixture.

Resetting the fixture: stop the app; delete `PULSO_NETWORK_DIR` and the agent state directory (`.demo/devnet/b2b-state`, or the `--state-dir` one). Policy, vault and keys remain; handles are free again. If the vault runs dry, repeat the step 2 command.
