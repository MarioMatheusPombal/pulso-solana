// NOT AUDITED · DEVNET DEMONSTRATION ONLY
// A connection is not spending authorization; enforcement stays on-chain.
import { defaultDeps, guarded, readJson, requestHost, requireSameOrigin, requireSession } from "../../../../lib/network-auth";
import { reply } from "../../../../lib/network-store";
import { listConnections, prepareInvite, submitInvite } from "../../../../lib/network-store-connections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The caller's own connections only -> { connections: ConnectionOut[] } */
export function GET(request: Request) {
  return guarded(async () => {
    const authority = await requireSession(request);
    return Response.json({ connections: await listConnections(await defaultDeps(), authority) });
  });
}

/**
 * Two calls. Prepare: body { handle } or { authority } -> { id, terms, target, message, nonce, expiresAt }.
 * Submit: body { id, target, nonce, signature (base64) } -> connection (pendente). Presence of "signature" selects submit.
 */
export function POST(request: Request) {
  return guarded(async () => {
    requireSameOrigin(request);
    const authority = await requireSession(request);
    const body = await readJson(request);
    if (!body) return Response.json({ error: "invalid JSON" }, { status: 400 });
    const deps = await defaultDeps();
    const host = requestHost(request);
    if ("signature" in body) return reply(await submitInvite(deps, host, authority, body));
    const str = (v: unknown) => (typeof v === "string" ? v : null);
    return reply(await prepareInvite(deps, host, authority, { handle: str(body.handle), authority: str(body.authority) }));
  });
}
