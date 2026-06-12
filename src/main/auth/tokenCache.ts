import type { ICachePlugin, TokenCacheContext } from "@azure/msal-node";
import { app, safeStorage } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * MSAL cache persistence encrypted with Electron safeStorage
 * (DPAPI on Windows, libsecret on Linux). The refresh token never
 * touches disk in plaintext.
 */
export function createSafeStorageCachePlugin(): ICachePlugin {
  const dir = app.getPath("userData");
  const cachePath = join(dir, "msal.cache");

  return {
    async beforeCacheAccess(ctx: TokenCacheContext): Promise<void> {
      if (!existsSync(cachePath)) return;
      try {
        const blob = readFileSync(cachePath);
        ctx.tokenCache.deserialize(safeStorage.decryptString(blob));
      } catch {
        // Corrupt or undecryptable cache: start clean rather than crash sign-in.
      }
    },
    async afterCacheAccess(ctx: TokenCacheContext): Promise<void> {
      if (!ctx.cacheHasChanged) return;
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error("OS secure storage unavailable; refusing to persist tokens.");
      }
      mkdirSync(dir, { recursive: true });
      writeFileSync(cachePath, safeStorage.encryptString(ctx.tokenCache.serialize()), {
        mode: 0o600,
      });
    },
  };
}
