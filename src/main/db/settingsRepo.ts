import { getDb } from "./database";
import type { AppSettings } from "@shared/types";
import { DEFAULT_SETTINGS } from "@shared/types";

const KEY = "app";

export function getSettings(): AppSettings {
  const row = getDb().prepare("SELECT v FROM settings WHERE k = ?").get(KEY) as
    | { v: string }
    | undefined;
  if (!row) return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, ...JSON.parse(row.v) };
}

export function setSettings(patch: Partial<AppSettings>): AppSettings {
  const merged = { ...getSettings(), ...patch };
  getDb()
    .prepare(
      "INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
    )
    .run(KEY, JSON.stringify(merged));
  return merged;
}
