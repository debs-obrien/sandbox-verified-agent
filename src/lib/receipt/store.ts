import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Receipt } from "../types";

const DATA_DIR = path.join(process.cwd(), "data", "receipts");
const SAMPLES_DIR = path.join(process.cwd(), "samples");

async function ensureDir() {
  await mkdir(DATA_DIR, { recursive: true });
}

function safeId(id: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error("Invalid receipt id");
  }
  return id;
}

export async function saveReceipt(receipt: Receipt): Promise<void> {
  await ensureDir();
  const id = safeId(receipt.id);
  const file = path.join(DATA_DIR, `${id}.json`);
  await writeFile(
    /*turbopackIgnore: true*/ file,
    JSON.stringify(receipt, null, 2),
    "utf8",
  );
}

export async function loadReceipt(id: string): Promise<Receipt | null> {
  const safe = safeId(id);
  const candidates = [
    path.join(DATA_DIR, `${safe}.json`),
    path.join(SAMPLES_DIR, `${safe}.json`),
  ];

  for (const file of candidates) {
    try {
      const raw = await readFile(/*turbopackIgnore: true*/ file, "utf8");
      return JSON.parse(raw) as Receipt;
    } catch {
      // try next
    }
  }
  return null;
}
