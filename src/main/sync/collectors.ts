import { GraphClient, isPermissionError } from "../graph/graphClient";
import {
  replaceDomains,
  replaceGroups,
  replaceLicenses,
  replaceUsers,
} from "../db/dataRepo";
import { skuFriendlyName } from "./skuNames";
import { checkDkim, checkDmarc, checkSpf } from "./dnsHealth";
import type { DomainRow, GroupRow, LicenseSkuRow, UserRow } from "@shared/types";
import { GDAP_ROLE_NAMES } from "../graph/roles";

/** Each collector returns the number of entities cached. */
export type Collector = (tenantId: string, graph: GraphClient) => Promise<number>;

interface GraphUser {
  id: string;
  userPrincipalName: string;
  displayName?: string;
  accountEnabled?: boolean;
  assignedLicenses?: { skuId: string }[];
  createdDateTime?: string;
  signInActivity?: { lastSignInDateTime?: string };
}

export const collectUsers: Collector = async (tenantId, graph) => {
  // signInActivity needs Entra ID P1 + AuditLog.Read; degrade gracefully.
  let users: GraphUser[];
  let signInAvailable = true;
  try {
    users = await graph.getAll<GraphUser>(
      "/users?$select=id,userPrincipalName,displayName,accountEnabled,assignedLicenses,createdDateTime,signInActivity&$top=999",
    );
  } catch (e) {
    if (!isPermissionError(e)) {
      // Tenants without P1 reject the signInActivity property outright.
      signInAvailable = false;
      users = await graph.getAll<GraphUser>(
        "/users?$select=id,userPrincipalName,displayName,accountEnabled,assignedLicenses,createdDateTime&$top=999",
      );
    } else {
      throw e;
    }
  }

  // Admin role membership.
  const adminRolesByUser = new Map<string, string[]>();
  try {
    const roles = await graph.getAll<{ id: string; roleTemplateId: string; displayName: string }>(
      "/directoryRoles",
    );
    for (const role of roles) {
      const members = await graph.getAll<{ id: string }>(`/directoryRoles/${role.id}/members`);
      const name = GDAP_ROLE_NAMES[role.roleTemplateId] ?? role.displayName;
      for (const m of members) {
        const existing = adminRolesByUser.get(m.id) ?? [];
        existing.push(name);
        adminRolesByUser.set(m.id, existing);
      }
    }
  } catch {
    /* role read not available; leave adminRoles empty */
  }

  // MFA registration state (reports endpoint; not assessable without it).
  const mfaByUser = new Map<string, boolean>();
  let mfaAvailable = true;
  try {
    const details = await graph.getAll<{ id: string; isMfaRegistered: boolean }>(
      "/reports/authenticationMethods/userRegistrationDetails?$top=999",
    );
    for (const d of details) mfaByUser.set(d.id, d.isMfaRegistered);
  } catch {
    mfaAvailable = false;
  }

  const rows: Omit<UserRow, "tenantName">[] = users.map((u) => ({
    tenantId,
    id: u.id,
    userPrincipalName: u.userPrincipalName,
    displayName: u.displayName ?? "",
    accountEnabled: u.accountEnabled ?? true,
    licensed: (u.assignedLicenses?.length ?? 0) > 0,
    adminRoles: adminRolesByUser.get(u.id) ?? [],
    mfaRegistered: mfaAvailable ? (mfaByUser.get(u.id) ?? false) : null,
    lastSignInAt: signInAvailable ? (u.signInActivity?.lastSignInDateTime ?? null) : null,
    createdAt: u.createdDateTime ?? null,
  }));
  replaceUsers(tenantId, rows);
  return rows.length;
};

export const collectLicenses: Collector = async (tenantId, graph) => {
  const skus = await graph.getAll<{
    skuId: string;
    skuPartNumber: string;
    prepaidUnits: { enabled: number };
    consumedUnits: number;
  }>("/subscribedSkus");
  const rows: Omit<LicenseSkuRow, "tenantName" | "unassigned">[] = skus.map((s) => ({
    tenantId,
    skuId: s.skuId,
    skuPartNumber: s.skuPartNumber,
    friendlyName: skuFriendlyName(s.skuPartNumber),
    purchased: s.prepaidUnits.enabled,
    assigned: s.consumedUnits,
  }));
  replaceLicenses(tenantId, rows);
  return rows.length;
};

interface GraphGroup {
  id: string;
  displayName?: string;
  groupTypes?: string[];
  securityEnabled?: boolean;
  mailEnabled?: boolean;
  visibility?: string;
  resourceProvisioningOptions?: string[];
}

export const collectGroups: Collector = async (tenantId, graph) => {
  const groups = await graph.getAll<GraphGroup>(
    "/groups?$select=id,displayName,groupTypes,securityEnabled,mailEnabled,visibility,resourceProvisioningOptions&$top=999",
  );
  const rows: Omit<GroupRow, "tenantName">[] = [];
  for (const g of groups) {
    let ownerCount = 0;
    let memberCount = 0;
    try {
      const owners = await graph.get<{ "@odata.count"?: number; value: unknown[] }>(
        `/groups/${g.id}/owners?$count=true&$top=1`,
      );
      ownerCount = owners["@odata.count"] ?? owners.value.length;
      const members = await graph.get<{ "@odata.count"?: number; value: unknown[] }>(
        `/groups/${g.id}/members?$count=true&$top=1`,
      );
      memberCount = members["@odata.count"] ?? members.value.length;
    } catch {
      /* counts unavailable */
    }
    const unified = g.groupTypes?.includes("Unified") ?? false;
    rows.push({
      tenantId,
      id: g.id,
      displayName: g.displayName ?? "",
      groupType: unified
        ? "m365"
        : g.securityEnabled && g.mailEnabled
          ? "mailEnabledSecurity"
          : g.securityEnabled
            ? "security"
            : "distribution",
      isTeam: g.resourceProvisioningOptions?.includes("Team") ?? false,
      visibility: g.visibility ?? null,
      ownerCount,
      memberCount,
    });
  }
  replaceGroups(tenantId, rows);
  return rows.length;
};

export const collectDomains: Collector = async (tenantId, graph) => {
  const domains = await graph.getAll<{ id: string; isDefault: boolean; isVerified: boolean }>(
    "/domains",
  );
  const rows: Omit<DomainRow, "tenantName">[] = [];
  for (const d of domains) {
    const skipDns = d.id.endsWith(".onmicrosoft.com") || !d.isVerified;
    const [spf, dkim, dmarc] = skipDns
      ? [
          { health: "unknown" as const, detail: "Not checked", record: null },
          { health: "unknown" as const, detail: "Not checked", record: null },
          { health: "unknown" as const, detail: "Not checked", record: null },
        ]
      : await Promise.all([checkSpf(d.id), checkDkim(d.id), checkDmarc(d.id)]);
    rows.push({
      tenantId,
      domain: d.id,
      isDefault: d.isDefault,
      isVerified: d.isVerified,
      spf,
      dkim,
      dmarc,
    });
  }
  replaceDomains(tenantId, rows);
  return rows.length;
};
