import { approvals, type ApprovalStatus } from "../../../lib/store";
import { parseNewRequest } from "../../../lib/validate";

const STATUSES = ["pending", "approved", "denied"];

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const parsed = parseNewRequest(body);
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });

  const existing = approvals.get(parsed.value.id);
  if (existing) return Response.json(existing, { status: 200 });

  const created = { ...parsed.value, status: "pending" as const, createdAt: new Date().toISOString() };
  approvals.set(created.id, created);
  return Response.json(created, { status: 201 });
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const authority = q.get("authority");
  const status = q.get("status");
  if (status !== null && !STATUSES.includes(status)) {
    return Response.json({ error: "status must be pending, approved or denied" }, { status: 400 });
  }
  const list = [...approvals.values()]
    .filter((a) => (authority === null || a.authority === authority) && (status === null || a.status === (status as ApprovalStatus)))
    .reverse(); // Map keeps insertion order: newest first
  return Response.json(list);
}
