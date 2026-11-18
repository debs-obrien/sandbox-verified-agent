import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { get, put } from "@vercel/blob";
import type { EvidencePack, Receipt } from "../types";
import { hasBlobToken } from "../config";

/**
 * Durable receipt persistence:
 * - Prefer Vercel Blob when BLOB_READ_WRITE_TOKEN is set (required on deploy
 *   so /receipt/[id] works across function instances).
 * - Local-dev fallback: ./data/receipts on the filesystem.
 * - In-memory cache for same-instance reads after a run.
 * - Checked-in samples/ remain a read-only offline fallback.
 * - Evidence packs live beside receipts: receipts/{id}.evidence.json
 */

const memory = new Map<string, Receipt>();
const evidenceMemory = new Map<string, EvidencePack>();
const LOCAL_DATA_DIR = path.join(process.cwd(), "data", "receipts");
const SAMPLES_DIR = path.join(process.cwd(), "samples");
const BLOB_PREFIX = "receipts";

function safeId(id: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error("Invalid receipt id");
  }
  return id;
}

function blobPathname(id: string): string {
  return `${BLOB_PREFIX}/${id}.json`;
}

export function evidenceBlobPathname(id: string): string {
  return `${BLOB_PREFIX}/${id}.evidence.json`;
}

async function streamToString(
  stream: ReadableStream<Uint8Array>,
): Promise<string> {
  return new Response(stream).text();
}

async function saveToBlob(id: string, json: string): Promise<boolean> {
  if (!hasBlobToken()) return false;
  try {
    await put(blobPathname(id), json, {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    return true;
  } catch (err) {
    console.error("Blob put failed for receipt", id, err);
    return false;
  }
}

async function loadFromBlob(id: string): Promise<Receipt | null> {
  if (!hasBlobToken()) return null;
  try {
    const result = await get(blobPathname(id), {
      access: "private",
      useCache: false,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    const text = await streamToString(result.stream);
    return JSON.parse(text) as Receipt;
  } catch (err) {
    console.error("Blob get failed for receipt", id, err);
    return null;
  }
}

async function saveToLocal(id: string, json: string): Promise<boolean> {
  try {
    await mkdir(LOCAL_DATA_DIR, { recursive: true });
    await writeFile(
      /*turbopackIgnore: true*/ path.join(LOCAL_DATA_DIR, `${id}.json`),
      json,
      "utf8",
    );
    return true;
  } catch {
    return false;
  }
}

async function loadFromLocal(id: string): Promise<Receipt | null> {
  try {
    const raw = await readFile(
      /*turbopackIgnore: true*/ path.join(LOCAL_DATA_DIR, `${id}.json`),
      "utf8",
    );
    return JSON.parse(raw) as Receipt;
  } catch {
    return null;
  }
}

async function loadFromSamples(id: string): Promise<Receipt | null> {
  try {
    const raw = await readFile(
      /*turbopackIgnore: true*/ path.join(SAMPLES_DIR, `${id}.json`),
      "utf8",
    );
    return JSON.parse(raw) as Receipt;
  } catch {
    return null;
  }
}

export async function saveReceipt(receipt: Receipt): Promise<void> {
  const id = safeId(receipt.id);
  memory.set(id, receipt);
  const json = JSON.stringify(receipt, null, 2);

  const blobOk = await saveToBlob(id, json);
  if (!blobOk) {
    // Local/dev fallback when Blob is not configured.
    await saveToLocal(id, json);
  }
}

export async function loadReceipt(id: string): Promise<Receipt | null> {
  const safe = safeId(id);
  const fromMem = memory.get(safe);
  if (fromMem) return fromMem;

  const fromBlob = await loadFromBlob(safe);
  if (fromBlob) {
    memory.set(safe, fromBlob);
    return fromBlob;
  }

  const fromLocal = await loadFromLocal(safe);
  if (fromLocal) {
    memory.set(safe, fromLocal);
    return fromLocal;
  }

  const fromSample = await loadFromSamples(safe);
  if (fromSample) {
    memory.set(safe, fromSample);
    return fromSample;
  }

  return null;
}

async function saveEvidenceToBlob(id: string, json: string): Promise<boolean> {
  if (!hasBlobToken()) return false;
  try {
    await put(evidenceBlobPathname(id), json, {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    return true;
  } catch (err) {
    console.error("Blob put failed for evidence pack", id, err);
    return false;
  }
}

async function loadEvidenceFromBlob(id: string): Promise<EvidencePack | null> {
  if (!hasBlobToken()) return null;
  try {
    const result = await get(evidenceBlobPathname(id), {
      access: "private",
      useCache: false,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    const text = await streamToString(result.stream);
    return JSON.parse(text) as EvidencePack;
  } catch (err) {
    console.error("Blob get failed for evidence pack", id, err);
    return null;
  }
}

async function saveEvidenceToLocal(id: string, json: string): Promise<boolean> {
  try {
    await mkdir(LOCAL_DATA_DIR, { recursive: true });
    await writeFile(
      /*turbopackIgnore: true*/ path.join(
        LOCAL_DATA_DIR,
        `${id}.evidence.json`,
      ),
      json,
      "utf8",
    );
    return true;
  } catch {
    return false;
  }
}

async function loadEvidenceFromLocal(id: string): Promise<EvidencePack | null> {
  try {
    const raw = await readFile(
      /*turbopackIgnore: true*/ path.join(
        LOCAL_DATA_DIR,
        `${id}.evidence.json`,
      ),
      "utf8",
    );
    return JSON.parse(raw) as EvidencePack;
  } catch {
    return null;
  }
}

/**
 * Persist the evidence pack. Returns ok=false on total failure so callers
 * can skip snapshot deletion (do not silently lose proof).
 */
export async function saveEvidencePack(
  id: string,
  pack: EvidencePack,
): Promise<{ ok: boolean; pathname: string; error?: string }> {
  const safe = safeId(id);
  const pathname = evidenceBlobPathname(safe);
  const json = JSON.stringify(pack, null, 2);
  evidenceMemory.set(safe, pack);

  const blobOk = await saveEvidenceToBlob(safe, json);
  if (blobOk) return { ok: true, pathname };

  const localOk = await saveEvidenceToLocal(safe, json);
  if (localOk) {
    return {
      ok: true,
      pathname: path.join(LOCAL_DATA_DIR, `${safe}.evidence.json`),
    };
  }

  evidenceMemory.delete(safe);
  return {
    ok: false,
    pathname,
    error: "Failed to write evidence pack to Blob and local disk.",
  };
}

export async function loadEvidencePack(
  id: string,
): Promise<EvidencePack | null> {
  const safe = safeId(id);
  const fromMem = evidenceMemory.get(safe);
  if (fromMem) return fromMem;

  const fromBlob = await loadEvidenceFromBlob(safe);
  if (fromBlob) {
    evidenceMemory.set(safe, fromBlob);
    return fromBlob;
  }

  const fromLocal = await loadEvidenceFromLocal(safe);
  if (fromLocal) {
    evidenceMemory.set(safe, fromLocal);
    return fromLocal;
  }

  return null;
}

/** Test helpers — not used in production paths. */
export const __test = {
  memory,
  evidenceMemory,
  blobPathname,
  evidenceBlobPathname,
  safeId,
  hasBlobToken,
  LOCAL_DATA_DIR,
  BLOB_PREFIX,
};
