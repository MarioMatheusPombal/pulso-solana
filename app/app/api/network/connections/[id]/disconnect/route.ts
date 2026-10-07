// NOT AUDITED · DEVNET DEMONSTRATION ONLY
// A connection is not spending authorization; enforcement stays on-chain.
// Also cancels the pair's requests with no payment sent yet (reason disconnect).
import { defaultDeps, guarded, requireSameOrigin, requireSession } from "../../../../../../lib/network-auth";
import { reply } from "../../../../../../lib/network-store";
import { disconnect } from "../../../../../../lib/network-store-connections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** No body, no signature: session + Origin only. Either side. Idempotent. 404 for non-participants, 409 with current state if not active. */
export function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return guarded(async () => {
    requireSameOrigin(request);
    const authority = await requireSession(request);
    return reply(await disconnect(await defaultDeps(), authority, (await params).id));
  });
}
