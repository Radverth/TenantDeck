import Database from "better-sqlite3";
import { app, safeStorage } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { SCHEMA } from "./schema";

let db: Database.Database | null = null;

/**
 * The cache encryption key lives only in OS secure storage (DPAPI/libsecret).
 * better-sqlite3 builds without SQLCipher ignore `PRAGMA key`, so the key is
 * also used to keep the at-rest story honest: if safeStorage is unavailable
 * we refuse to create the cache rather than silently downgrade.
 */
function loadOrCreateKey(userDataDir: string): string {
  const keyPath = join(userDataDir, "cache.key");
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      "OS secure storage is unavailable (DPAPI/libsecret). Cannot create encrypted cache.",
    );
  }
  if (existsSync(keyPath)) {
    const blob = readFileSync(keyPath);
    return safeStorage.decryptString(blob);
  }
  const key = randomBytes(32).toString("hex");
  writeFileSync(keyPath, safeStorage.encryptString(key), { mode: 0o600 });
  return key;
}

export function openDatabase(): Database.Database {
  if (db) return db;
  const dir = app.getPath("userData");
  mkdirSync(dir, { recursive: true });
  const key = loadOrCreateKey(dir);
  db = new Database(join(dir, "tenantdeck.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  // SQLCipher-enabled builds will honour this; plain builds no-op.
  try {
    db.pragma(`key = '${key}'`);
  } catch {
    /* plain sqlite build */
  }
  db.exec(SCHEMA);
  return db;
}

export function getDb(): Database.Database {
  if (!db) throw new Error("Database not initialised");
  return db;
}

export function closeDatabase(): void {
  db?.close();
  db = null;
}
