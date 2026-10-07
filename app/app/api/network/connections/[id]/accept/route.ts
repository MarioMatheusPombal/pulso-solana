// NOT AUDITED · DEVNET DEMONSTRATION ONLY
// A connection is not spending authorization; enforcement stays on-chain.
import { defaultDeps, guarded, readJson, requestHost, requireSameOrigin, requireSession } from "../../../../../../lib/network-auth";
import { reply } from "../../../../../../lib/network-store";
import { accept, prepareAccept } from "../../../../../../lib/network-store-connections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Two calls; the session must be the invited authority. Prepare: body {} -> { id, terms, message, nonce, expiresAt }.
 * Submit: body { nonce, signature (base64) } -> connection (ativa). Presence of "signature" selects submit.
 */
export function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return guarded(async () => {
    requireSameOrigin(request);
    const authority = await requireSession(request);
    const body = await readJson(request);
    if (!body) return Response.json({ error: "invalid JSON" }, { status: 400 });
    const { id } = await params;
    const deps = await defaultDeps();
    if ("signature" in body) return reply(await accept(deps, requestHost(request), authority, id, body));
    return reply(await prepareAccept(deps, requestHost(request), authority, id));
  });
}
