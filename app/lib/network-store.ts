// NOT AUDITED · DEVNET DEMONSTRATION ONLY
// Trust boundary: organizations, connections and consents stored here are application state. They
// do NOT authorize spending; enforcement stays in the on-chain program (docs/B2B_NETWORK_SPEC.md section 1).
// One JSON file per collection, same lock + atomic rename pattern as waitlist-store.
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

/** Failure shape shared by the store modules; `reply` turns it into an HTTP response. */
export interface Fail { error: string; status: number; code?: string; [extra: string]: unknown }

export function reply(result: object): Response {
  if ("error" in result && "status" in result) {
    const { status, ...body } = result as Fail;
    return Response.json(body, { status });
  }
  return Response.json(result);
}

export const newId = () => randomBytes(16).toString("hex");

const pathOf = (dir: string, name: string) => join(dir, `${name}.json`);

export async function readCollection<T>(dir: string, name: string): Promise<T[]> {
  try {
    const parsed = JSON.parse(await readFile(pathOf(dir, name), "utf8")) as { version: number; items: T[] };
    if (parsed.version !== 1) throw new Error(`unsupported network storage format: ${name}`);
    return parsed.items;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function acquireLock(path: string) {
  const lockPath = `${path}.lock`;
  await mkdir(dirname(path), { recursive: true });
  for (let attempt = 0; attempt < 200; attempt += 1) {
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
      await delay(10);
    }
  }
  throw new Error("network storage is busy; try again");
}

/**
 * Read-modify-write of ONE collection under its lock. `fn` edits `items` in place and returns the
 * result; uniqueness and compare-and-set (`rev`) checks belong inside `fn`, which is what makes
 * them race-free. Persists only when `items` changed, so a refused call writes nothing.
 * Reused by #307 for `requests`.
 */
export async function mutateCollection<T, R>(dir: string, name: string, fn: (items: T[]) => R): Promise<R> {
  const path = pathOf(dir, name);
  const release = await acquireLock(path);
  try {
    const items = await readCollection<T>(dir, name);
    const before = JSON.stringify(items);
    const result = fn(items);
    const after = JSON.stringify(items);
    if (after !== before) {
      const tmp = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(tmp, JSON.stringify({ version: 1, items }), { encoding: "utf8", mode: 0o600 });
        await rename(tmp, path);
      } finally {
        await unlink(tmp).catch(() => undefined);
      }
    }
    return result;
  } finally {
    await release();
  }
}
