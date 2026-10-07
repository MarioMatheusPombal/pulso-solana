// NOT AUDITED · DEVNET DEMONSTRATION ONLY
// Organization state is not spending authorization; enforcement stays on-chain.
import { guarded, readJson, requireSameOrigin, requireSession } from "../../../../lib/network-auth";
import { reply } from "../../../../lib/network-store";
import { allowSearch, createOrganization, defaultOrgDeps, findOrganization } from "../../../../lib/network-store-orgs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** body { handle, displayName, receivingAccount?, payerAgent? } -> organization (authority = session) */
export function POST(request: Request) {
  return guarded(async () => {
    requireSameOrigin(request);
    const authority = await requireSession(request);
    const body = await readJson(request);
    if (!body) return Response.json({ error: "invalid JSON" }, { status: 400 });
    return reply(await createOrganization(await defaultOrgDeps(), authority, body));
  });
}

/** ?handle= or ?authority= (exactly one, exact match) -> { handle, displayName, authority } */
export function GET(request: Request) {
  return guarded(async () => {
    const authority = await requireSession(request);
    const deps = await defaultOrgDeps();
    if (!allowSearch(authority, deps.now)) return Response.json({ error: "too many searches; wait a minute", code: "RATE_LIMITED" }, { status: 429 });
    const params = new URL(request.url).searchParams;
    return reply(await findOrganization(deps, { handle: params.get("handle"), authority: params.get("authority") }));
  });
}
