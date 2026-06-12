import type { CheckDefinition } from "@shared/types";
import {
  listDomains,
  listGroups,
  listLicenses,
  listMailboxes,
  listUsers,
} from "../db/dataRepo";
import type { CheckResult } from "./baseline";

/**
 * Custom checks are JSON definitions over the cached data model:
 * entity + field + operator + threshold. House rules without code changes.
 */
export function evaluateCustomCheck(check: CheckDefinition, tenantId: string): CheckResult {
  const query = check.query;
  if (!query) {
    return { outcome: "not_assessable", detail: "No query defined", evidence: [] };
  }

  const rows = loadEntity(query.entity, tenantId);
  if (rows.length === 0) {
    return { outcome: "not_assessable", detail: `No ${query.entity} data cached`, evidence: [] };
  }

  const matches = rows.filter((row) => matchesRow(row, query.field, query.operator, query.value));
  const failed =
    query.failWhen === "countGt" ? matches.length > (query.threshold ?? 0) : matches.length > 0;

  if (!failed) {
    return { outcome: "pass", detail: `No matches across ${rows.length} ${query.entity}`, evidence: [] };
  }
  return {
    outcome: "fail",
    detail: `${matches.length} matching ${query.entity}`,
    evidence: matches.slice(0, 50) as Record<string, unknown>[],
  };
}

function loadEntity(entity: string, tenantId: string): Record<string, unknown>[] {
  switch (entity) {
    case "users":
      return listUsers([tenantId]) as unknown as Record<string, unknown>[];
    case "license_skus":
      return listLicenses([tenantId]) as unknown as Record<string, unknown>[];
    case "groups":
      return listGroups([tenantId]) as unknown as Record<string, unknown>[];
    case "domains":
      return listDomains([tenantId]) as unknown as Record<string, unknown>[];
    case "mailboxes":
      return listMailboxes([tenantId]) as unknown as Record<string, unknown>[];
    default:
      return [];
  }
}

function matchesRow(
  row: Record<string, unknown>,
  field: string,
  operator: string,
  value: unknown,
): boolean {
  // Dotted paths reach into nested results, e.g. "dmarc.health".
  const actual = field.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, row);

  switch (operator) {
    case "eq":
      return actual === value;
    case "ne":
      return actual !== value;
    case "gt":
      return typeof actual === "number" && actual > Number(value);
    case "gte":
      return typeof actual === "number" && actual >= Number(value);
    case "lt":
      return typeof actual === "number" && actual < Number(value);
    case "lte":
      return typeof actual === "number" && actual <= Number(value);
    case "contains":
      if (Array.isArray(actual)) return actual.includes(value);
      return typeof actual === "string" && actual.toLowerCase().includes(String(value).toLowerCase());
    case "empty":
      return actual === null || actual === undefined || actual === "" || (Array.isArray(actual) && actual.length === 0);
    case "notEmpty":
      return !(actual === null || actual === undefined || actual === "" || (Array.isArray(actual) && actual.length === 0));
    default:
      return false;
  }
}
