"use client";

/**
 * Pre-account draft persistence (issue #58, PRD #54).
 *
 * An anonymous visitor's prepared work — person photo, reference motion
 * choice, engine — is browser-only until they authenticate. The generation
 * gate saves it here (IndexedDB holds Files natively) right before the
 * full-page redirect to Keycloak, and the studio restores it on return so
 * the draft survives sign-in and the optional Stripe Checkout detour.
 * Nothing in this module ever talks to the network.
 */

export type DraftReference =
  | { kind: "curated"; danceId: string }
  | { kind: "clip"; file: File; source: "uploaded" | "imported" }
  | { kind: "url"; url: string };

export type PreAccountDraft = {
  photo: File;
  reference: DraftReference;
  engineId: string;
  savedAt: number;
};

const DB_NAME = "dg-draft";
const STORE = "draft";
const KEY = "current";
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Files are flattened to bytes + metadata before storage: structured-clone
 * support for File objects is uneven across storage implementations, and
 * plain ArrayBuffers round-trip everywhere.
 */
type StoredFile = { bytes: ArrayBuffer; name: string; type: string };

type StoredReference =
  | { kind: "curated"; danceId: string }
  | { kind: "clip"; file: StoredFile; source: "uploaded" | "imported" }
  | { kind: "url"; url: string };

type StoredDraft = {
  photo: StoredFile;
  reference: StoredReference;
  engineId: string;
  savedAt: number;
};

async function toStoredFile(file: File): Promise<StoredFile> {
  return { bytes: await file.arrayBuffer(), name: file.name, type: file.type };
}

function fromStoredFile(stored: StoredFile): File {
  return new File([stored.bytes], stored.name, { type: stored.type });
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
    });
  } finally {
    db.close();
  }
}

export async function saveDraft(
  draft: Omit<PreAccountDraft, "savedAt">,
  savedAt: number = Date.now(),
): Promise<void> {
  const stored: StoredDraft = {
    photo: await toStoredFile(draft.photo),
    reference:
      draft.reference.kind === "clip"
        ? { ...draft.reference, file: await toStoredFile(draft.reference.file) }
        : draft.reference,
    engineId: draft.engineId,
    savedAt,
  };
  await withStore("readwrite", (store) => store.put(stored, KEY));
}

export async function loadDraft(): Promise<PreAccountDraft | null> {
  const stored = (await withStore<unknown>("readonly", (store) => store.get(KEY))) as
    | StoredDraft
    | undefined;
  if (!stored) return null;
  if (Date.now() - stored.savedAt > DRAFT_TTL_MS) {
    await clearDraft();
    return null;
  }
  return {
    photo: fromStoredFile(stored.photo),
    reference:
      stored.reference.kind === "clip"
        ? { ...stored.reference, file: fromStoredFile(stored.reference.file) }
        : stored.reference,
    engineId: stored.engineId,
    savedAt: stored.savedAt,
  };
}

export async function clearDraft(): Promise<void> {
  await withStore("readwrite", (store) => store.delete(KEY));
}
