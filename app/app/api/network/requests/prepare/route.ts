// NOT AUDITED · DEVNET DEMONSTRATION ONLY
// A request is not spending authorization; enforcement stays on-chain.
import { guarded, readJson, requestHost, requireSameOrigin, requireSession } from "../../../../../lib/network-auth";
import { prepareRequest } from "../../../../../lib/network-requests";
import { reply } from "../../../../../lib/network-store";
import { defaultOrgDeps } from "../../../../../lib/network-store-orgs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Step 1 of creation. Body { kind: "charge"|"send", counterparty (authority), amount (decimal string, base units),
 * expiry (unix seconds), description? } -> { kind, snapshot, digest, action, message, nonce, expiresAt }. Persists only the challenge.
 */
export function POST(request: Request) {
  return guarded(async () => {
    requireSameOrigin(request);
    const authority = await requireSession(request);
    const body = await readJson(request);
    if (!body) return Response.json({ error: "invalid JSON" }, { status: 400 });
    return reply(await prepareRequest(await defaultOrgDeps(), requestHost(request), authority, body));
  });
}
