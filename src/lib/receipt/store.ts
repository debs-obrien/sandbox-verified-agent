import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import type { Receipt } from "../types";

/**
 * Receipt persistence for local + Vercel:
 * - Always keep an in-memory map (same-instance redirect after /api/run).
 * - Prefer writable /tmp on Vercel (app dir is read-only).
 * - Also try ./data/receipts locally when writable.
 * - Checked-in samples/ remain a read-only fallback.
 *
 * Multi-instance durable storage (Blob/KV/DB) is out of scope for this small
 * demo; document Deployment Protection + RUN_SECRET instead of pretending
 * filesystem durability across regions.
 */

const memory = new Map<string, Receipt>();

const TMP_DIR = path.join(tmpdir(), "sandbox-verified-agent", "receipts");
const LOCAL_DATA_DIR = path.join(process.cwd(), "data", "receipts");
const SAMPLES_DIR = path.join(process.cwd(), "samples");

function safeId(id: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error("Invalid receipt id");
  }
  return id;
}

async function tryWrite(dir: string, id: string, json: string): Promise<boolean> {
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(
      /*turbopackIgnore: true*/ path.join(dir, `${id}.json`),
      json,
      "utf8",
    );
    return true;
  } catch {
    return false;
  }
}

async function tryRead(file: string): Promise<Receipt | null> {
  try {
    const raw = await readFile(/*turbopackIgnore: true*/ file, "utf8");
    return JSON.parse(raw) as Receipt;
  } catch {
    return null;
  }
}

export async function saveReceipt(receipt: Receipt): Promise<void> {
  const id = safeId(receipt.id);
  memory.set(id, receipt);
  const json = JSON.stringify(receipt, null, 2);
  // Prefer /tmp (works on Vercel); local data/ is best-effort.
  await tryWrite(TMP_DIR, id, json);
  await tryWrite(LOCAL_DATA_DIR, id, json);
}

export async function loadReceipt(id: string): Promise<Receipt | null> {
  const safe = safeId(id);
  const fromMem = memory.get(safe);
  if (fromMem) return fromMem;

  const candidates = [
    path.join(TMP_DIR, `${safe}.json`),
    path.join(LOCAL_DATA_DIR, `${safe}.json`),
    path.join(SAMPLES_DIR, `${safe}.json`),
  ];

  for (const file of candidates) {
    const receipt = await tryRead(file);
    if (receipt) {
      memory.set(safe, receipt);
      return receipt;
    }
  }
  return null;
}
