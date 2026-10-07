// NOT AUDITED · DEVNET DEMONSTRATION ONLY
// Network sign-in is not spending authorization; enforcement stays on-chain.
import { defaultDeps, guarded, readJson, requestHost, requireSameOrigin, sessionCookie, verifyChallenge } from "../../../../../lib/network-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** body { nonce, signature (base64, 64 bytes) } -> { authority, cluster, expiresAt } + session cookie */
export function POST(request: Request) {
  return guarded(async () => {
    requireSameOrigin(request);
    const body = await readJson(request);
    if (!body) return Response.json({ error: "invalid JSON" }, { status: 400 });
    const result = await verifyChallenge(await defaultDeps(), requestHost(request), body.nonce, body.signature);
    if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
    return Response.json(result.session, { headers: { "Set-Cookie": sessionCookie(result.token) } });
  });
}
