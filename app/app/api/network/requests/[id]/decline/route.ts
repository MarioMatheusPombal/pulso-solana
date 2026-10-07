// NOT AUDITED · DEVNET DEMONSTRATION ONLY
// Declining is not spending authorization and revokes nothing on-chain.
import { defaultDeps, guarded, requireSameOrigin, requireSession } from "../../../../../../lib/network-auth";
import { declineRequest } from "../../../../../../lib/network-requests";
import { reply } from "../../../../../../lib/network-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** No body, no signature: session + Origin only. Receiver of a proposal, or payer of a charge. Idempotent; 409 with current state otherwise. */
export function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return guarded(async () => {
    requireSameOrigin(request);
    const authority = await requireSession(request);
    return reply(await declineRequest(await defaultDeps(), authority, (await params).id));
  });
}
