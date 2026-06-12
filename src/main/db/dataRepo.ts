import { getDb } from "./database";
import type {
  DnsCheckResult,
  DomainRow,
  EstateSummary,
  GroupRow,
  LicenseSkuRow,
  MailboxRow,
  SearchResult,
  UserRow,
} from "@shared/types";

function tenantNames(): Map<string, string> {
  const rows = getDb().prepare("SELECT tenant_id, display_name FROM tenants").all() as {
    tenant_id: string;
    display_name: string;
  }[];
  return new Map(rows.map((r) => [r.tenant_id, r.display_name]));
}

function scope(tenantIds?: string[]): { where: string; params: string[] } {
  if (!tenantIds || tenantIds.length === 0) return { where: "", params: [] };
  return {
    where: ` WHERE tenant_id IN (${tenantIds.map(() => "?").join(",")})`,
    params: tenantIds,
  };
}

// --- Writes (used by sync collectors) ---------------------------------------

export function replaceUsers(tenantId: string, users: Omit<UserRow, "tenantName">[]): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM users WHERE tenant_id = ?").run(tenantId);
    const ins = db.prepare(`
      INSERT INTO users (tenant_id, id, user_principal_name, display_name, account_enabled,
        licensed, admin_roles, mfa_registered, last_sign_in_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const u of users) {
      ins.run(
        tenantId,
        u.id,
        u.userPrincipalName,
        u.displayName,
        u.accountEnabled ? 1 : 0,
        u.licensed ? 1 : 0,
        JSON.stringify(u.adminRoles),
        u.mfaRegistered === null ? null : u.mfaRegistered ? 1 : 0,
        u.lastSignInAt,
        u.createdAt,
      );
    }
  });
  tx();
}

export function replaceLicenses(
  tenantId: string,
  skus: Omit<LicenseSkuRow, "tenantName" | "unassigned">[],
): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM license_skus WHERE tenant_id = ?").run(tenantId);
    const ins = db.prepare(`
      INSERT INTO license_skus (tenant_id, sku_id, sku_part_number, friendly_name, purchased, assigned)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const s of skus) {
      ins.run(tenantId, s.skuId, s.skuPartNumber, s.friendlyName, s.purchased, s.assigned);
    }
  });
  tx();
}

export function replaceGroups(tenantId: string, groups: Omit<GroupRow, "tenantName">[]): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM groups WHERE tenant_id = ?").run(tenantId);
    const ins = db.prepare(`
      INSERT INTO groups (tenant_id, id, display_name, group_type, is_team, visibility, owner_count, member_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const g of groups) {
      ins.run(
        tenantId,
        g.id,
        g.displayName,
        g.groupType,
        g.isTeam ? 1 : 0,
        g.visibility,
        g.ownerCount,
        g.memberCount,
      );
    }
  });
  tx();
}

export function replaceDomains(
  tenantId: string,
  domains: Omit<DomainRow, "tenantName">[],
): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM domains WHERE tenant_id = ?").run(tenantId);
    const ins = db.prepare(`
      INSERT INTO domains (tenant_id, domain, is_default, is_verified, spf, dkim, dmarc)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const d of domains) {
      ins.run(
        tenantId,
        d.domain,
        d.isDefault ? 1 : 0,
        d.isVerified ? 1 : 0,
        JSON.stringify(d.spf),
        JSON.stringify(d.dkim),
        JSON.stringify(d.dmarc),
      );
    }
  });
  tx();
}

export function replaceMailboxes(
  tenantId: string,
  mailboxes: Omit<MailboxRow, "tenantName">[],
): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM mailboxes WHERE tenant_id = ?").run(tenantId);
    const ins = db.prepare(`
      INSERT INTO mailboxes (tenant_id, id, user_principal_name, display_name, mailbox_type,
        size_bytes, quota_bytes, forwarding_smtp_address, external_forwarding)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const m of mailboxes) {
      ins.run(
        tenantId,
        m.id,
        m.userPrincipalName,
        m.displayName,
        m.mailboxType,
        m.sizeBytes,
        m.quotaBytes,
        m.forwardingSmtpAddress,
        m.externalForwarding ? 1 : 0,
      );
    }
  });
  tx();
}

// --- Reads ------------------------------------------------------------------

export function listUsers(tenantIds?: string[]): UserRow[] {
  const names = tenantNames();
  const { where, params } = scope(tenantIds);
  const rows = getDb().prepare(`SELECT * FROM users${where}`).all(...params) as any[];
  return rows.map((r) => ({
    tenantId: r.tenant_id,
    tenantName: names.get(r.tenant_id) ?? r.tenant_id,
    id: r.id,
    userPrincipalName: r.user_principal_name,
    displayName: r.display_name,
    accountEnabled: !!r.account_enabled,
    licensed: !!r.licensed,
    adminRoles: JSON.parse(r.admin_roles),
    mfaRegistered: r.mfa_registered === null ? null : !!r.mfa_registered,
    lastSignInAt: r.last_sign_in_at,
    createdAt: r.created_at,
  }));
}

export function listLicenses(tenantIds?: string[]): LicenseSkuRow[] {
  const names = tenantNames();
  const { where, params } = scope(tenantIds);
  const rows = getDb().prepare(`SELECT * FROM license_skus${where}`).all(...params) as any[];
  return rows.map((r) => ({
    tenantId: r.tenant_id,
    tenantName: names.get(r.tenant_id) ?? r.tenant_id,
    skuId: r.sku_id,
    skuPartNumber: r.sku_part_number,
    friendlyName: r.friendly_name,
    purchased: r.purchased,
    assigned: r.assigned,
    unassigned: Math.max(0, r.purchased - r.assigned),
  }));
}

export function listGroups(tenantIds?: string[]): GroupRow[] {
  const names = tenantNames();
  const { where, params } = scope(tenantIds);
  const rows = getDb().prepare(`SELECT * FROM groups${where}`).all(...params) as any[];
  return rows.map((r) => ({
    tenantId: r.tenant_id,
    tenantName: names.get(r.tenant_id) ?? r.tenant_id,
    id: r.id,
    displayName: r.display_name,
    groupType: r.group_type,
    isTeam: !!r.is_team,
    visibility: r.visibility,
    ownerCount: r.owner_count,
    memberCount: r.member_count,
  }));
}

export function listDomains(tenantIds?: string[]): DomainRow[] {
  const names = tenantNames();
  const { where, params } = scope(tenantIds);
  const rows = getDb().prepare(`SELECT * FROM domains${where}`).all(...params) as any[];
  return rows.map((r) => ({
    tenantId: r.tenant_id,
    tenantName: names.get(r.tenant_id) ?? r.tenant_id,
    domain: r.domain,
    isDefault: !!r.is_default,
    isVerified: !!r.is_verified,
    spf: JSON.parse(r.spf) as DnsCheckResult,
    dkim: JSON.parse(r.dkim) as DnsCheckResult,
    dmarc: JSON.parse(r.dmarc) as DnsCheckResult,
  }));
}

export function listMailboxes(tenantIds?: string[]): MailboxRow[] {
  const names = tenantNames();
  const { where, params } = scope(tenantIds);
  const rows = getDb().prepare(`SELECT * FROM mailboxes${where}`).all(...params) as any[];
  return rows.map((r) => ({
    tenantId: r.tenant_id,
    tenantName: names.get(r.tenant_id) ?? r.tenant_id,
    id: r.id,
    userPrincipalName: r.user_principal_name,
    displayName: r.display_name,
    mailboxType: r.mailbox_type,
    sizeBytes: r.size_bytes,
    quotaBytes: r.quota_bytes,
    forwardingSmtpAddress: r.forwarding_smtp_address,
    externalForwarding: !!r.external_forwarding,
  }));
}

export function estateSummary(): EstateSummary {
  const db = getDb();
  const one = (sql: string): number => (db.prepare(sql).get() as { n: number }).n;
  return {
    tenantCount: one("SELECT COUNT(*) n FROM tenants WHERE status != 'orphaned'"),
    userCount: one("SELECT COUNT(*) n FROM users"),
    licensedUserCount: one("SELECT COUNT(*) n FROM users WHERE licensed = 1"),
    unassignedLicenses: one(
      "SELECT COALESCE(SUM(MAX(purchased - assigned, 0)), 0) n FROM license_skus",
    ),
    tenantsWithSyncErrors: one(
      "SELECT COUNT(*) n FROM tenants WHERE last_sync_error IS NOT NULL",
    ),
    adminsWithoutMfa: one(
      "SELECT COUNT(*) n FROM users WHERE admin_roles != '[]' AND mfa_registered = 0",
    ),
    externalForwardingMailboxes: one(
      "SELECT COUNT(*) n FROM mailboxes WHERE external_forwarding = 1",
    ),
    domainsMissingDmarc: one(
      `SELECT COUNT(*) n FROM domains WHERE is_verified = 1 AND json_extract(dmarc, '$.health') = 'fail'`,
    ),
  };
}

export function search(query: string): SearchResult[] {
  const names = tenantNames();
  const q = `%${query}%`;
  const db = getDb();
  const results: SearchResult[] = [];

  const users = db
    .prepare(
      "SELECT tenant_id, id, user_principal_name, display_name FROM users WHERE user_principal_name LIKE ? OR display_name LIKE ? LIMIT 25",
    )
    .all(q, q) as any[];
  for (const u of users) {
    results.push({
      kind: "user",
      tenantId: u.tenant_id,
      tenantName: names.get(u.tenant_id) ?? u.tenant_id,
      id: u.id,
      title: u.display_name || u.user_principal_name,
      subtitle: u.user_principal_name,
    });
  }

  const groups = db
    .prepare("SELECT tenant_id, id, display_name, group_type FROM groups WHERE display_name LIKE ? LIMIT 15")
    .all(q) as any[];
  for (const g of groups) {
    results.push({
      kind: "group",
      tenantId: g.tenant_id,
      tenantName: names.get(g.tenant_id) ?? g.tenant_id,
      id: g.id,
      title: g.display_name,
      subtitle: g.group_type,
    });
  }

  const mailboxes = db
    .prepare(
      "SELECT tenant_id, id, user_principal_name, display_name FROM mailboxes WHERE user_principal_name LIKE ? OR display_name LIKE ? LIMIT 15",
    )
    .all(q, q) as any[];
  for (const m of mailboxes) {
    results.push({
      kind: "mailbox",
      tenantId: m.tenant_id,
      tenantName: names.get(m.tenant_id) ?? m.tenant_id,
      id: m.id,
      title: m.display_name || m.user_principal_name,
      subtitle: m.user_principal_name,
    });
  }

  const domains = db
    .prepare("SELECT tenant_id, domain FROM domains WHERE domain LIKE ? LIMIT 10")
    .all(q) as any[];
  for (const d of domains) {
    results.push({
      kind: "domain",
      tenantId: d.tenant_id,
      tenantName: names.get(d.tenant_id) ?? d.tenant_id,
      id: d.domain,
      title: d.domain,
      subtitle: names.get(d.tenant_id) ?? d.tenant_id,
    });
  }

  const tenants = db
    .prepare(
      "SELECT tenant_id, display_name, default_domain FROM tenants WHERE display_name LIKE ? OR default_domain LIKE ? LIMIT 10",
    )
    .all(q, q) as any[];
  for (const t of tenants) {
    results.push({
      kind: "tenant",
      tenantId: t.tenant_id,
      tenantName: t.display_name,
      id: t.tenant_id,
      title: t.display_name,
      subtitle: t.default_domain,
    });
  }

  return results;
}
