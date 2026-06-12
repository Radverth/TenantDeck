import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import { authService } from "../auth/authService";

export interface PsResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/**
 * Bundled PowerShell 7 + ExchangeOnlineManagement engine.
 *
 * Connector cmdlets have no Graph surface; EXO is driven through
 * `Connect-ExchangeOnline -DelegatedOrganization <customer>` under the
 * signed-in engineer's identity — the exact GDAP delegated mechanism
 * Partner Center-era admin uses. Zero footprint in customer tenants.
 *
 * v1 ships against a system pwsh; the packaged build adds a managed runtime
 * under resources/pwsh (looked for first). Session pooling: each invocation
 * is a fresh pwsh today; pooled long-lived sessions per tenant are the
 * Phase 4 optimisation and slot in behind this same interface.
 */
export class PsEngine {
  private pwshPath: string | null | undefined;

  /** Bundled runtime first, then PATH. */
  resolvePwsh(): string | null {
    if (this.pwshPath !== undefined) return this.pwshPath;
    const bundled = join(
      process.resourcesPath ?? app.getAppPath(),
      "pwsh",
      process.platform === "win32" ? "pwsh.exe" : "pwsh",
    );
    if (existsSync(bundled)) {
      this.pwshPath = bundled;
      return bundled;
    }
    this.pwshPath = "pwsh"; // rely on PATH; surfaced as an error on first run if absent
    return this.pwshPath;
  }

  isAvailable(): boolean {
    return this.resolvePwsh() !== null;
  }

  /**
   * Run a script inside a delegated EXO session for one customer tenant.
   * The script body runs after Connect-ExchangeOnline succeeds; output is
   * expected as JSON on stdout (use ConvertTo-Json in the script).
   */
  async runDelegated(tenantDefaultDomain: string, scriptBody: string): Promise<PsResult> {
    const status = await authService.getStatus();
    if (!status.signedIn || !status.account) {
      return { ok: false, stdout: "", stderr: "Not signed in" };
    }
    const script = `
$ErrorActionPreference = 'Stop'
try {
  Import-Module ExchangeOnlineManagement
  Connect-ExchangeOnline -UserPrincipalName '${status.account.username.replace(/'/g, "''")}' -DelegatedOrganization '${tenantDefaultDomain.replace(/'/g, "''")}' -ShowBanner:$false
  ${scriptBody}
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
} finally {
  Disconnect-ExchangeOnline -Confirm:$false -ErrorAction SilentlyContinue | Out-Null
}
`;
    return this.run(script);
  }

  private run(script: string): Promise<PsResult> {
    const pwsh = this.resolvePwsh();
    if (!pwsh) {
      return Promise.resolve({
        ok: false,
        stdout: "",
        stderr: "PowerShell 7 (pwsh) not found — bundled runtime missing and not on PATH",
      });
    }
    return new Promise((resolve) => {
      const child = spawn(pwsh, ["-NoProfile", "-NonInteractive", "-Command", script], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("error", (e) => resolve({ ok: false, stdout, stderr: String(e) }));
      child.on("close", (code) => resolve({ ok: code === 0, stdout, stderr }));
    });
  }
}

export const psEngine = new PsEngine();
