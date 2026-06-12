import {
  PublicClientApplication,
  CryptoProvider,
  type AccountInfo,
  type AuthenticationResult,
} from "@azure/msal-node";
import { shell } from "electron";
import { createServer, type Server } from "node:http";
import { createSafeStorageCachePlugin } from "./tokenCache";
import { getSettings, setSettings } from "../db/settingsRepo";
import type { AuthStatus } from "@shared/types";

const GRAPH_SCOPES = ["https://graph.microsoft.com/.default", "offline_access"];
const LOOPBACK_PORTS = [53682, 53683, 53684];

/**
 * Zero-footprint GDAP auth: MSAL public client (Microsoft first-party,
 * pre-consented) using auth code + PKCE through the system browser.
 * No client secret exists anywhere. Per-tenant access tokens are redeemed
 * silently against each customer authority; effective rights are the
 * intersection of requested scopes and the engineer's GDAP roles.
 */
export class AuthService {
  private pca: PublicClientApplication | null = null;
  private account: AccountInfo | null = null;
  private listeners = new Set<(s: AuthStatus) => void>();

  private getPca(): PublicClientApplication {
    if (!this.pca) {
      const { clientId } = getSettings();
      this.pca = new PublicClientApplication({
        auth: {
          clientId,
          authority: "https://login.microsoftonline.com/organizations",
        },
        cache: { cachePlugin: createSafeStorageCachePlugin() },
      });
    }
    return this.pca;
  }

  /** Drop the cached client so a clientId change in Settings takes effect. */
  resetClient(): void {
    this.pca = null;
  }

  onChange(listener: (s: AuthStatus) => void): void {
    this.listeners.add(listener);
  }

  private emit(): void {
    const status = this.statusFromAccount();
    for (const l of this.listeners) l(status);
  }

  private statusFromAccount(): AuthStatus {
    return {
      signedIn: this.account !== null,
      account: this.account
        ? {
            username: this.account.username,
            name: this.account.name ?? null,
            partnerTenantId: this.account.tenantId,
          }
        : null,
    };
  }

  async getStatus(): Promise<AuthStatus> {
    if (!this.account) {
      const accounts = await this.getPca().getTokenCache().getAllAccounts();
      this.account = accounts[0] ?? null;
    }
    return this.statusFromAccount();
  }

  /** Interactive sign-in: auth code + PKCE via system browser and loopback redirect. */
  async signIn(): Promise<AuthStatus> {
    const pca = this.getPca();
    const crypto = new CryptoProvider();
    const { verifier, challenge } = await crypto.generatePkceCodes();
    const state = crypto.createNewGuid();

    const { server, port, codePromise } = await this.startLoopback(state);
    const redirectUri = `http://localhost:${port}`;

    try {
      const authUrl = await pca.getAuthCodeUrl({
        scopes: GRAPH_SCOPES,
        redirectUri,
        codeChallenge: challenge,
        codeChallengeMethod: "S256",
        state,
        prompt: "select_account",
      });
      await shell.openExternal(authUrl);

      const code = await codePromise;
      const result = await pca.acquireTokenByCode({
        scopes: GRAPH_SCOPES,
        redirectUri,
        code,
        codeVerifier: verifier,
      });
      this.account = result.account;
      const settings = getSettings();
      if (result.account && settings.partnerTenantId !== result.account.tenantId) {
        setSettings({ partnerTenantId: result.account.tenantId });
      }
      this.emit();
      return this.statusFromAccount();
    } finally {
      server.close();
    }
  }

  async signOut(): Promise<void> {
    if (this.account) {
      await this.getPca().getTokenCache().removeAccount(this.account);
      this.account = null;
    }
    this.emit();
  }

  /** Silent token for the partner tenant (GDAP discovery). */
  async getPartnerToken(): Promise<string> {
    return this.getTokenForTenant(null);
  }

  /**
   * Silent per-tenant token: redeem the cached refresh token against the
   * customer authority. Pre-consented first-party client → no consent prompt.
   */
  async getTokenForTenant(tenantId: string | null): Promise<string> {
    const status = await this.getStatus();
    if (!status.signedIn || !this.account) {
      throw new Error("Not signed in");
    }
    const authority = tenantId
      ? `https://login.microsoftonline.com/${tenantId}`
      : `https://login.microsoftonline.com/${this.account.tenantId}`;
    const result: AuthenticationResult | null = await this.getPca().acquireTokenSilent({
      account: this.account,
      scopes: ["https://graph.microsoft.com/.default"],
      authority,
    });
    if (!result) throw new Error(`Token acquisition failed for ${tenantId ?? "partner"}`);
    return result.accessToken;
  }

  private startLoopback(expectedState: string): Promise<{
    server: Server;
    port: number;
    codePromise: Promise<string>;
  }> {
    return new Promise((resolveStart, rejectStart) => {
      let resolveCode: (code: string) => void;
      let rejectCode: (err: Error) => void;
      const codePromise = new Promise<string>((res, rej) => {
        resolveCode = res;
        rejectCode = rej;
      });

      const server = createServer((req, res) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const error = url.searchParams.get("error_description") ?? url.searchParams.get("error");
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          "<html><body style='font-family:sans-serif'><h2>TenantDeck</h2><p>Sign-in complete. You can close this tab and return to the app.</p></body></html>",
        );
        if (error) {
          rejectCode(new Error(error));
        } else if (code && state === expectedState) {
          resolveCode(code);
        }
      });

      const tryPort = (idx: number): void => {
        if (idx >= LOOPBACK_PORTS.length) {
          rejectStart(new Error("No loopback port available for sign-in redirect"));
          return;
        }
        const port = LOOPBACK_PORTS[idx];
        server.once("error", () => tryPort(idx + 1));
        server.listen(port, "127.0.0.1", () => {
          server.removeAllListeners("error");
          // Abort sign-in if the browser never comes back.
          const timeout = setTimeout(() => rejectCode(new Error("Sign-in timed out")), 5 * 60_000);
          codePromise.finally(() => clearTimeout(timeout)).catch(() => undefined);
          resolveStart({ server, port, codePromise });
        });
      };
      tryPort(0);
    });
  }
}

export const authService = new AuthService();
