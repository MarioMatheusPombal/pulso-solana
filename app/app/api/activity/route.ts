import { PublicKey } from "@solana/web3.js";
import { activities } from "../../../lib/store";
import { parseActivity } from "../../../lib/activity";

const MAX_EVENTS = 1000;
const PAGE_SIZE = 250;

export async function POST(req: Request) {
  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > 4096) return Response.json({ error: "activity report is too large" }, { status: 413 });
    body = JSON.parse(text);
  } catch { return Response.json({ error: "invalid JSON" }, { status: 400 }); }
  const parsed = parseActivity(body);
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });
  const existing = activities.get(parsed.value.eventId);
  if (existing) return Response.json(existing, { status: 200 });

  const event = { ...parsed.value, createdAt: new Date().toISOString() };
  activities.set(event.eventId, event);
  while (activities.size > MAX_EVENTS) activities.delete(activities.keys().next().value!);
  return Response.json(event, { status: 201 });
}

export async function GET(req: Request) {
  const policy = new URL(req.url).searchParams.get("policy");
  if (policy === null) return Response.json({ error: "policy query parameter is required" }, { status: 400 });
  if (policy.length > 44) return Response.json({ error: "policy must be a public key" }, { status: 400 });
  let canonical: string;
  try { canonical = new PublicKey(policy).toBase58(); } catch { return Response.json({ error: "policy must be a public key" }, { status: 400 }); }
  const list = [...activities.values()]
    .filter((event) => event.policy === canonical)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.eventId.localeCompare(b.eventId))
    .slice(-PAGE_SIZE);
  return Response.json(list);
}
