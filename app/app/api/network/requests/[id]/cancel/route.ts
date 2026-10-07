// NOT AUDITED · DEVNET DEMONSTRATION ONLY
// Cancelling is not spending authorization: it revokes no intent and stops no transfer.
import { defaultDeps, guarded, readJson, requireSameOrigin, requireSession } from "../../../../../../lib/network-auth";
import { cancelRequest } from "../../../../../../lib/network-requests";
import { reply } from "../../../../../../lib/network-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Session + Origin only; the creator only. Body optional: {} or { reason: "edited", supersededBy: <new request id> } (edit = cancel + new request). */
export function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return guarded(async () => {
    requireSameOrigin(request);
    const authority = await requireSession(request);
    const body = (await readJson(request)) ?? {};
    return reply(await cancelRequest(await defaultDeps(), authority, (await params).id, body));
  });
}
