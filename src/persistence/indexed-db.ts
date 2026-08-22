import { validateSaveGame, type SaveGame } from "./save-game";

const DATABASE_NAME = "infrastructurio";
const DATABASE_VERSION = 1;
const SAVE_STORE_NAME = "saved-games";
const LOCAL_SAVE_KEY = "m0-scenario";

function indexedDbFactory(factory?: IDBFactory): IDBFactory {
  const resolved = factory ?? globalThis.indexedDB;
  if (!resolved) {
    throw new Error("IndexedDB is not available in this browser");
  }

  return resolved;
}

function openSaveDatabase(factory?: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const request = indexedDbFactory(factory).open(
      DATABASE_NAME,
      DATABASE_VERSION,
    );

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(SAVE_STORE_NAME)) {
        database.createObjectStore(SAVE_STORE_NAME);
      }
    };
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }

      settled = true;
      resolve(request.result);
    };
    request.onerror = () => {
      if (!settled) {
        settled = true;
        reject(request.error ?? new Error("Could not open the save database"));
      }
    };
    request.onblocked = () => {
      if (!settled) {
        settled = true;
        reject(new Error("Save database upgrade is blocked by another tab"));
      }
    };
  });
}

function transactionCompletion(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Save transaction failed"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Save transaction was aborted"));
  });
}

export async function saveLocalGame(
  save: SaveGame,
  factory?: IDBFactory,
): Promise<void> {
  const database = await openSaveDatabase(factory);
  try {
    const transaction = database.transaction(SAVE_STORE_NAME, "readwrite");
    transaction.objectStore(SAVE_STORE_NAME).put(
      validateSaveGame(save),
      LOCAL_SAVE_KEY,
    );
    await transactionCompletion(transaction);
  } finally {
    database.close();
  }
}

export async function loadLocalGame(
  factory?: IDBFactory,
): Promise<SaveGame | undefined> {
  const database = await openSaveDatabase(factory);
  try {
    const transaction = database.transaction(SAVE_STORE_NAME, "readonly");
    const request = transaction.objectStore(SAVE_STORE_NAME).get(LOCAL_SAVE_KEY);
    const result = await new Promise<unknown>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("Could not read the local save"));
    });
    await transactionCompletion(transaction);

    return result === undefined ? undefined : validateSaveGame(result);
  } finally {
    database.close();
  }
}
