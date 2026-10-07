// NOT AUDITED · DEVNET DEMONSTRATION ONLY
// A request is not spending authorization; enforcement stays on-chain.
import { defaultDeps, guarded, readJson, requestHost, requireSameOrigin, requireSession } from "../../../../lib/network-auth";
import { listRequests, submitRequest } from "../../../../lib/network-requests";
import { reply } from "../../../../lib/network-store";
import { defaultOrgDeps } from "../../../../lib/network-store-orgs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The caller's own requests only, optional ?view=sent|received -> { requests: RequestOut[] } */
export function GET(request: Request) {
  return guarded(async () => {
    const authority = await requireSession(request);
    const result = await listRequests(await defaultDeps(), authority, new URL(request.url).searchParams.get("view"));
    return reply(Array.isArray(result) ? { requests: result } : result);
  });
}

/** Step 2 of creation. Body { snapshot (as returned by prepare), description?, nonce (challenge), signature (base64) } -> request. The server rebuilds and re-checks the snapshot. */
export function POST(request: Request) {
  return guarded(async () => {
    requireSameOrigin(request);
    const authority = await requireSession(request);
    const body = await readJson(request);
    if (!body) return Response.json({ error: "invalid JSON" }, { status: 400 });
    return reply(await submitRequest(await defaultOrgDeps(), requestHost(request), authority, body));
  });
}
