import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const inputPath = resolve(process.env.PULSO_WAITLIST_FILE || resolve(scriptDirectory, "../.data/waitlist.json"));
const format = process.argv[2] || "csv";
const outputPath = process.argv[3];

if (format !== "csv" && format !== "ndjson") {
  console.error("Usage: node app/scripts/export-waitlist.mjs [csv|ndjson] [output-file]");
  process.exitCode = 2;
} else {
  const parsed = JSON.parse(await readFile(inputPath, "utf8"));
  if (parsed.version !== 1 || !Array.isArray(parsed.entries)) throw new Error("unsupported waitlist storage format");
  const escape = (value) => `"${String(value).replaceAll('"', '""')}"`;
  const output = format === "csv"
    ? ["email,created_at", ...parsed.entries.map((entry) => `${escape(entry.email)},${escape(entry.createdAt)}`)].join("\r\n") + "\r\n"
    : parsed.entries.map((entry) => JSON.stringify(entry)).join("\n") + (parsed.entries.length ? "\n" : "");
  if (outputPath) await writeFile(resolve(outputPath), output, "utf8");
  else process.stdout.write(output);
}
