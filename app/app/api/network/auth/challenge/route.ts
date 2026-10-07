// NOT AUDITED · DEVNET DEMONSTRATION ONLY
// Network sign-in is not spending authorization; enforcement stays on-chain.
import { defaultDeps, guarded, issueChallenge, readJson, requestHost, requireSameOrigin } from "../../../../../lib/network-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** body { authority } -> { message, nonce, expiresAt } */
export function POST(request: Request) {
  return guarded(async () => {
    requireSameOrigin(request);
    const body = await readJson(request);
    if (!body) return Response.json({ error: "invalid JSON" }, { status: 400 });
    const result = await issueChallenge(await defaultDeps(), requestHost(request), body.authority);
    if ("error" in result) return Response.json(result, { status: 400 });
    return Response.json(result);
  });
}
