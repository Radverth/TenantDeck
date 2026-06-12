/**
 * Domain types shared between main and renderer.
 * The renderer only ever sees these shapes — never raw Graph/EXO payloads.
 */

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export interface AuthAccount {
  username: string;
  name: string | null;
  partnerTenantId: string;
}

export interface AuthStatus {
  signedIn: boolean;
  account: AuthAccount | null;
}

// ---------------------------------------------------------------------------
// Tenant Registry
// ---------------------------------------------------------------------------

export type TenantModule =
  | "identity"
  | "licensing"
  | "groups"
  | "domains"
  | "exchange";

export const ALL_MODULES: TenantModule[] = [
  "identity",
  "licensing",
  "groups",
  "domains",
  "exchange",
];

export type SyncSchedule = "manual" | "6h" | "daily" | "weekly";

export type TenantStatus = "new" | "linked" | "orphaned" | "error";

export interface GdapRoleAssignment {
  roleTemplateId: string;
  roleName: string;
}

/** A tenant discovered via Graph delegatedAdminRelationships, staged in the grid. */
export interface DiscoveredTenant {
  tenantId: string;
  displayName: string;
  defaultDomain: string;
  gdapRoles: GdapRoleAssignment[];
  relationshipIds: string[];
  /** new = not in registry yet; linked = already committed; orphaned = in registry but GDAP gone */
  status: TenantStatus;
}

/** A committed tenant registry record. */
export interface TenantRecord {
  tenantId: string;
  displayName: string;
  defaultDomain: string;
  internalClientCode: string | null;
  enabledModules: TenantModule[];
  syncSchedule: SyncSchedule;
  gdapRoles: GdapRoleAssignment[];
  status: TenantStatus;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  notes: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

/** Editable subset of a tenant record (single or bulk edit). */
export interface TenantEdit {
  displayName?: string;
  internalClientCode?: string | null;
  enabledModules?: TenantModule[];
  syncSchedule?: SyncSchedule;
  notes?: string | null;
  tags?: string[];
}

export interface StagedTenantRow {
  tenant: DiscoveredTenant;
  edit: TenantEdit;
  validation: RoleValidationResult;
  selected: boolean;
}

export interface RoleValidationResult {
  ok: boolean;
  /** Module → missing role name, for amber warning chips. */
  shortfalls: { module: TenantModule; missingRole: string }[];
  /** Roles granted beyond what enabled modules need (least-privilege warning). */
  surplus: string[];
}

export interface CommitResult {
  created: number;
  updated: number;
  skipped: number;
  failed: { tenantId: string; reason: string }[];
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export type SyncState = "idle" | "queued" | "running" | "ok" | "error";

export interface TenantSyncStatus {
  tenantId: string;
  state: SyncState;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  entityCounts: Record<string, number>;
}

export interface SyncProgressEvent {
  tenantId: string;
  state: SyncState;
  message: string;
}

// ---------------------------------------------------------------------------
// Directory data
// ---------------------------------------------------------------------------

export interface UserRow {
  tenantId: string;
  tenantName: string;
  id: string;
  userPrincipalName: string;
  displayName: string;
  accountEnabled: boolean;
  licensed: boolean;
  adminRoles: string[];
  mfaRegistered: boolean | null;
  lastSignInAt: string | null;
  createdAt: string | null;
}

export interface LicenseSkuRow {
  tenantId: string;
  tenantName: string;
  skuId: string;
  skuPartNumber: string;
  friendlyName: string;
  purchased: number;
  assigned: number;
  unassigned: number;
}

export interface GroupRow {
  tenantId: string;
  tenantName: string;
  id: string;
  displayName: string;
  groupType: "security" | "m365" | "distribution" | "mailEnabledSecurity";
  isTeam: boolean;
  visibility: string | null;
  ownerCount: number;
  memberCount: number;
}

export interface DomainRow {
  tenantId: string;
  tenantName: string;
  domain: string;
  isDefault: boolean;
  isVerified: boolean;
  spf: DnsCheckResult;
  dkim: DnsCheckResult;
  dmarc: DnsCheckResult;
}

export type DnsHealth = "pass" | "warn" | "fail" | "unknown";

export interface DnsCheckResult {
  health: DnsHealth;
  detail: string;
  record: string | null;
}

export interface MailboxRow {
  tenantId: string;
  tenantName: string;
  id: string;
  userPrincipalName: string;
  displayName: string;
  mailboxType: "user" | "shared" | "room" | "equipment" | "unknown";
  sizeBytes: number | null;
  quotaBytes: number | null;
  forwardingSmtpAddress: string | null;
  externalForwarding: boolean;
}

// ---------------------------------------------------------------------------
// Audit engine
// ---------------------------------------------------------------------------

export type CheckSeverity = "low" | "medium" | "high" | "critical";
export type CheckOutcome = "pass" | "warn" | "fail" | "not_assessable";

export type CheckCategory =
  | "identity"
  | "tenant_security"
  | "exchange_security"
  | "mail_auth"
  | "licensing"
  | "data_hygiene"
  | "compromise";

/**
 * JSON-definable check over the cached data model: field, operator, threshold.
 * Built-in checks use `builtin` ids; custom checks supply a query definition.
 */
export interface CheckDefinition {
  id: string;
  title: string;
  category: CheckCategory;
  severity: CheckSeverity;
  description: string;
  remediation: string;
  enabled: boolean;
  builtin: boolean;
  /** For custom JSON checks evaluated against the cached entity tables. */
  query?: CustomCheckQuery;
}

export interface CustomCheckQuery {
  entity: "users" | "license_skus" | "groups" | "domains" | "mailboxes";
  field: string;
  operator: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "contains" | "empty" | "notEmpty";
  value?: string | number | boolean;
  /** Outcome when any rows match: fail rows are the evidence. */
  failWhen: "anyMatch" | "countGt";
  threshold?: number;
}

export interface AuditFinding {
  id: number;
  runId: number;
  tenantId: string;
  tenantName: string;
  checkId: string;
  checkTitle: string;
  category: CheckCategory;
  severity: CheckSeverity;
  outcome: CheckOutcome;
  detail: string;
  evidence: Record<string, unknown>[];
  remediation: string;
  observedAt: string;
}

export interface TenantScore {
  tenantId: string;
  tenantName: string;
  score: number;
  previousScore: number | null;
  passCount: number;
  warnCount: number;
  failCount: number;
  notAssessableCount: number;
  lastRunAt: string;
}

export interface AuditRunSummary {
  runId: number;
  startedAt: string;
  finishedAt: string | null;
  tenantCount: number;
  findingCount: number;
}

// ---------------------------------------------------------------------------
// Exchange connectors (guarded write module)
// ---------------------------------------------------------------------------

export type ConnectorDirection = "inbound" | "outbound";
export type ConnectorType = "Partner" | "OnPremises";

export interface InboundConnectorSpec {
  name: string;
  comment: string;
  connectorType: ConnectorType;
  senderDomains: string[];
  senderIPAddresses: string[];
  requireTls: boolean;
  tlsSenderCertificateName: string | null;
  restrictDomainsToIPAddresses: boolean;
  restrictDomainsToCertificate: boolean;
  enabled: boolean;
  enhancedFiltering: EnhancedFilteringSpec | null;
}

export interface EnhancedFilteringSpec {
  efSkipLastIP: boolean;
  efSkipIPs: string[];
  efUsers: string[];
  efTestMode: boolean;
}

export interface OutboundConnectorSpec {
  name: string;
  comment: string;
  smartHosts: string[];
  useMXRecord: boolean;
  recipientDomains: string[];
  allAcceptedDomains: boolean;
  tlsSettings: "EncryptionOnly" | "CertificateValidation" | "DomainValidation" | null;
  tlsDomain: string | null;
  isTransportRuleScoped: boolean;
  enabled: boolean;
}

export interface TransportRuleSpec {
  name: string;
  kind: "sclBypass" | "forceRoute";
  fromIPs: string[];
  routeViaConnector: string | null;
  priority: number | null;
}

export interface ConnectorTemplate {
  id: string;
  name: string;
  version: number;
  description: string;
  inbound: InboundConnectorSpec[];
  outbound: OutboundConnectorSpec[];
  transportRules: TransportRuleSpec[];
  /** Editable vendor data (IP ranges, cert names) referenced by placeholders. */
  data: Record<string, string[]>;
}

export type StagedObjectKind = "inboundConnector" | "outboundConnector" | "transportRule";

/** One row per tenant per connector object in the deployment staging grid. */
export interface StagedDeploymentRow {
  rowId: string;
  tenantId: string;
  tenantName: string;
  kind: StagedObjectKind;
  spec: InboundConnectorSpec | OutboundConnectorSpec | TransportRuleSpec;
  validation: StagingValidation;
  selected: boolean;
}

export interface StagingValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export type DryRunAction = "create" | "update" | "noop";

export interface DryRunDiff {
  rowId: string;
  tenantId: string;
  action: DryRunAction;
  fieldChanges: { field: string; from: unknown; to: unknown }[];
  powershellPreview: string;
}

export type DeploymentItemState =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "rolledBack";

export interface DeploymentItemStatus {
  rowId: string;
  tenantId: string;
  state: DeploymentItemState;
  error: string | null;
}

export interface DeploymentRecord {
  id: number;
  templateId: string;
  templateVersion: number;
  startedAt: string;
  finishedAt: string | null;
  startedBy: string;
  items: DeploymentItemStatus[];
}

export interface ConnectorInventoryRow {
  tenantId: string;
  tenantName: string;
  direction: ConnectorDirection;
  name: string;
  enabled: boolean;
  connectorType: string | null;
  lastChangedAt: string | null;
  templateId: string | null;
  drift: boolean;
}

export interface AuditLogEntry {
  id: number;
  at: string;
  who: string;
  tenantId: string;
  cmdlet: string;
  parameters: Record<string, unknown>;
  deploymentId: number | null;
  outcome: "ok" | "error";
  detail: string | null;
}

// ---------------------------------------------------------------------------
// Dashboard / misc
// ---------------------------------------------------------------------------

export interface EstateSummary {
  tenantCount: number;
  userCount: number;
  licensedUserCount: number;
  unassignedLicenses: number;
  tenantsWithSyncErrors: number;
  adminsWithoutMfa: number;
  externalForwardingMailboxes: number;
  domainsMissingDmarc: number;
}

export interface SearchResult {
  kind: "user" | "group" | "mailbox" | "domain" | "tenant";
  tenantId: string;
  tenantName: string;
  id: string;
  title: string;
  subtitle: string;
}

export interface AppSettings {
  clientId: string;
  partnerTenantId: string | null;
  syncConcurrency: number;
  defaultSyncSchedule: SyncSchedule;
  theme: "light" | "dark" | "system";
  appLockMinutes: number | null;
  largeBatchConfirmThreshold: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  // Microsoft Graph Command Line Tools — pre-consented first-party public client.
  clientId: "14d82eec-204b-4c2f-b7e8-296a70dab67e",
  partnerTenantId: null,
  syncConcurrency: 4,
  defaultSyncSchedule: "daily",
  theme: "system",
  appLockMinutes: null,
  largeBatchConfirmThreshold: 10,
};
