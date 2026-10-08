<img src="https://raw.githubusercontent.com/MarioMatheusPombal/pulso-solana/main/assets/chalk-v1/readme/docbar.png" alt="PULSO: human authorization for AI agents. NOT AUDITED · DEVNET DEMONSTRATION ONLY." width="100%">

# @pulso/app

Web app for PULSO policy and approval: create a policy, watch the agent wallet,
and approve or deny the exact action an agent asked for.
The landing page is at `/`, the Simulation Lab opens at `/simulation`, and authorization notes are at `/docs`. Policy configuration (`/policy`), agent wallets (`/wallet`), approvals, network tools, and integration remain available from Lab pages and direct links. A pilot-interest form is at `/waitlist`. The copy positions PULSO as human authorization for teams building agents and payment products on Solana; managed service, dashboard, SDK packaging and mainnet are described only as planned.

The header wallet control is available on every route, including Home, Simulation and Docs. The same wallet provider stays mounted during navigation; use the control to select or manage the human wallet. Mobile keeps the wallet and Lab menu in separate grid slots.

The landing is a single classroom hero with aligned 2D parallax planes: the Guardian teaches while holding a heart, and the chalk diagram ends at a shield. The original brand opening, Skip and Replay remain. The scene has subtle idle motion, mouse depth, Pause/Resume and a static reduced-motion state; mobile and tablet place the scene beneath the copy. The internal design reference is at `/ds` (redirects to `/design-system`) without a navigation link. Verify desktop/mobile/reduced motion with `node scripts/shot.mjs . --at 1000,5000 --full`, `--mobile` and `--reduced` while the app is running. Production artwork and provenance: `public/assets/classroom-v1/README.md`. All Simulation Lab functionality remains in its existing components.

The hero scales through 2560×1440 and 3840×2160, with a height bound for ultrawide screens and a separate mobile crop. It reuses the same three WebP layers (~273 KB total). Short landscape/zoomed viewports may scroll within the single hero to keep content reachable. In the private checkout, from the repository root, run `node docs/design/authority-studio-v1/classroom-v1/responsive-v2/qa.cjs` against the running app for the viewport, resize and motion checks; screenshots go to `app/.shots/hero-responsive-v2/`.

**NOT AUDITED · DEVNET DEMONSTRATION ONLY**

## Run

```bash
pnpm install                         # from the repo root
pnpm --filter @pulso/app dev         # http://localhost:3000
pnpm test:app                        # vitest, calls the route handlers directly
pnpm --filter @pulso/app typecheck
pnpm --filter @pulso/app build
```

Open `/simulation` for the local Simulation Lab. The Lab combines a deterministic local policy/transfer simulation, a local B2B invitation and commercial-terms rehearsal that still passes through the simulated payment policy, and the read-only Live demo evidence panel. Commercial consent is not spending authority. The Live demo catalogs reproducible A–G scenarios and reads `/api/activity` for one selected policy; it does not run terminal commands from the browser. The full local suite remains `bash scripts/demo.sh`; it runs validator scenarios and F in LiteSVM. A policy activity row never attests that the full suite passed.

For RPC-confirmed activity, keep a local validator available at `http://127.0.0.1:8899`, run this app with that `NEXT_PUBLIC_RPC_URL`, and set `PULSO_ACTIVITY_URL=http://localhost:3000` when launching a compatible demo command. Select the policy printed by that run. The Lab checks up to 10 new signatures against the configured RPC; it labels SDK reports, simulations, observed intent accounts, and verified transactions separately. F has no RPC signature. G and the automated B2B rehearsal do not emit activity to this timeline. The Lab feed does not attest that the full suite completed.

## Wallet and RPC

The human connects a browser wallet (Wallet Standard: Phantom, Solflare, Backpack are detected automatically; the adapter list is empty on purpose). Every transaction is signed in the wallet; the app holds no private key.

| Variable | Default | Meaning |
|---|---|---|
| `NEXT_PUBLIC_RPC_URL` | `https://api.devnet.solana.com` | RPC endpoint. For a local validator use `http://127.0.0.1:8899`. |
| `NEXT_PUBLIC_MINT` | empty | Optional default mint for the vault in the policy form. |

```bash
NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8899 pnpm --filter @pulso/app dev
```

Page `/`: chalkboard landing with the approved large Guardian illustration, a first-visit-per-session GSAP intro, and links to the Simulation Lab and Docs. Skip and replay controls remain available; the opening runs for about one second and never gates the page or a transaction. Pilot interest stays a secondary link.

Page `/policy`: create a policy and its vault (`create_policy` + `create_vault`, one transaction), then show the policy read back from the chain.

Page `/waitlist`: devnet pilot request, product one-liner, local demo video, devnet warning and accessible email capture. `POST /api/waitlist` trims and lowercases email addresses, validates them, and deduplicates normalized values. Entries are persisted as JSON at `app/.data/waitlist.json` by default; set `PULSO_WAITLIST_FILE` to an absolute path on a persistent disk in hosted deployments. No Google account, external form service, or secret is required. The file contains personal data and is ignored by Git; keep its filesystem access limited to the app operator.

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

The app uses the approved chalkboard identity: slate texture, warm chalk, amber attention, the original Guardian illustration, and local Caveat, Crimson Pro, and JetBrains Mono fonts. Shared tokens come from `app/app/globals.css`; brand sources and asset rules are documented in `assets/chalk-v1/README.md`.

`/docs` explains the authority flow and links to `/integration` for the available MCP/SDK setup review prompts. Those prompts describe validated local scenarios and their measured limits; they do not install software or claim universal host support.

The waitlist demo player and poster are served from `app/public/assets/`; their release originals remain under `public/assets/`.

The landing uses GSAP to move the approved Guardian chalk artwork along a subtle arc and reveal the Caveat wordmark. It plays once per session, offers Skip and Replay controls, and falls back to the visible static SVG if JavaScript, storage, or the animation fails. Pointer response is limited to a small transform on fine pointers. Reduced-motion changes finish the intro immediately; the authority diagram stays static. Three rules hold everywhere:

- With `prefers-reduced-motion`, nothing animates and every element sits in its final state.
- The payload under review on `/approvals/<id>` never animates. Only the confirmation that follows an on-chain result does.
- The authority diagram stays readable at narrow widths and does not rely on animation.
- The PULSO brand intro animates only on the landing page. It cannot delay the approval payload or transaction controls.

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

## Integration onboarding

Open `/integration` from the main navigation or landing. Review each complete prompt, copy it, or download its Markdown file. Clipboard failure selects the visible text for manual copying. Downloads are generic documentation, not universal skills. MCP records Inspector CLI 2.9.0 / MCP 2025-11-25 local validation with fixture-signed approval; manual browser-wallet approval and other hosts remain unvalidated. Public availability depends on the release update. SDK commands use the existing source workspace, not a published npm package. Verify one allowed and one blocked action through the actual integration before claiming installation success. No installation happens on visit. Only the human sets and signs authority.

Materials live in `app/public/integration/` and are included by the release app/ allowlist. Run the release dry-run before any authorized public release.

## Humanist identity

The header uses the approved compact Guardian face and lowercase `pulso` lettering. Editable SVGs are in `public/assets/humanist-v1/`; Nunito/Nunito Sans WOFF2 fonts and their OFL licenses live in `app/fonts/`. They are served locally. Technical values retain JetBrains Mono; reduced motion and exact approval payloads are preserved. To inspect the typography, open Home, Simulation (all three tabs), Docs, Policy and Network at desktop/mobile sizes.

## B2B network

`/network` is the B2B network UI (wallet sign-in, organizations, connections, charges and send proposals, payment verification). It is application state only: it never authorizes spending. Environment: `NEXT_PUBLIC_RPC_URL` (set before `next build`/`next dev`; the genesis hash of this RPC enters the signed sign-in message, so it must match the wallets' cluster), `PULSO_NETWORK_DIR` (state directory, default `app/.data/network/`, ignored by Git), `PULSO_NETWORK_COMMITMENT` (`confirmed` or `finalized`) and `NEXT_PUBLIC_MINT`. Protocol: [`docs/B2B_NETWORK_SPEC.md`](../docs/B2B_NETWORK_SPEC.md); run guide: [`docs/B2B_DEMO.md`](../docs/B2B_DEMO.md). Mutating requests need `Origin` equal to `Host` and the session cookie is `Secure` in production, so use HTTPS behind a proxy that preserves `Host`.
