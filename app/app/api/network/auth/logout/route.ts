// NOT AUDITED · DEVNET DEMONSTRATION ONLY
// Network sign-in is not spending authorization; enforcement stays on-chain.
import { defaultDeps, destroySession, guarded, requireSameOrigin, sessionCookie, sessionToken } from "../../../../../lib/network-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return guarded(async () => {
    requireSameOrigin(request);
    await destroySession(await defaultDeps(), sessionToken(request));
    return Response.json({ ok: true }, { headers: { "Set-Cookie": sessionCookie("", 0) } });
  });
}
