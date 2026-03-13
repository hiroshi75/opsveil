// ============================================================
// Safe I/O utilities — atomic writes & resilient JSON reads
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

/**
 * Atomically write a file by writing to a temp file in the same
 * directory, then renaming.  rename(2) is atomic on POSIX systems,
 * so readers always see a complete file.
 */
export async function atomicWriteFile(
  filePath: string,
  data: string
): Promise<void> {
  const dir = path.dirname(filePath);
  const tmp = path.join(dir, `.tmp-${randomBytes(6).toString("hex")}`);
  try {
    await fs.promises.writeFile(tmp, data, "utf-8");
    await fs.promises.rename(tmp, filePath);
  } catch (err) {
    // Clean up temp file on failure
    await fs.promises.unlink(tmp).catch(() => {});
    throw err;
  }
}

/**
 * Read and parse a JSON file with retry on parse error.
 *
 * If the first read yields invalid JSON (e.g. caught mid-write),
 * waits briefly and retries once.  Returns the fallback value
 * if the file doesn't exist or all attempts fail.
 */
export async function safeReadJson<T>(
  filePath: string,
  fallback: T,
  { retries = 1, retryDelayMs = 50 } = {}
): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const raw = await fs.promises.readFile(filePath, "utf-8");
      return JSON.parse(raw) as T;
    } catch (err: unknown) {
      const isParseError =
        err instanceof SyntaxError ||
        (err instanceof Error && err.message.includes("Unexpected"));
      if (isParseError && attempt < retries) {
        // Brief wait then retry — the writer should finish soon
        await new Promise((r) => setTimeout(r, retryDelayMs));
        continue;
      }
      // File not found or persistent parse error → use fallback
      return fallback;
    }
  }
  return fallback;
}
