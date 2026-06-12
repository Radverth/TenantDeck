import { getDb } from "../db/database";
import { listTenants } from "../db/tenantRepo";
import { BUILTIN_CHECKS, builtinDefinitions, type CheckResult } from "./baseline";
import { evaluateCustomCheck } from "./customChecks";
import type {
  AuditFinding,
  AuditRunSummary,
  CheckDefinition,
  CheckSeverity,
  TenantScore,
} from "@shared/types";

const SEVERITY_WEIGHT: Record<CheckSeverity, number> = {
  low: 1,
  medium: 2,
  high: 4,
  critical: 8,
};

/** Seed builtin checks into the DB on first run; preserve enabled toggles after. */
export function ensureChecksSeeded(): void {
  const db = getDb();
  const ins = db.prepare(
    "INSERT INTO audit_checks (id, definition, enabled, builtin) VALUES (?, ?, 1, 1) ON CONFLICT(id) DO UPDATE SET definition = excluded.definition",
  );
  const tx = db.transaction(() => {
    for (const def of builtinDefinitions()) {
      ins.run(def.id, JSON.stringify(def));
    }
  });
  tx();
}

export function listChecks(): CheckDefinition[] {
  const rows = getDb().prepare("SELECT id, definition, enabled, builtin FROM audit_checks").all() as {
    id: string;
    definition: string;
    enabled: number;
    builtin: number;
  }[];
  return rows.map((r) => ({
    ...(JSON.parse(r.definition) as CheckDefinition),
    enabled: !!r.enabled,
    builtin: !!r.builtin,
  }));
}

export function setCheckEnabled(checkId: string, enabled: boolean): void {
  getDb().prepare("UPDATE audit_checks SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, checkId);
}

export function addCustomCheck(check: CheckDefinition): void {
  if (!check.query) throw new Error("Custom checks require a query definition");
  getDb()
    .prepare(
      "INSERT INTO audit_checks (id, definition, enabled, builtin) VALUES (?, ?, 1, 0) ON CONFLICT(id) DO UPDATE SET definition = excluded.definition, builtin = 0",
    )
    .run(check.id, JSON.stringify({ ...check, builtin: false }));
}

/** Evaluate every enabled check against every (selected) tenant; store findings and scores. */
export function runAudit(tenantIds: string[] | null): AuditRunSummary {
  const db = getDb();
  const startedAt = new Date().toISOString();
  const runId = Number(
    db.prepare("INSERT INTO audit_runs (started_at) VALUES (?)").run(startedAt).lastInsertRowid,
  );

  const tenants = listTenants().filter(
    (t) => t.status !== "orphaned" && (tenantIds === null || tenantIds.includes(t.tenantId)),
  );
  const checks = listChecks().filter((c) => c.enabled);
  const builtinById = new Map(BUILTIN_CHECKS.map((c) => [c.id, c]));

  const insFinding = db.prepare(
    "INSERT INTO audit_findings (run_id, tenant_id, check_id, outcome, detail, evidence, observed_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const insScore = db.prepare(
    "INSERT INTO tenant_scores (tenant_id, run_id, score, pass_count, warn_count, fail_count, not_assessable_count, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );

  let findingCount = 0;
  const now = new Date().toISOString();

  for (const tenant of tenants) {
    let earned = 0;
    let possible = 0;
    const counts = { pass: 0, warn: 0, fail: 0, not_assessable: 0 };

    for (const check of checks) {
      let result: CheckResult;
      try {
        const builtin = builtinById.get(check.id);
        result = builtin
          ? builtin.evaluate(tenant.tenantId)
          : evaluateCustomCheck(check, tenant.tenantId);
      } catch (e) {
        result = {
          outcome: "not_assessable",
          detail: `Check error: ${e instanceof Error ? e.message : String(e)}`,
          evidence: [],
        };
      }

      counts[result.outcome]++;
      if (result.outcome !== "not_assessable") {
        const weight = SEVERITY_WEIGHT[check.severity];
        possible += weight;
        if (result.outcome === "pass") earned += weight;
        else if (result.outcome === "warn") earned += weight / 2;
      }

      insFinding.run(
        runId,
        tenant.tenantId,
        check.id,
        result.outcome,
        result.detail,
        JSON.stringify(result.evidence),
        now,
      );
      findingCount++;
    }

    const score = possible > 0 ? Math.round((earned / possible) * 100) : 0;
    insScore.run(
      tenant.tenantId,
      runId,
      score,
      counts.pass,
      counts.warn,
      counts.fail,
      counts.not_assessable,
      now,
    );
  }

  const finishedAt = new Date().toISOString();
  db.prepare(
    "UPDATE audit_runs SET finished_at = ?, tenant_count = ?, finding_count = ? WHERE id = ?",
  ).run(finishedAt, tenants.length, findingCount, runId);

  return { runId, startedAt, finishedAt, tenantCount: tenants.length, findingCount };
}

export function listFindings(opts: { tenantIds?: string[]; runId?: number }): AuditFinding[] {
  const db = getDb();
  const runId =
    opts.runId ??
    (db.prepare("SELECT MAX(id) id FROM audit_runs WHERE finished_at IS NOT NULL").get() as {
      id: number | null;
    }).id;
  if (runId === null || runId === undefined) return [];

  const names = new Map(listTenants().map((t) => [t.tenantId, t.displayName]));
  const checkById = new Map(listChecks().map((c) => [c.id, c]));

  let sql = "SELECT * FROM audit_findings WHERE run_id = ?";
  const params: (number | string)[] = [runId];
  if (opts.tenantIds && opts.tenantIds.length > 0) {
    sql += ` AND tenant_id IN (${opts.tenantIds.map(() => "?").join(",")})`;
    params.push(...opts.tenantIds);
  }

  const rows = db.prepare(sql).all(...params) as any[];
  return rows.map((r) => {
    const check = checkById.get(r.check_id);
    return {
      id: r.id,
      runId: r.run_id,
      tenantId: r.tenant_id,
      tenantName: names.get(r.tenant_id) ?? r.tenant_id,
      checkId: r.check_id,
      checkTitle: check?.title ?? r.check_id,
      category: check?.category ?? "identity",
      severity: check?.severity ?? "low",
      outcome: r.outcome,
      detail: r.detail,
      evidence: JSON.parse(r.evidence),
      remediation: check?.remediation ?? "",
      observedAt: r.observed_at,
    };
  });
}

/** League table: latest score per tenant with movement since the previous run. */
export function listScores(): TenantScore[] {
  const db = getDb();
  const names = new Map(listTenants().map((t) => [t.tenantId, t.displayName]));
  const rows = db
    .prepare(
      `SELECT tenant_id, run_id, score, pass_count, warn_count, fail_count, not_assessable_count, at
       FROM tenant_scores ORDER BY tenant_id, run_id DESC`,
    )
    .all() as any[];

  const latest = new Map<string, any>();
  const previous = new Map<string, any>();
  for (const r of rows) {
    if (!latest.has(r.tenant_id)) latest.set(r.tenant_id, r);
    else if (!previous.has(r.tenant_id)) previous.set(r.tenant_id, r);
  }

  return [...latest.values()]
    .map((r) => ({
      tenantId: r.tenant_id,
      tenantName: names.get(r.tenant_id) ?? r.tenant_id,
      score: r.score,
      previousScore: previous.get(r.tenant_id)?.score ?? null,
      passCount: r.pass_count,
      warnCount: r.warn_count,
      failCount: r.fail_count,
      notAssessableCount: r.not_assessable_count,
      lastRunAt: r.at,
    }))
    .sort((a, b) => a.score - b.score);
}
