import { randomUUID } from "node:crypto";
import { getDb } from "../db/database";
import { getTenant, listTenants } from "../db/tenantRepo";
import { getSettings } from "../db/settingsRepo";
import { authService } from "../auth/authService";
import { hasConnectorWriteRole } from "../graph/roles";
import { psEngine } from "./psEngine";
import { listTemplates } from "./templates";
import {
  buildInboundConnector,
  buildOutboundConnector,
  buildRemoval,
  buildTransportRule,
  READ_STATE_SCRIPT,
} from "./psBuilder";
import type {
  AuditLogEntry,
  ConnectorInventoryRow,
  ConnectorTemplate,
  DeploymentItemStatus,
  DeploymentRecord,
  DryRunDiff,
  InboundConnectorSpec,
  OutboundConnectorSpec,
  StagedDeploymentRow,
  StagingValidation,
  TransportRuleSpec,
} from "@shared/types";

const IP_OR_CIDR =
  /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$|^(\d{1,3}\.){3}\d{1,3}-(\d{1,3}\.){3}\d{1,3}$/;

// ---------------------------------------------------------------------------
// Stage: template × tenants → one row per tenant per connector object
// ---------------------------------------------------------------------------

export function stageDeployment(templateId: string, tenantIds: string[]): StagedDeploymentRow[] {
  const template = listTemplates().find((t) => t.id === templateId);
  if (!template) throw new Error(`Template ${templateId} not found`);

  const rows: StagedDeploymentRow[] = [];
  for (const tenantId of tenantIds) {
    const tenant = getTenant(tenantId);
    if (!tenant) continue;

    const resolve = (value: string): string[] => resolvePlaceholder(value, template, tenant.defaultDomain);
    const resolveOne = (value: string | null): string | null =>
      value === null ? null : (resolve(value)[0] ?? value);

    for (const inbound of template.inbound) {
      rows.push(makeRow(tenantId, tenant.displayName, "inboundConnector", {
        ...inbound,
        senderDomains: inbound.senderDomains.flatMap(resolve),
        senderIPAddresses: inbound.senderIPAddresses.flatMap(resolve),
        tlsSenderCertificateName: resolveOne(inbound.tlsSenderCertificateName),
        enhancedFiltering: inbound.enhancedFiltering
          ? { ...inbound.enhancedFiltering, efSkipIPs: inbound.enhancedFiltering.efSkipIPs.flatMap(resolve) }
          : null,
      }));
    }
    for (const outbound of template.outbound) {
      rows.push(makeRow(tenantId, tenant.displayName, "outboundConnector", {
        ...outbound,
        smartHosts: outbound.smartHosts.flatMap(resolve),
        recipientDomains: outbound.recipientDomains.flatMap(resolve),
        tlsDomain: resolveOne(outbound.tlsDomain),
      }));
    }
    for (const rule of template.transportRules) {
      rows.push(makeRow(tenantId, tenant.displayName, "transportRule", {
        ...rule,
        fromIPs: rule.fromIPs.flatMap(resolve),
      }));
    }
  }
  return validateRows(rows);
}

function makeRow(
  tenantId: string,
  tenantName: string,
  kind: StagedDeploymentRow["kind"],
  spec: StagedDeploymentRow["spec"],
): StagedDeploymentRow {
  return {
    rowId: randomUUID(),
    tenantId,
    tenantName,
    kind,
    spec,
    validation: { ok: true, errors: [], warnings: [] },
    selected: true,
  };
}

/** {tenant.defaultDomain} and {data.key} placeholders. data.* expands to the whole list. */
function resolvePlaceholder(
  value: string,
  template: ConnectorTemplate,
  defaultDomain: string,
): string[] {
  if (value === "{tenant.defaultDomain}") return [defaultDomain];
  const dataMatch = /^\{data\.(\w+)\}$/.exec(value);
  if (dataMatch) return template.data[dataMatch[1]] ?? [];
  return [value.replaceAll("{tenant.defaultDomain}", defaultDomain)];
}

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------

export function validateRows(rows: StagedDeploymentRow[]): StagedDeploymentRow[] {
  const inventory = listInventory();
  return rows.map((row) => {
    const v: StagingValidation = { ok: true, errors: [], warnings: [] };
    const tenant = getTenant(row.tenantId);

    if (!tenant) {
      v.errors.push("Tenant not in registry");
    } else {
      if (!hasConnectorWriteRole(tenant.gdapRoles)) {
        v.errors.push("GDAP relationship lacks Exchange Administrator role");
      }
      if (!tenant.enabledModules.includes("exchange")) {
        v.warnings.push("Exchange module disabled for this tenant");
      }
    }

    if (row.kind === "inboundConnector") {
      const spec = row.spec as InboundConnectorSpec;
      if (!spec.name.trim()) v.errors.push("Name is required");
      for (const ip of spec.senderIPAddresses) {
        if (!IP_OR_CIDR.test(ip)) v.errors.push(`Invalid IP/CIDR: ${ip}`);
      }
      if (spec.restrictDomainsToIPAddresses && spec.senderIPAddresses.length === 0) {
        v.errors.push("RestrictDomainsToIPAddresses requires at least one sender IP");
      }
      if (spec.restrictDomainsToCertificate && !spec.tlsSenderCertificateName) {
        v.errors.push("RestrictDomainsToCertificate requires a TLS certificate name");
      }
      if (spec.enhancedFiltering) {
        for (const ip of spec.enhancedFiltering.efSkipIPs) {
          if (!IP_OR_CIDR.test(ip)) v.errors.push(`Invalid EF skip IP: ${ip}`);
        }
      }
      const clash = inventory.find(
        (c) => c.tenantId === row.tenantId && c.direction === "inbound" && c.name === spec.name && c.templateId === null,
      );
      if (clash) v.warnings.push(`Connector '${spec.name}' already exists (created outside TenantDeck) — deploy will update it`);
      const otherGateway = inventory.find(
        (c) => c.tenantId === row.tenantId && c.direction === "inbound" && c.enabled && c.name !== spec.name && c.connectorType === "Partner",
      );
      if (otherGateway && spec.connectorType === "Partner") {
        v.warnings.push(`Tenant already routes via '${otherGateway.name}'`);
      }
    }

    if (row.kind === "outboundConnector") {
      const spec = row.spec as OutboundConnectorSpec;
      if (!spec.name.trim()) v.errors.push("Name is required");
      if (!spec.useMXRecord && spec.smartHosts.length === 0) {
        v.errors.push("Outbound connector needs smart hosts or UseMXRecord");
      }
      if (!spec.allAcceptedDomains && spec.recipientDomains.length === 0 && !spec.isTransportRuleScoped) {
        v.errors.push("Recipient scoping required (domains, all accepted, or rule-scoped)");
      }
    }

    if (row.kind === "transportRule") {
      const spec = row.spec as TransportRuleSpec;
      if (!spec.name.trim()) v.errors.push("Name is required");
      for (const ip of spec.fromIPs) {
        if (!IP_OR_CIDR.test(ip)) v.errors.push(`Invalid IP/CIDR: ${ip}`);
      }
      if (spec.kind === "forceRoute" && !spec.routeViaConnector) {
        v.errors.push("Force-route rule requires a target outbound connector");
      }
    }

    v.ok = v.errors.length === 0;
    return { ...row, validation: v };
  });
}

// ---------------------------------------------------------------------------
// Dry run: live read-only diff + PowerShell preview
// ---------------------------------------------------------------------------

export async function dryRun(rows: StagedDeploymentRow[]): Promise<DryRunDiff[]> {
  const diffs: DryRunDiff[] = [];
  const liveByTenant = new Map<string, LiveState | null>();

  for (const row of rows.filter((r) => r.selected)) {
    if (!liveByTenant.has(row.tenantId)) {
      liveByTenant.set(row.tenantId, await readLiveState(row.tenantId));
    }
    const live = liveByTenant.get(row.tenantId) ?? null;
    const existing = findExisting(live, row);
    const action = existing === undefined ? "create" : "update";
    const fieldChanges =
      existing === undefined
        ? Object.entries(flatten(row.spec)).map(([field, to]) => ({ field, from: null, to }))
        : diffSpecs(existing, row.spec);

    diffs.push({
      rowId: row.rowId,
      tenantId: row.tenantId,
      action: action === "update" && fieldChanges.length === 0 ? "noop" : action,
      fieldChanges,
      powershellPreview: buildPreview(row, action === "update"),
    });
  }
  return diffs;
}

interface LiveState {
  inbound: Record<string, unknown>[];
  outbound: Record<string, unknown>[];
  rules: Record<string, unknown>[];
}

async function readLiveState(tenantId: string): Promise<LiveState | null> {
  const tenant = getTenant(tenantId);
  if (!tenant) return null;
  const result = await psEngine.runDelegated(tenant.defaultDomain, READ_STATE_SCRIPT);
  if (!result.ok) return null; // fall back to "create" assumption; deploy re-checks
  try {
    return JSON.parse(result.stdout) as LiveState;
  } catch {
    return null;
  }
}

function findExisting(live: LiveState | null, row: StagedDeploymentRow): Record<string, unknown> | undefined {
  if (!live) return undefined;
  const name = (row.spec as { name: string }).name;
  const pool =
    row.kind === "inboundConnector" ? live.inbound : row.kind === "outboundConnector" ? live.outbound : live.rules;
  return pool.find((c) => c.Name === name);
}

function flatten(obj: unknown, prefix = ""): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        Object.assign(out, flatten(v, `${prefix}${k}.`));
      } else {
        out[`${prefix}${k}`] = v;
      }
    }
  }
  return out;
}

/** Compare staged spec fields against live cmdlet output (PascalCase). */
function diffSpecs(
  live: Record<string, unknown>,
  spec: StagedDeploymentRow["spec"],
): { field: string; from: unknown; to: unknown }[] {
  const changes: { field: string; from: unknown; to: unknown }[] = [];
  for (const [field, to] of Object.entries(flatten(spec))) {
    const liveKey = field.includes(".")
      ? field.split(".").pop()!
      : field.charAt(0).toUpperCase() + field.slice(1);
    const from = live[liveKey] ?? live[`EF${liveKey.replace(/^Ef/, "")}`] ?? null;
    const norm = (x: unknown): string => JSON.stringify(Array.isArray(x) ? [...x].sort() : x ?? null);
    if (from !== null && norm(from) !== norm(to)) {
      changes.push({ field, from, to });
    }
  }
  return changes;
}

function buildPreview(row: StagedDeploymentRow, update: boolean): string {
  switch (row.kind) {
    case "inboundConnector":
      return buildInboundConnector(row.spec as InboundConnectorSpec, update);
    case "outboundConnector":
      return buildOutboundConnector(row.spec as OutboundConnectorSpec, update);
    case "transportRule":
      return buildTransportRule(row.spec as TransportRuleSpec, update);
  }
}

// ---------------------------------------------------------------------------
// Deploy: snapshot → execute per tenant → verify; failures isolated per tenant
// ---------------------------------------------------------------------------

export async function deploy(opts: {
  rows: StagedDeploymentRow[];
  templateId: string;
  stageDisabled: boolean;
  efTestMode: boolean;
  confirmedTenantCount: number | null;
}): Promise<DeploymentRecord> {
  const rows = validateRows(opts.rows.filter((r) => r.selected));
  const invalid = rows.filter((r) => !r.validation.ok);
  if (invalid.length > 0) {
    throw new Error(
      `${invalid.length} row(s) failed validation: ${invalid[0].validation.errors[0]}`,
    );
  }

  const tenantIds = [...new Set(rows.map((r) => r.tenantId))];
  const threshold = getSettings().largeBatchConfirmThreshold;
  if (tenantIds.length > threshold && opts.confirmedTenantCount !== tenantIds.length) {
    throw new Error(
      `Bulk deploy to ${tenantIds.length} tenants requires typed confirmation of the tenant count`,
    );
  }

  const template = listTemplates().find((t) => t.id === opts.templateId);
  const status = await authService.getStatus();
  const who = status.account?.username ?? "unknown";
  const db = getDb();
  const startedAt = new Date().toISOString();
  const deploymentId = Number(
    db.prepare(
      "INSERT INTO deployments (template_id, template_version, started_at, started_by) VALUES (?, ?, ?, ?)",
    ).run(opts.templateId, template?.version ?? 0, startedAt, who).lastInsertRowid,
  );

  const insItem = db.prepare(
    "INSERT INTO deployment_items (deployment_id, row_id, tenant_id, kind, spec, state) VALUES (?, ?, ?, ?, ?, 'pending')",
  );
  for (const row of rows) {
    insItem.run(deploymentId, row.rowId, row.tenantId, row.kind, JSON.stringify(row.spec));
  }

  const items: DeploymentItemStatus[] = [];
  for (const tenantId of tenantIds) {
    const tenantRows = rows.map((r) => applyStagingOverrides(r, opts)).filter((r) => r.tenantId === tenantId);
    const results = await deployTenant(tenantId, tenantRows, deploymentId, who);
    items.push(...results);
  }

  const finishedAt = new Date().toISOString();
  db.prepare("UPDATE deployments SET finished_at = ? WHERE id = ?").run(finishedAt, deploymentId);

  return {
    id: deploymentId,
    templateId: opts.templateId,
    templateVersion: template?.version ?? 0,
    startedAt,
    finishedAt,
    startedBy: who,
    items,
  };
}

function applyStagingOverrides(
  row: StagedDeploymentRow,
  opts: { stageDisabled: boolean; efTestMode: boolean },
): StagedDeploymentRow {
  if (row.kind === "transportRule") return row;
  const spec = { ...(row.spec as InboundConnectorSpec | OutboundConnectorSpec) };
  if (opts.stageDisabled) spec.enabled = false;
  if (opts.efTestMode && "enhancedFiltering" in spec && spec.enhancedFiltering) {
    spec.enhancedFiltering = { ...spec.enhancedFiltering, efTestMode: true };
  }
  return { ...row, spec };
}

async function deployTenant(
  tenantId: string,
  rows: StagedDeploymentRow[],
  deploymentId: number,
  who: string,
): Promise<DeploymentItemStatus[]> {
  const db = getDb();
  const tenant = getTenant(tenantId);
  const setState = (rowId: string, state: string, error: string | null): void => {
    db.prepare(
      "UPDATE deployment_items SET state = ?, error = ? WHERE deployment_id = ? AND row_id = ?",
    ).run(state, error, deploymentId, rowId);
  };

  if (!tenant) {
    return rows.map((r) => {
      setState(r.rowId, "failed", "Tenant not found");
      return { rowId: r.rowId, tenantId, state: "failed" as const, error: "Tenant not found" };
    });
  }

  // Automatic pre-change snapshot of the tenant's full connector + rule state.
  const live = await readLiveState(tenantId);
  db.prepare(
    "INSERT INTO snapshots (tenant_id, taken_at, kind, payload, deployment_id) VALUES (?, ?, 'connector_state', ?, ?)",
  ).run(tenantId, new Date().toISOString(), JSON.stringify(live ?? {}), deploymentId);

  const results: DeploymentItemStatus[] = [];
  for (const row of rows) {
    const existing = findExisting(live, row);
    const script = buildPreview(row, existing !== undefined);
    const result = await psEngine.runDelegated(tenant.defaultDomain, script);

    logCmdlet({
      who,
      tenantId,
      cmdlet: script.split(" ")[0],
      parameters: row.spec as unknown as Record<string, unknown>,
      deploymentId,
      outcome: result.ok ? "ok" : "error",
      detail: result.ok ? null : result.stderr,
    });

    setState(row.rowId, result.ok ? "succeeded" : "failed", result.ok ? null : result.stderr);
    results.push({
      rowId: row.rowId,
      tenantId,
      state: result.ok ? "succeeded" : "failed",
      error: result.ok ? null : result.stderr,
    });
  }

  // Re-read state as the new baseline for drift detection.
  const after = await readLiveState(tenantId);
  if (after) cacheInventory(tenantId, after, rows[0] ? deploymentTemplateId(deploymentId) : null);

  return results;
}

function deploymentTemplateId(deploymentId: number): string | null {
  const row = getDb().prepare("SELECT template_id FROM deployments WHERE id = ?").get(deploymentId) as
    | { template_id: string }
    | undefined;
  return row?.template_id ?? null;
}

// ---------------------------------------------------------------------------
// Rollback: restore from the pre-change snapshot, per tenant, one click
// ---------------------------------------------------------------------------

export async function rollback(deploymentId: number, tenantId: string): Promise<void> {
  const db = getDb();
  const tenant = getTenant(tenantId);
  if (!tenant) throw new Error("Tenant not found");

  const snapshot = db
    .prepare(
      "SELECT payload FROM snapshots WHERE deployment_id = ? AND tenant_id = ? AND kind = 'connector_state' ORDER BY id DESC LIMIT 1",
    )
    .get(deploymentId, tenantId) as { payload: string } | undefined;
  if (!snapshot) throw new Error("No pre-change snapshot found for this deployment/tenant");

  const before = JSON.parse(snapshot.payload) as LiveState;
  const items = db
    .prepare("SELECT row_id, kind, spec FROM deployment_items WHERE deployment_id = ? AND tenant_id = ? AND state = 'succeeded'")
    .all(deploymentId, tenantId) as { row_id: string; kind: string; spec: string }[];

  const status = await authService.getStatus();
  const who = status.account?.username ?? "unknown";

  for (const item of items) {
    const spec = JSON.parse(item.spec) as { name: string };
    const pool =
      item.kind === "inboundConnector"
        ? before.inbound
        : item.kind === "outboundConnector"
          ? before.outbound
          : before.rules;
    const existedBefore = pool?.find((c) => c.Name === spec.name) !== undefined;

    // Objects created by the deployment are removed; objects that existed
    // before are restored to their snapshotted configuration.
    let script: string;
    if (!existedBefore) {
      script = buildRemoval(item.kind, spec.name);
    } else {
      const snap = pool.find((c) => c.Name === spec.name)!;
      script = restoreScript(item.kind, snap);
    }
    const result = await psEngine.runDelegated(tenant.defaultDomain, script);
    logCmdlet({
      who,
      tenantId,
      cmdlet: `rollback:${script.split(" ")[0]}`,
      parameters: { name: spec.name },
      deploymentId,
      outcome: result.ok ? "ok" : "error",
      detail: result.ok ? null : result.stderr,
    });
    if (result.ok) {
      db.prepare(
        "UPDATE deployment_items SET state = 'rolledBack' WHERE deployment_id = ? AND row_id = ?",
      ).run(deploymentId, item.row_id);
    } else {
      throw new Error(`Rollback failed for ${spec.name}: ${result.stderr}`);
    }
  }
}

function restoreScript(kind: string, snap: Record<string, unknown>): string {
  const q = (s: string): string => `'${s.replace(/'/g, "''")}'`;
  const name = String(snap.Name);
  if (kind === "inboundConnector") {
    return `Set-InboundConnector -Identity ${q(name)} -Enabled $${snap.Enabled === true} -SenderIPAddresses ${jsonArr(snap.SenderIPAddresses)} -RequireTls $${snap.RequireTls === true}`;
  }
  if (kind === "outboundConnector") {
    return `Set-OutboundConnector -Identity ${q(name)} -Enabled $${snap.Enabled === true} -SmartHosts ${jsonArr(snap.SmartHosts)}`;
  }
  return `Set-TransportRule -Identity ${q(name)} -Priority ${Number(snap.Priority ?? 0)}`;
}

function jsonArr(v: unknown): string {
  const xs = Array.isArray(v) ? v.map(String) : [];
  return xs.length > 0 ? xs.map((s) => `'${s.replace(/'/g, "''")}'`).join(",") : "$null";
}

// ---------------------------------------------------------------------------
// Inventory, deployments, audit log
// ---------------------------------------------------------------------------

function cacheInventory(tenantId: string, state: LiveState, templateId: string | null): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM exo_connectors WHERE tenant_id = ?").run(tenantId);
    const ins = db.prepare(
      "INSERT INTO exo_connectors (tenant_id, direction, name, enabled, connector_type, raw, template_id, last_changed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const c of state.inbound ?? []) {
      ins.run(tenantId, "inbound", String(c.Name), c.Enabled ? 1 : 0, c.ConnectorType ? String(c.ConnectorType) : null, JSON.stringify(c), templateId, c.WhenChanged ? String(c.WhenChanged) : null);
    }
    for (const c of state.outbound ?? []) {
      ins.run(tenantId, "outbound", String(c.Name), c.Enabled ? 1 : 0, null, JSON.stringify(c), templateId, c.WhenChanged ? String(c.WhenChanged) : null);
    }
    db.prepare("DELETE FROM exo_transport_rules WHERE tenant_id = ?").run(tenantId);
    const insRule = db.prepare(
      "INSERT INTO exo_transport_rules (tenant_id, name, enabled, priority, raw, template_id) VALUES (?, ?, ?, ?, ?, ?)",
    );
    for (const r of state.rules ?? []) {
      insRule.run(tenantId, String(r.Name), r.State === "Enabled" ? 1 : 0, r.Priority === undefined ? null : Number(r.Priority), JSON.stringify(r), templateId);
    }
  });
  tx();
}

export function listInventory(): ConnectorInventoryRow[] {
  const names = new Map(listTenants().map((t) => [t.tenantId, t.displayName]));
  const rows = getDb().prepare("SELECT * FROM exo_connectors").all() as any[];
  return rows.map((r) => ({
    tenantId: r.tenant_id,
    tenantName: names.get(r.tenant_id) ?? r.tenant_id,
    direction: r.direction,
    name: r.name,
    enabled: !!r.enabled,
    connectorType: r.connector_type,
    lastChangedAt: r.last_changed_at,
    templateId: r.template_id,
    drift: !!r.drift,
  }));
}

export function listDeployments(): DeploymentRecord[] {
  const db = getDb();
  const deployments = db.prepare("SELECT * FROM deployments ORDER BY id DESC LIMIT 100").all() as any[];
  return deployments.map((d) => {
    const items = db
      .prepare("SELECT row_id, tenant_id, state, error FROM deployment_items WHERE deployment_id = ?")
      .all(d.id) as any[];
    return {
      id: d.id,
      templateId: d.template_id,
      templateVersion: d.template_version,
      startedAt: d.started_at,
      finishedAt: d.finished_at,
      startedBy: d.started_by,
      items: items.map((i) => ({
        rowId: i.row_id,
        tenantId: i.tenant_id,
        state: i.state,
        error: i.error,
      })),
    };
  });
}

function logCmdlet(entry: {
  who: string;
  tenantId: string;
  cmdlet: string;
  parameters: Record<string, unknown>;
  deploymentId: number | null;
  outcome: "ok" | "error";
  detail: string | null;
}): void {
  getDb()
    .prepare(
      "INSERT INTO audit_log (at, who, tenant_id, cmdlet, parameters, deployment_id, outcome, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      new Date().toISOString(),
      entry.who,
      entry.tenantId,
      entry.cmdlet,
      JSON.stringify(entry.parameters),
      entry.deploymentId,
      entry.outcome,
      entry.detail,
    );
}

export function listAuditLog(tenantId?: string): AuditLogEntry[] {
  const db = getDb();
  const rows = (
    tenantId
      ? db.prepare("SELECT * FROM audit_log WHERE tenant_id = ? ORDER BY id DESC LIMIT 500").all(tenantId)
      : db.prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT 500").all()
  ) as any[];
  return rows.map((r) => ({
    id: r.id,
    at: r.at,
    who: r.who,
    tenantId: r.tenant_id,
    cmdlet: r.cmdlet,
    parameters: JSON.parse(r.parameters),
    deploymentId: r.deployment_id,
    outcome: r.outcome,
    detail: r.detail,
  }));
}
