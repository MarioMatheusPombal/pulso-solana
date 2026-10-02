import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { POST } from "../app/api/waitlist/route";
import { addWaitlistEmail, exportWaitlistCsv, readWaitlist } from "../lib/waitlist-store";

const previousFile = process.env.PULSO_WAITLIST_FILE;
let temporaryDirectory: string | undefined;

async function useTemporaryStorage() {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "pulso-waitlist-"));
  process.env.PULSO_WAITLIST_FILE = join(temporaryDirectory, "waitlist.json");
}

afterEach(async () => {
  if (previousFile === undefined) delete process.env.PULSO_WAITLIST_FILE;
  else process.env.PULSO_WAITLIST_FILE = previousFile;
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = undefined;
});

function request(body: unknown) {
  return new Request("http://localhost/api/waitlist", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("waitlist API and storage", () => {
  it("validates, normalizes, persists, and deduplicates email addresses", async () => {
    await useTemporaryStorage();
    const created = await POST(request({ email: "  Person@Example.COM " }));
    expect(created.status).toBe(202);
    expect(await created.json()).toEqual({ ok: true });

    const duplicate = await POST(request({ email: "person@example.com" }));
    expect(duplicate.status).toBe(202);
    expect(await duplicate.json()).toEqual({ ok: true });
    expect(await readWaitlist()).toHaveLength(1);
    expect(await readFile(process.env.PULSO_WAITLIST_FILE!, "utf8")).toContain("person@example.com");
  });

  it("serializes simultaneous duplicate submissions", async () => {
    await useTemporaryStorage();
    const results = await Promise.all([
      addWaitlistEmail("same@example.com"),
      addWaitlistEmail(" SAME@example.com "),
    ]);
    expect(results.filter((result) => "duplicate" in result && !result.duplicate)).toHaveLength(1);
    expect(await readWaitlist()).toHaveLength(1);
  });

  it.each(["", "not-an-email", "a@b", "a b@example.com", "x".repeat(250) + "@example.com"])(
    "rejects invalid address %s",
    async (email) => {
      await useTemporaryStorage();
      const response = await POST(request({ email }));
      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(/valid email/);
      expect(await readWaitlist()).toHaveLength(0);
    },
  );

  it("rejects malformed or oversized requests", async () => {
    const malformed = new Request("http://localhost/api/waitlist", { method: "POST", body: "{" });
    expect((await POST(malformed)).status).toBe(400);
    const oversized = new Request("http://localhost/api/waitlist", { method: "POST", body: " ".repeat(1025) });
    expect((await POST(oversized)).status).toBe(413);
    expect((await POST(request({}))).status).toBe(400);
  });

  it("exports a quoted CSV with a header and timestamps", () => {
    expect(exportWaitlistCsv([{ email: 'person+tag@example.com', createdAt: "2026-10-01T00:00:00.000Z" }]))
      .toBe('email,created_at\r\n"person+tag@example.com","2026-10-01T00:00:00.000Z"\r\n');
  });
});
