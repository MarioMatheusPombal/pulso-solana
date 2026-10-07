// NOT AUDITED · DEVNET DEMONSTRATION ONLY
// Network sign-in is not spending authorization; enforcement stays on-chain.
import { defaultDeps, getSession, sessionToken } from "../../../../../lib/network-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** -> { authority, cluster, expiresAt } or 401 */
export async function GET(request: Request) {
  const session = await getSession(await defaultDeps(), sessionToken(request));
  if (!session) return Response.json({ error: "authentication required" }, { status: 401 });
  return Response.json(session);
}
