import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export interface WaitlistEntry {
  email: string;
  createdAt: string;
}

type WaitlistFile = { version: 1; entries: WaitlistEntry[] };
const DEFAULT_FILE = join(process.cwd(), ".data", "waitlist.json");

function storagePath() {
  return process.env.PULSO_WAITLIST_FILE || DEFAULT_FILE;
}

export function normalizeWaitlistEmail(input: string): string | null {
  const email = input.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

async function readFileEntries(path: string): Promise<WaitlistEntry[]> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as WaitlistFile;
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) throw new Error("unsupported waitlist storage format");
    return parsed.entries;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function acquireLock(path: string) {
  const lockPath = `${path}.lock`;
  await mkdir(dirname(path), { recursive: true });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      return async () => {
        await handle.close();
        await unlink(lockPath).catch(() => undefined);
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        if (Date.now() - (await stat(lockPath)).mtimeMs > 60_000) await unlink(lockPath);
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code !== "ENOENT") throw statError;
      }
      await delay(25);
    }
  }
  throw new Error("waitlist storage is busy; try again");
}

export async function addWaitlistEmail(input: string): Promise<{ entry: WaitlistEntry; duplicate: boolean } | { error: string }> {
  const email = normalizeWaitlistEmail(input);
  if (!email) return { error: "enter a valid email address" };

  const path = storagePath();
  const release = await acquireLock(path);
  try {
    const entries = await readFileEntries(path);
    const existing = entries.find((entry) => entry.email === email);
    if (existing) return { entry: existing, duplicate: true };

    const entry = { email, createdAt: new Date().toISOString() };
    const data: WaitlistFile = { version: 1, entries: [...entries, entry] };
    const temporaryPath = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporaryPath, path);
    } finally {
      await unlink(temporaryPath).catch(() => undefined);
    }
    return { entry, duplicate: false };
  } finally {
    await release();
  }
}

export async function readWaitlist(): Promise<WaitlistEntry[]> {
  return readFileEntries(storagePath());
}

export function exportWaitlistCsv(entries: WaitlistEntry[]): string {
  const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
  return ["email,created_at", ...entries.map((entry) => `${escape(entry.email)},${escape(entry.createdAt)}`)].join("\r\n") + "\r\n";
}
