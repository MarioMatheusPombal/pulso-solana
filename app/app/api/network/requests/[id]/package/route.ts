// NOT AUDITED · DEVNET DEMONSTRATION ONLY
// A request is not spending authorization; enforcement stays on-chain.
import { defaultDeps, guarded, requireSession } from "../../../../../../lib/network-auth";
import { requestPackage } from "../../../../../../lib/network-requests";
import { reply } from "../../../../../../lib/network-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Participants only -> pulso-b2b-package-v1 (format in lib/network-requests.ts). No private description. */
export function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return guarded(async () => {
    const authority = await requireSession(request);
    return reply(await requestPackage(await defaultDeps(), authority, (await params).id));
  });
}
