# @pulso/app

Web app for PULSO policy and approval. For now it only contains the approval
request backend (issue #108) and a placeholder home page.

**NOT AUDITED · DEVNET DEMONSTRATION ONLY**

## Run

```bash
pnpm install                         # from the repo root
pnpm --filter @pulso/app dev         # http://localhost:3000
pnpm test:app                        # vitest, calls the route handlers directly
pnpm --filter @pulso/app typecheck
pnpm --filter @pulso/app build
```

## Wallet and RPC

The human connects a browser wallet (Wallet Standard: Phantom, Solflare, Backpack are detected automatically; the adapter list is empty on purpose). Every transaction is signed in the wallet; the app holds no private key.

| Variable | Default | Meaning |
|---|---|---|
| `NEXT_PUBLIC_RPC_URL` | `https://api.devnet.solana.com` | RPC endpoint. For a local validator use `http://127.0.0.1:8899`. |
| `NEXT_PUBLIC_MINT` | empty | Optional default mint for the vault in the policy form. |

```bash
NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8899 pnpm --filter @pulso/app dev
```

Page `/`: create a policy and its vault (`create_policy` + `create_vault`, one transaction), then show the policy read back from the chain.

Page `/wallet/<agent>`: agent wallet for the connected human (vault balance, authority blocks derived from the on-chain policy, and a chronological activity timeline that polls every 2 seconds).

Page `/approvals/<id>` (the `approvalUrl` returned by the SDK): shows the exact payload; before enabling APPROVE the client recomputes `computeActionHash` from the displayed fields and compares it with the request's `actionHash` (`app/lib/approval.ts`). APPROVE signs `record_intent(actionHash, expiresAt, maxUses)` with those same values and then PATCHes the backend; DENY only PATCHes. `/approvals` lists the connected wallet's pending requests (polling every 4 s).

To report live agent outcomes, configure the SDK with `activityUrl: "http://localhost:3000"`. The optional producer reports allowlisted program errors from failed simulation, on-chain intent observations, and confirmed transaction signatures. Without `activityUrl` the SDK makes no activity request. Reports use public keys, amount, action hash, known error code and signature only; report failure has a 750 ms bound and never changes authorization or a chain result. Simulation rejections are explicitly marked as reports with no confirmed transaction. `approved` means the SDK observed the intent account on-chain; it is not an independent receipt check by the app.

## Trust boundary

The backend is a queue and nothing else. It holds no key, signs nothing and
never talks to the chain. `status: "approved"` is only a hint so the waiting
agent stops polling. The real authorization is the intent the human records
on-chain (`record_intent`, signed by their own wallet) and the program rejects
any execution without it. A compromised backend that marks a request
"approved" releases nothing.

On `POST`, the server recomputes the action hash with `computeActionHash` from
`@pulso/sdk` and rejects the request (400) if it differs from `actionHash`, so
the approval screen cannot show a payload other than the one that gets signed.

## Routes

| Route | Description |
|---|---|
| `POST /api/approvals` | Create. 201 with the request; 200 if it already exists (idempotent); 400 on invalid fields or hash mismatch. |
| `GET /api/approvals?authority=<base58>&status=<pending\|approved\|denied>` | List, newest first. Filters optional. |
| `GET /api/approvals/<id>` | Fetch one (the agent polls this). 404 if unknown. |
| `PATCH /api/approvals/<id>` | `{ "status": "approved" \| "denied", "signature"?: string }`. Only from `pending`, otherwise 409. `signature` is the `record_intent` tx signature, stored as reference only. |
| `POST /api/activity` | Accept a bounded structured SDK report with a known status, evidence type and program error code. Reports never authorize execution. |
| `GET /api/activity?policy=<base58>` | Return up to 250 chronological reports for one policy. |

`id` is the `actionHash` in hex. The UI also polls `GET`; there is no push.

Example `POST` body:

```json
{
  "programId": "<base58>", "policy": "<base58>", "authority": "<base58>",
  "agent": "<base58>", "mint": "<base58>", "recipient": "<base58 token account>",
  "amount": "1000000", "expiresAt": "2000000000", "maxUses": 1,
  "nonce": "<32 hex chars>", "actionHash": "<64 hex chars>"
}
```

## Known limitations

- In-memory storage: restarting the server clears the queue (acceptable for the devnet demo).
- No authentication on the routes (out of scope for the demo).

## Notes

- `dev` and `build` use `--webpack` because `@pulso/sdk` ships TypeScript source that imports `./x.js` for `./x.ts`; Turbopack does not resolve that, webpack does via `extensionAlias` in `next.config.mjs`.
- `pnpm-workspace.yaml` sets `allowBuilds` to `false` for `bufferutil` and `utf-8-validate` (optional native speedups pulled in by `@solana/web3.js`); pnpm 12 fails the install on undeclared build scripts.
