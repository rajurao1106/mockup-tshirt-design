import type { EngineProject, Side } from "@/lib/engine";

const DATABASE_NAME = "mockup-design-saves";
const DATABASE_VERSION = 1;
const SUMMARY_STORE = "summaries";
const PROJECT_STORE = "projects";

export interface SavedDesignSummary {
  id: string;
  name: string;
  color: string;
  side: Side;
  createdAt: string;
}

interface SavedDesignProject {
  id: string;
  project: EngineProject;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(SUMMARY_STORE)) {
        database.createObjectStore(SUMMARY_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(PROJECT_STORE)) {
        database.createObjectStore(PROJECT_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Saved designs storage could not be opened"));
    request.onblocked = () => reject(new Error("Saved designs storage is blocked by another tab"));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Saved design request failed"));
  });
}

function transactionResult(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Saved design could not be stored"));
    transaction.onabort = () => reject(transaction.error ?? new Error("Saved design storage was interrupted"));
  });
}

export async function listSavedDesigns(): Promise<SavedDesignSummary[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(SUMMARY_STORE, "readonly");
    const summaries = await requestResult(transaction.objectStore(SUMMARY_STORE).getAll() as IDBRequest<SavedDesignSummary[]>);
    return summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } finally {
    database.close();
  }
}

export async function saveDesign(summary: SavedDesignSummary, project: EngineProject): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction([SUMMARY_STORE, PROJECT_STORE], "readwrite");
    const completed = transactionResult(transaction);
    transaction.objectStore(SUMMARY_STORE).put(summary);
    transaction.objectStore(PROJECT_STORE).put({ id: summary.id, project } satisfies SavedDesignProject);
    await completed;
  } finally {
    database.close();
  }
}

export async function loadDesign(id: string): Promise<EngineProject> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(PROJECT_STORE, "readonly");
    const saved = await requestResult(
      transaction.objectStore(PROJECT_STORE).get(id) as IDBRequest<SavedDesignProject | undefined>,
    );
    if (!saved) throw new Error("Saved design was not found");
    return saved.project;
  } finally {
    database.close();
  }
}

export async function deleteSavedDesign(id: string): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction([SUMMARY_STORE, PROJECT_STORE], "readwrite");
    const completed = transactionResult(transaction);
    transaction.objectStore(SUMMARY_STORE).delete(id);
    transaction.objectStore(PROJECT_STORE).delete(id);
    await completed;
  } finally {
    database.close();
  }
}
