// NOT AUDITED · DEVNET DEMONSTRATION ONLY
// A request is not spending authorization; enforcement stays on-chain.
import { defaultDeps, guarded, readJson, requestHost, requireSameOrigin, requireSession } from "../../../../../../lib/network-auth";
import { acceptRequest, prepareAccept } from "../../../../../../lib/network-requests";
import { reply } from "../../../../../../lib/network-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Two calls; the session must be the receiver of a proposal still waiting. Prepare: body {} -> { id, digest, action, message, nonce, expiresAt }.
 * Submit: body { nonce, signature (base64) } -> request (aguardando autorização). Presence of "signature" selects submit.
 */
export function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return guarded(async () => {
    requireSameOrigin(request);
    const authority = await requireSession(request);
    const body = await readJson(request);
    if (!body) return Response.json({ error: "invalid JSON" }, { status: 400 });
    const { id } = await params;
    const deps = await defaultDeps();
    if ("signature" in body) return reply(await acceptRequest(deps, requestHost(request), authority, id, body));
    return reply(await prepareAccept(deps, requestHost(request), authority, id));
  });
}
