import { BrowserWindow, dialog, ipcMain } from "electron";
import { writeFileSync } from "node:fs";
import type { IpcChannel, IpcContract, IpcEventChannel, IpcEvents } from "@shared/ipc";
import { authService } from "../auth/authService";
import { discoverGdapTenants } from "../graph/gdapDiscovery";
import {
  commitTenants,
  listTenants,
  purgeTenantData,
  removeTenants,
  updateTenants,
} from "../db/tenantRepo";
import {
  estateSummary,
  listDomains,
  listGroups,
  listLicenses,
  listMailboxes,
  listUsers,
  search,
} from "../db/dataRepo";
import { getSettings, setSettings } from "../db/settingsRepo";
import { syncEngine } from "../sync/syncEngine";
import {
  addCustomCheck,
  listChecks,
  listFindings,
  listScores,
  runAudit,
  setCheckEnabled,
} from "../audit/auditEngine";
import {
  deploy,
  dryRun,
  listAuditLog,
  listDeployments,
  listInventory,
  rollback,
  stageDeployment,
  validateRows,
} from "../exo/connectorService";
import { listTemplates, saveTemplate } from "../exo/templates";
import { updaterService } from "../updater";

type Handler<C extends IpcChannel> = (
  req: IpcContract[C]["req"],
) => Promise<IpcContract[C]["res"]> | IpcContract[C]["res"];

function handle<C extends IpcChannel>(channel: C, handler: Handler<C>): void {
  ipcMain.handle(channel, (_event, req) => handler(req));
}

export function broadcast<E extends IpcEventChannel>(channel: E, payload: IpcEvents[E]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload);
  }
}

export function registerIpcHandlers(): void {
  // Auth
  handle("auth:status", () => authService.getStatus());
  handle("auth:signIn", () => authService.signIn());
  handle("auth:signOut", () => authService.signOut());

  // Tenant registry
  handle("registry:discover", () => discoverGdapTenants());
  handle("registry:list", () => listTenants());
  handle("registry:commit", ({ tenants }) =>
    commitTenants(tenants, getSettings().defaultSyncSchedule),
  );
  handle("registry:update", ({ tenantIds, edit }) => updateTenants(tenantIds, edit));
  handle("registry:remove", ({ tenantIds }) => removeTenants(tenantIds));
  handle("registry:purgeData", ({ tenantIds }) => purgeTenantData(tenantIds));

  // Sync
  handle("sync:run", ({ tenantIds }) => {
    // Fire and forget; progress flows through event:syncProgress.
    void syncEngine.run(tenantIds);
  });
  handle("sync:status", () => syncEngine.getStatuses());

  // Directory data
  handle("data:users", ({ tenantIds }) => listUsers(tenantIds));
  handle("data:licenses", ({ tenantIds }) => listLicenses(tenantIds));
  handle("data:groups", ({ tenantIds }) => listGroups(tenantIds));
  handle("data:domains", ({ tenantIds }) => listDomains(tenantIds));
  handle("data:mailboxes", ({ tenantIds }) => listMailboxes(tenantIds));
  handle("data:summary", () => estateSummary());
  handle("data:search", ({ query }) => search(query));

  // Audit engine
  handle("audit:checks", () => listChecks());
  handle("audit:setCheckEnabled", ({ checkId, enabled }) => setCheckEnabled(checkId, enabled));
  handle("audit:addCustomCheck", ({ check }) => addCustomCheck(check));
  handle("audit:run", ({ tenantIds }) => runAudit(tenantIds));
  handle("audit:findings", (req) => listFindings(req));
  handle("audit:scores", () => listScores());

  // Connector deployment
  handle("connectors:templates", () => listTemplates());
  handle("connectors:saveTemplate", ({ template }) => saveTemplate(template));
  handle("connectors:stage", ({ templateId, tenantIds }) => stageDeployment(templateId, tenantIds));
  handle("connectors:validate", ({ rows }) => validateRows(rows));
  handle("connectors:dryRun", ({ rows }) => dryRun(rows));
  handle("connectors:deploy", (req) => deploy(req));
  handle("connectors:rollback", ({ deploymentId, tenantId }) => rollback(deploymentId, tenantId));
  handle("connectors:inventory", () => listInventory());
  handle("connectors:deployments", () => listDeployments());
  handle("connectors:auditLog", ({ tenantId }) => listAuditLog(tenantId));

  // Settings
  handle("settings:get", () => getSettings());
  handle("settings:set", ({ settings }) => {
    const merged = setSettings(settings);
    if (settings.clientId) authService.resetClient();
    return merged;
  });

  // Auto-update
  handle("update:check", () => updaterService.check());
  handle("update:install", () => updaterService.install());

  // Export
  handle("export:csv", async ({ filename, headers, rows }) => {
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showSaveDialog(win ?? BrowserWindow.getAllWindows()[0], {
      defaultPath: filename,
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (result.canceled || !result.filePath) return { savedTo: null };
    const esc = (v: string | number | boolean | null): string => {
      const s = v === null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
    writeFileSync(result.filePath, csv, "utf8");
    return { savedTo: result.filePath };
  });

  // Push sync progress, auth changes and update status to all windows.
  syncEngine.onProgress((e) => broadcast("event:syncProgress", e));
  authService.onChange((s) => broadcast("event:authChanged", s));
  updaterService.onChange((s) => broadcast("event:updateStatus", s));
}
