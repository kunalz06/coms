import type { ArchivedMessagePayload } from "@/types";

const DB_NAME = "comms-archive-cache";
const DB_VERSION = 1;
const STORE_NAME = "conversation-archives";

type ArchiveCacheRecord = {
  conversationId: string;
  cachedAt: string;
  version: number;
  messages: ArchivedMessagePayload[];
};

function openArchiveDb() {
  if (typeof window === "undefined" || !("indexedDB" in window)) return Promise.resolve(null);

  return new Promise<IDBDatabase | null>((resolve) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: "conversationId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

export async function getCachedArchiveMessages(conversationId: string) {
  const db = await openArchiveDb();
  if (!db) return null;
  return new Promise<ArchivedMessagePayload[] | null>((resolve) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(conversationId);
    request.onsuccess = () => {
      const record = request.result as ArchiveCacheRecord | undefined;
      resolve(record?.version === DB_VERSION ? record.messages : null);
    };
    request.onerror = () => resolve(null);
    transaction.oncomplete = () => db.close();
  });
}

export async function setCachedArchiveMessages(conversationId: string, messages: ArchivedMessagePayload[]) {
  const db = await openArchiveDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put({
      conversationId,
      cachedAt: new Date().toISOString(),
      version: DB_VERSION,
      messages
    } satisfies ArchiveCacheRecord);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      resolve();
    };
  });
}

export async function clearArchiveCache() {
  const db = await openArchiveDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).clear();
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      resolve();
    };
  });
}
