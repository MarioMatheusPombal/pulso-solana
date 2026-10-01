import { approvals } from "../../../../lib/store";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const found = approvals.get((await params).id.toLowerCase());
  if (!found) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(found);
}

export async function PATCH(req: Request, { params }: Ctx) {
  const found = approvals.get((await params).id.toLowerCase());
  if (!found) return Response.json({ error: "not found" }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  if (b.status !== "approved" && b.status !== "denied") {
    return Response.json({ error: 'status must be "approved" or "denied"' }, { status: 400 });
  }
  if (b.signature !== undefined && (typeof b.signature !== "string" || b.signature.length > 128)) {
    return Response.json({ error: "signature must be a string of at most 128 chars" }, { status: 400 });
  }
  if (found.status !== "pending") {
    return Response.json({ error: `request is already ${found.status}` }, { status: 409 });
  }
  found.status = b.status;
  if (b.signature !== undefined) found.signature = b.signature;
  return Response.json(found);
}
