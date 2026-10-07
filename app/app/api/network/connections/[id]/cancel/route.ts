// NOT AUDITED · DEVNET DEMONSTRATION ONLY
// A connection is not spending authorization; enforcement stays on-chain.
import { defaultDeps, guarded, requireSameOrigin, requireSession } from "../../../../../../lib/network-auth";
import { reply } from "../../../../../../lib/network-store";
import { cancel } from "../../../../../../lib/network-store-connections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** No body, no signature: session + Origin only. Inviter only. Idempotent. 404 for non-participants, 409 with current state on a lost race. */
export function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return guarded(async () => {
    requireSameOrigin(request);
    const authority = await requireSession(request);
    return reply(await cancel(await defaultDeps(), authority, (await params).id));
  });
}
