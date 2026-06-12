import type { CheckCategory, CheckDefinition, CheckOutcome, CheckSeverity } from "@shared/types";
import { listDomains, listGroups, listLicenses, listMailboxes, listUsers } from "../db/dataRepo";

export interface CheckResult {
  outcome: CheckOutcome;
  detail: string;
  evidence: Record<string, unknown>[];
}

export type BuiltinEvaluator = (tenantId: string) => CheckResult;

interface BuiltinCheck {
  id: string;
  title: string;
  category: CheckCategory;
  severity: CheckSeverity;
  description: string;
  remediation: string;
  evaluate: BuiltinEvaluator;
}

const pass = (detail: string): CheckResult => ({ outcome: "pass", detail, evidence: [] });
const notAssessable = (detail: string): CheckResult => ({
  outcome: "not_assessable",
  detail,
  evidence: [],
});

function failWith(
  detail: string,
  evidence: Record<string, unknown>[],
  outcome: CheckOutcome = "fail",
): CheckResult {
  return { outcome, detail, evidence };
}

/**
 * Affinity IT default baseline. Each check evaluates the cached data model
 * for one tenant. Checks that need data the tenant cannot provide return
 * "not_assessable" with the reason stated, never a false fail.
 */
export const BUILTIN_CHECKS: BuiltinCheck[] = [
  // --- Identity hygiene ------------------------------------------------------
  {
    id: "identity.mfa-all-users",
    title: "MFA registered for all enabled users",
    category: "identity",
    severity: "high",
    description: "Every enabled user account has registered MFA methods.",
    remediation: "Enforce MFA registration via Conditional Access or security defaults; chase stragglers from the evidence list.",
    evaluate: (tenantId) => {
      const users = listUsers([tenantId]).filter((u) => u.accountEnabled);
      if (users.length === 0) return notAssessable("No user data cached");
      if (users.some((u) => u.mfaRegistered === null)) {
        return notAssessable("MFA registration report unavailable (requires Reports access)");
      }
      const missing = users.filter((u) => u.mfaRegistered === false);
      if (missing.length === 0) return pass(`All ${users.length} enabled users MFA-registered`);
      return failWith(
        `${missing.length} of ${users.length} enabled users without MFA`,
        missing.map((u) => ({ user: u.userPrincipalName, lastSignIn: u.lastSignInAt })),
        missing.length / users.length > 0.1 ? "fail" : "warn",
      );
    },
  },
  {
    id: "identity.admins-mfa",
    title: "No admins without MFA",
    category: "identity",
    severity: "critical",
    description: "Every account holding an admin role has registered MFA.",
    remediation: "Register MFA for the listed admins immediately, or remove the role.",
    evaluate: (tenantId) => {
      const admins = listUsers([tenantId]).filter((u) => u.adminRoles.length > 0 && u.accountEnabled);
      if (admins.length === 0) return notAssessable("No admin role data cached");
      if (admins.some((u) => u.mfaRegistered === null)) {
        return notAssessable("MFA registration report unavailable (requires Reports access)");
      }
      const missing = admins.filter((u) => u.mfaRegistered === false);
      if (missing.length === 0) return pass(`All ${admins.length} admins MFA-registered`);
      return failWith(
        `${missing.length} admin account(s) without MFA`,
        missing.map((u) => ({ user: u.userPrincipalName, roles: u.adminRoles.join(", ") })),
      );
    },
  },
  {
    id: "identity.global-admin-count",
    title: "Global Administrator count within 2–4",
    category: "identity",
    severity: "medium",
    description: "Microsoft recommends 2–4 Global Administrators: enough for redundancy, few enough to audit.",
    remediation: "Reduce Global Administrators to dedicated admin accounts; use PIM/least-privileged roles for the rest.",
    evaluate: (tenantId) => {
      const gas = listUsers([tenantId]).filter(
        (u) => u.adminRoles.includes("Global Administrator") && u.accountEnabled,
      );
      const evidence = gas.map((u) => ({ user: u.userPrincipalName }));
      if (gas.length === 0) return notAssessable("No role data cached");
      if (gas.length === 1) return failWith("Only 1 Global Administrator (no redundancy)", evidence, "warn");
      if (gas.length > 4) return failWith(`${gas.length} Global Administrators (recommended 2–4)`, evidence);
      return pass(`${gas.length} Global Administrators`);
    },
  },
  {
    id: "identity.stale-admins",
    title: "No stale admin accounts (no sign-in 60+ days)",
    category: "identity",
    severity: "high",
    description: "Admin accounts that have not signed in for 60+ days are takeover targets.",
    remediation: "Disable or de-role the listed accounts; verify break-glass accounts are deliberately excluded.",
    evaluate: (tenantId) => {
      const admins = listUsers([tenantId]).filter((u) => u.adminRoles.length > 0 && u.accountEnabled);
      if (admins.length === 0) return notAssessable("No admin role data cached");
      if (admins.every((u) => u.lastSignInAt === null)) {
        return notAssessable("Sign-in activity unavailable (requires Entra ID P1)");
      }
      const cutoff = Date.now() - 60 * 86_400_000;
      const stale = admins.filter(
        (u) => u.lastSignInAt !== null && new Date(u.lastSignInAt).getTime() < cutoff,
      );
      if (stale.length === 0) return pass("No stale admin accounts");
      return failWith(
        `${stale.length} admin account(s) with no sign-in for 60+ days`,
        stale.map((u) => ({ user: u.userPrincipalName, lastSignIn: u.lastSignInAt, roles: u.adminRoles.join(", ") })),
      );
    },
  },
  {
    id: "identity.disabled-licensed",
    title: "No licensed accounts disabled or inactive 90+ days",
    category: "licensing",
    severity: "medium",
    description: "Disabled or long-inactive accounts holding paid licenses are recoverable spend.",
    remediation: "Remove licenses from the listed accounts or convert mailboxes to shared.",
    evaluate: (tenantId) => {
      const users = listUsers([tenantId]);
      if (users.length === 0) return notAssessable("No user data cached");
      const cutoff = Date.now() - 90 * 86_400_000;
      const wasteful = users.filter(
        (u) =>
          u.licensed &&
          (!u.accountEnabled ||
            (u.lastSignInAt !== null && new Date(u.lastSignInAt).getTime() < cutoff)),
      );
      if (wasteful.length === 0) return pass("No disabled/inactive licensed accounts");
      return failWith(
        `${wasteful.length} licensed account(s) disabled or inactive 90+ days`,
        wasteful.map((u) => ({
          user: u.userPrincipalName,
          enabled: u.accountEnabled,
          lastSignIn: u.lastSignInAt,
        })),
        "warn",
      );
    },
  },
  // --- Licensing hygiene -----------------------------------------------------
  {
    id: "licensing.unassigned",
    title: "No unassigned paid licenses above threshold",
    category: "licensing",
    severity: "low",
    description: "Purchased licenses sitting unassigned are waste unless deliberately held.",
    remediation: "Reduce the subscription count at renewal or assign the spare licenses.",
    evaluate: (tenantId) => {
      const skus = listLicenses([tenantId]);
      if (skus.length === 0) return notAssessable("No license data cached");
      const wasted = skus.filter((s) => s.unassigned > 2);
      if (wasted.length === 0) return pass("No significant unassigned licenses");
      return failWith(
        `${wasted.reduce((n, s) => n + s.unassigned, 0)} unassigned licenses across ${wasted.length} SKU(s)`,
        wasted.map((s) => ({ sku: s.friendlyName, purchased: s.purchased, assigned: s.assigned, unassigned: s.unassigned })),
        "warn",
      );
    },
  },
  // --- Mail authentication (DNS) ---------------------------------------------
  {
    id: "mailauth.spf",
    title: "SPF present and single-record on all verified domains",
    category: "mail_auth",
    severity: "high",
    description: "Each verified custom domain publishes exactly one valid SPF record.",
    remediation: "Publish or consolidate the SPF TXT record; expected value shown in the Domains module.",
    evaluate: (tenantId) => dnsCheck(tenantId, "spf"),
  },
  {
    id: "mailauth.dkim",
    title: "DKIM CNAMEs resolving for all verified domains",
    category: "mail_auth",
    severity: "high",
    description: "selector1/selector2 DKIM CNAMEs resolve for each verified custom domain.",
    remediation: "Enable DKIM signing in EXO and publish the selector CNAMEs.",
    evaluate: (tenantId) => dnsCheck(tenantId, "dkim"),
  },
  {
    id: "mailauth.dmarc",
    title: "DMARC present with enforcement policy",
    category: "mail_auth",
    severity: "high",
    description: "Each verified custom domain publishes DMARC with p=quarantine or p=reject.",
    remediation: "Publish _dmarc TXT with an enforcement policy once SPF/DKIM alignment is verified.",
    evaluate: (tenantId) => dnsCheck(tenantId, "dmarc"),
  },
  // --- Exchange security / compromise indicators ------------------------------
  {
    id: "exchange.external-forwarding",
    title: "External auto-forwarding disabled or justified",
    category: "compromise",
    severity: "critical",
    description: "Mailbox-level forwarding to external addresses is the classic BEC exfiltration channel.",
    remediation: "Review each forward with the client; remove unauthorised ones and block auto-forwarding via outbound spam policy.",
    evaluate: (tenantId) => {
      const mailboxes = listMailboxes([tenantId]);
      if (mailboxes.length === 0) return notAssessable("No mailbox data cached (Exchange sync pending)");
      const forwarding = mailboxes.filter((m) => m.externalForwarding);
      if (forwarding.length === 0) return pass("No external forwarding found");
      return failWith(
        `${forwarding.length} mailbox(es) forwarding externally`,
        forwarding.map((m) => ({ mailbox: m.userPrincipalName, forwardTo: m.forwardingSmtpAddress })),
      );
    },
  },
  // --- Data hygiene -----------------------------------------------------------
  {
    id: "hygiene.ownerless-groups",
    title: "No ownerless groups or Teams",
    category: "data_hygiene",
    severity: "low",
    description: "Groups and Teams without owners cannot be managed by the client and accumulate stale membership.",
    remediation: "Assign at least one owner to each listed group.",
    evaluate: (tenantId) => {
      const groups = listGroups([tenantId]);
      if (groups.length === 0) return notAssessable("No group data cached");
      const ownerless = groups.filter((g) => g.ownerCount === 0 && g.groupType !== "security");
      if (ownerless.length === 0) return pass("All groups have owners");
      return failWith(
        `${ownerless.length} ownerless group(s)`,
        ownerless.map((g) => ({ group: g.displayName, type: g.groupType, isTeam: g.isTeam })),
        "warn",
      );
    },
  },
  {
    id: "hygiene.empty-groups",
    title: "No empty groups",
    category: "data_hygiene",
    severity: "low",
    description: "Groups with no members are usually leftovers and clutter access reviews.",
    remediation: "Delete or repurpose the listed groups.",
    evaluate: (tenantId) => {
      const groups = listGroups([tenantId]);
      if (groups.length === 0) return notAssessable("No group data cached");
      const empty = groups.filter((g) => g.memberCount === 0);
      if (empty.length === 0) return pass("No empty groups");
      return failWith(
        `${empty.length} empty group(s)`,
        empty.map((g) => ({ group: g.displayName, type: g.groupType })),
        "warn",
      );
    },
  },
];

function dnsCheck(tenantId: string, kind: "spf" | "dkim" | "dmarc"): CheckResult {
  const domains = listDomains([tenantId]).filter(
    (d) => d.isVerified && !d.domain.endsWith(".onmicrosoft.com"),
  );
  if (domains.length === 0) return notAssessable("No verified custom domains cached");
  const bad = domains.filter((d) => d[kind].health === "fail");
  const warn = domains.filter((d) => d[kind].health === "warn");
  if (bad.length > 0) {
    return failWith(
      `${bad.length} domain(s) failing ${kind.toUpperCase()}`,
      bad.map((d) => ({ domain: d.domain, detail: d[kind].detail, record: d[kind].record })),
    );
  }
  if (warn.length > 0) {
    return failWith(
      `${warn.length} domain(s) with ${kind.toUpperCase()} warnings`,
      warn.map((d) => ({ domain: d.domain, detail: d[kind].detail, record: d[kind].record })),
      "warn",
    );
  }
  return pass(`${kind.toUpperCase()} healthy on ${domains.length} domain(s)`);
}

export function builtinDefinitions(): CheckDefinition[] {
  return BUILTIN_CHECKS.map((c) => ({
    id: c.id,
    title: c.title,
    category: c.category,
    severity: c.severity,
    description: c.description,
    remediation: c.remediation,
    enabled: true,
    builtin: true,
  }));
}
