// NOT AUDITED · DEVNET DEMONSTRATION ONLY
// Reconciliation reads the chain and records the fact. It authorizes nothing and stops nothing;
// `verificado` is not a second on-chain authorization (spec 14 section 8).
import { guarded, readJson, defaultDeps, requireSameOrigin, requireSession } from "../../../../../../lib/network-auth";
import { defaultReconcileDeps, getReconciliation, reconcileRequest } from "../../../../../../lib/network-reconcile";
import { reply } from "../../../../../../lib/network-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Participants only (404 for anyone else) -> { request, reconcile } from the stored state, no chain read. */
export function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return guarded(async () => {
    const authority = await requireSession(request);
    return reply(await getReconciliation(await defaultDeps(), authority, (await params).id));
  });
}

/**
 * Session + Origin; payer or receiver. Body: { signature } (base58 transaction signature) and nothing else: the client never
 * sends a status, a mode, an amount or a result. Binds the signature (line 9), verifies against the chain, records the result.
 * 200 { request, reconcile: { code, detail?, retry, refused, warning? } }; 400 BAD_SIGNATURE; 404; 409 STATE | SIGNATURE_IN_USE | CONFLICT; 500 DIGEST_MISMATCH.
 * A refusal or an inconclusive read is still 200: read `reconcile.code`.
 */
export function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return guarded(async () => {
    requireSameOrigin(request);
    const authority = await requireSession(request);
    const body = (await readJson(request)) ?? {};
    return reply(await reconcileRequest(defaultReconcileDeps(), authority, (await params).id, { signature: body.signature }));
  });
}
