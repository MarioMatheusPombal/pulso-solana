// NOT AUDITED · DEVNET DEMONSTRATION ONLY
// Organization state is not spending authorization; enforcement stays on-chain.
import { guarded, readJson, requireSameOrigin, requireSession } from "../../../../../lib/network-auth";
import { reply } from "../../../../../lib/network-store";
import { defaultOrgDeps, getOwnOrganization, updateOrganization } from "../../../../../lib/network-store-orgs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return guarded(async () => {
    const authority = await requireSession(request);
    return reply(await getOwnOrganization(await defaultOrgDeps(), authority));
  });
}

/** body { receivingAccount?: string|null, payerAgent?: string|null } -> organization. Handle and authority never change. */
export function PATCH(request: Request) {
  return guarded(async () => {
    requireSameOrigin(request);
    const authority = await requireSession(request);
    const body = await readJson(request);
    if (!body) return Response.json({ error: "invalid JSON" }, { status: 400 });
    return reply(await updateOrganization(await defaultOrgDeps(), authority, body));
  });
}
