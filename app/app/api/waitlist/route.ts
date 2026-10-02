import { addWaitlistEmail } from "../../../lib/waitlist-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > 1024) return Response.json({ error: "request is too large" }, { status: 413 });
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null || Array.isArray(body) || !("email" in body) || typeof body.email !== "string") {
    return Response.json({ error: "email is required" }, { status: 400 });
  }

  const result = await addWaitlistEmail(body.email);
  if ("error" in result) return Response.json({ error: result.error }, { status: 400 });
  // Keep the response identical so the public endpoint cannot be used to check
  // whether a particular address is already registered.
  return Response.json({ ok: true }, { status: 202 });
}
