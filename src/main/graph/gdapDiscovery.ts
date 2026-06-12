import { GraphClient } from "./graphClient";
import { listTenants, markOrphans } from "../db/tenantRepo";
import type { DiscoveredTenant, GdapRoleAssignment } from "@shared/types";
import { GDAP_ROLE_NAMES } from "./roles";

interface DelegatedAdminRelationship {
  id: string;
  status: string;
  customer?: { tenantId: string; displayName?: string };
  accessDetails?: { unifiedRoles?: { roleDefinitionId: string }[] };
}

/**
 * Enumerate active GDAP relationships in the partner tenant via the Graph
 * delegatedAdminRelationships endpoint. Read-only: TenantDeck never creates
 * or modifies GDAP relationships. Idempotent: existing registry rows show as
 * "linked", missing ones as "orphaned".
 */
export async function discoverGdapTenants(): Promise<DiscoveredTenant[]> {
  const graph = new GraphClient(null);
  const relationships = await graph.getAll<DelegatedAdminRelationship>(
    "/tenantRelationships/delegatedAdminRelationships?$filter=status eq 'active'",
  );

  const byTenant = new Map<string, DiscoveredTenant>();
  for (const rel of relationships) {
    const customer = rel.customer;
    if (!customer?.tenantId) continue;
    const roles: GdapRoleAssignment[] = (rel.accessDetails?.unifiedRoles ?? []).map((r) => ({
      roleTemplateId: r.roleDefinitionId,
      roleName: GDAP_ROLE_NAMES[r.roleDefinitionId] ?? r.roleDefinitionId,
    }));

    const existing = byTenant.get(customer.tenantId);
    if (existing) {
      existing.relationshipIds.push(rel.id);
      const seen = new Set(existing.gdapRoles.map((r) => r.roleTemplateId));
      for (const role of roles) {
        if (!seen.has(role.roleTemplateId)) existing.gdapRoles.push(role);
      }
    } else {
      byTenant.set(customer.tenantId, {
        tenantId: customer.tenantId,
        displayName: customer.displayName ?? customer.tenantId,
        defaultDomain: "",
        gdapRoles: roles,
        relationshipIds: [rel.id],
        status: "new",
      });
    }
  }

  // Resolve default domains where possible (best effort, per-tenant scope).
  for (const tenant of byTenant.values()) {
    try {
      const tenantGraph = new GraphClient(tenant.tenantId);
      const domains = await tenantGraph.getAll<{ id: string; isDefault: boolean }>("/domains");
      tenant.defaultDomain = domains.find((d) => d.isDefault)?.id ?? domains[0]?.id ?? "";
    } catch {
      // CA policy or role shortfall; leave blank, surfaced in the grid.
    }
  }

  // Mark status against the existing registry and flag orphans.
  const registry = new Map(listTenants().map((t) => [t.tenantId, t]));
  for (const tenant of byTenant.values()) {
    tenant.status = registry.has(tenant.tenantId) ? "linked" : "new";
  }
  markOrphans(new Set(byTenant.keys()));

  // Surface orphans in the discovery result for tidy-up.
  const discovered = [...byTenant.values()];
  for (const t of listTenants()) {
    if (t.status === "orphaned") {
      discovered.push({
        tenantId: t.tenantId,
        displayName: t.displayName,
        defaultDomain: t.defaultDomain,
        gdapRoles: t.gdapRoles,
        relationshipIds: [],
        status: "orphaned",
      });
    }
  }
  return discovered.sort((a, b) => a.displayName.localeCompare(b.displayName));
}
