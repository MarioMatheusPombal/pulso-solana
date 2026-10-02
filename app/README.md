<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/MarioMatheusPombal/pulso-solana/main/assets/readme/docbar-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/MarioMatheusPombal/pulso-solana/main/assets/readme/docbar-light.svg">
  <img src="https://raw.githubusercontent.com/MarioMatheusPombal/pulso-solana/main/assets/readme/docbar-dark.svg" alt="PULSO: human authorization for AI agents. NOT AUDITED · DEVNET DEMONSTRATION ONLY." width="100%">
</picture>

# @pulso/app

Web app for PULSO policy and approval: create a policy, watch the agent wallet,
and approve or deny the exact action an agent asked for.
The landing page is at `/`, policy configuration is at `/policy`, and integration notes are previewed at `/docs` (`/integration` redirects there). A public-facing waitlist is available at `/waitlist`.

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

Page `/`: product landing page with links to policy setup and Docs.

Page `/policy`: create a policy and its vault (`create_policy` + `create_vault`, one transaction), then show the policy read back from the chain.

Page `/waitlist`: product one-liner, local demo video, devnet warning and accessible email capture. `POST /api/waitlist` trims and lowercases email addresses, validates them, and deduplicates normalized values. Entries are persisted as JSON at `app/.data/waitlist.json` by default; set `PULSO_WAITLIST_FILE` to an absolute path on a persistent disk in hosted deployments. No Google account, external form service, or secret is required. The file contains personal data and is ignored by Git; keep its filesystem access limited to the app operator.

Export the collected list locally, without exposing email addresses through a public endpoint:

```bash
node app/scripts/export-waitlist.mjs csv
node app/scripts/export-waitlist.mjs ndjson
node app/scripts/export-waitlist.mjs csv ./waitlist.csv
```

No public deployment is configured. A public URL and a host with persistent writable disk are still required before the waitlist can be described as live. A serverless host with ephemeral storage would lose entries on restart and is not suitable without an attached persistent volume.

Page `/wallet`: enter an agent public key to inspect its wallet. The authority public key is optional when a wallet is connected; without a connected wallet, enter the authority public key to find the on-chain policy. Both addresses are public keys. The page only reads the chain and signs nothing. `/wallet/<agent>?authority=<base58>` remains available for a direct read-only link. The view shows vault balance, authority blocks derived from the on-chain policy, and a chronological activity timeline that polls every 2 seconds.

Page `/approvals/<id>` (the `approvalUrl` returned by the SDK): shows the exact payload; before enabling APPROVE the client recomputes `computeActionHash` from the displayed fields and compares it with the request's `actionHash` (`app/lib/approval.ts`). APPROVE signs `record_intent(actionHash, expiresAt, maxUses)` with those same values and then PATCHes the backend; DENY only PATCHes. `/approvals` lists the connected wallet's pending requests (polling every 4 s); select a request to open its individual approval.

To report live agent outcomes, configure the SDK with `activityUrl: "http://localhost:3000"`. The optional producer reports allowlisted program errors from failed simulation, on-chain intent observations, and confirmed transaction signatures. Without `activityUrl` the SDK makes no activity request. Reports use public keys, amount, action hash, known error code and signature only; report failure has a 750 ms bound and never changes authorization or a chain result. Simulation rejections are explicitly marked as reports with no confirmed transaction; the attack demo (scenarios C–E) also reports rejections confirmed on-chain, with the failed transaction signature. `approved` means the SDK observed the intent account on-chain; it is not an independent receipt check by the app.

## Brand and motion

The app uses a dark chalkboard surface, local Caveat, Crimson Pro, and JetBrains Mono fonts from `app/app/fonts/`, and the chalk Guardian and diagrams in `app/public/assets/chalk-v1/`. OFL notices live beside the font files. The dark palette is fixed across routes to avoid a theme flash.

`/docs` is a compact reference and clearly marked preview, not an installation guide. MCP and SDK installation steps are in preparation; it does not claim a ready MCP server or publish provisional install commands. `/integration` redirects to `/docs`.

The waitlist demo player and poster are served from `app/public/assets/`; their release originals remain under `public/assets/`.

The landing uses GSAP (`gsap`, `@gsap/react`) for low-amplitude pointer parallax on the Guardian; it runs through `useGSAP` and cleans up on unmount. Docs stays static for reading. Three rules hold everywhere:

- With `prefers-reduced-motion`, nothing animates and every element sits in its final state.
- The payload under review on `/approvals/<id>` never animates. Only the confirmation that follows an on-chain result does.
- The Guardian illustration on `/` uses low-amplitude desktop pointer parallax. Reduced-motion and touch layouts stay static.

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
