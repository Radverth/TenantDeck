/** Schema v1. All tenant-scoped tables are keyed by tenant_id. */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tenants (
  tenant_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  default_domain TEXT NOT NULL,
  internal_client_code TEXT,
  enabled_modules TEXT NOT NULL,          -- JSON array of TenantModule
  sync_schedule TEXT NOT NULL DEFAULT 'daily',
  gdap_roles TEXT NOT NULL DEFAULT '[]',  -- JSON array of {roleTemplateId, roleName}
  status TEXT NOT NULL DEFAULT 'linked',
  last_sync_at TEXT,
  last_sync_error TEXT,
  notes TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  user_principal_name TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  account_enabled INTEGER NOT NULL DEFAULT 1,
  licensed INTEGER NOT NULL DEFAULT 0,
  admin_roles TEXT NOT NULL DEFAULT '[]',
  mfa_registered INTEGER,                 -- null = unknown / not assessable
  last_sign_in_at TEXT,
  created_at TEXT,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_users_upn ON users (user_principal_name);

CREATE TABLE IF NOT EXISTS license_skus (
  tenant_id TEXT NOT NULL,
  sku_id TEXT NOT NULL,
  sku_part_number TEXT NOT NULL,
  friendly_name TEXT NOT NULL,
  purchased INTEGER NOT NULL DEFAULT 0,
  assigned INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, sku_id)
);

CREATE TABLE IF NOT EXISTS groups (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  group_type TEXT NOT NULL,
  is_team INTEGER NOT NULL DEFAULT 0,
  visibility TEXT,
  owner_count INTEGER NOT NULL DEFAULT 0,
  member_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS domains (
  tenant_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  is_verified INTEGER NOT NULL DEFAULT 0,
  spf TEXT NOT NULL DEFAULT '{"health":"unknown","detail":"","record":null}',
  dkim TEXT NOT NULL DEFAULT '{"health":"unknown","detail":"","record":null}',
  dmarc TEXT NOT NULL DEFAULT '{"health":"unknown","detail":"","record":null}',
  PRIMARY KEY (tenant_id, domain)
);

CREATE TABLE IF NOT EXISTS mailboxes (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  user_principal_name TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  mailbox_type TEXT NOT NULL DEFAULT 'unknown',
  size_bytes INTEGER,
  quota_bytes INTEGER,
  forwarding_smtp_address TEXT,
  external_forwarding INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS exo_connectors (
  tenant_id TEXT NOT NULL,
  direction TEXT NOT NULL,                -- inbound | outbound
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  connector_type TEXT,
  raw TEXT NOT NULL DEFAULT '{}',         -- normalised cmdlet output JSON
  template_id TEXT,
  last_changed_at TEXT,
  drift INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, direction, name)
);

CREATE TABLE IF NOT EXISTS exo_transport_rules (
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  priority INTEGER,
  raw TEXT NOT NULL DEFAULT '{}',
  template_id TEXT,
  PRIMARY KEY (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  taken_at TEXT NOT NULL,
  kind TEXT NOT NULL,                     -- 'connector_state' | 'config'
  payload TEXT NOT NULL,                  -- normalised JSON snapshot
  deployment_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_snapshots_tenant ON snapshots (tenant_id, taken_at);

CREATE TABLE IF NOT EXISTS sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  state TEXT NOT NULL,
  error TEXT,
  entity_counts TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS audit_checks (
  id TEXT PRIMARY KEY,
  definition TEXT NOT NULL,               -- full CheckDefinition JSON
  enabled INTEGER NOT NULL DEFAULT 1,
  builtin INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS audit_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  tenant_count INTEGER NOT NULL DEFAULT 0,
  finding_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS audit_findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  tenant_id TEXT NOT NULL,
  check_id TEXT NOT NULL,
  outcome TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  evidence TEXT NOT NULL DEFAULT '[]',
  observed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_findings_run ON audit_findings (run_id);
CREATE INDEX IF NOT EXISTS idx_findings_tenant ON audit_findings (tenant_id);

CREATE TABLE IF NOT EXISTS tenant_scores (
  tenant_id TEXT NOT NULL,
  run_id INTEGER NOT NULL,
  score REAL NOT NULL,
  pass_count INTEGER NOT NULL,
  warn_count INTEGER NOT NULL,
  fail_count INTEGER NOT NULL,
  not_assessable_count INTEGER NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, run_id)
);

CREATE TABLE IF NOT EXISTS connector_templates (
  id TEXT PRIMARY KEY,
  template TEXT NOT NULL                  -- full ConnectorTemplate JSON
);

CREATE TABLE IF NOT EXISTS deployments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id TEXT NOT NULL,
  template_version INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  started_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deployment_items (
  deployment_id INTEGER NOT NULL,
  row_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  spec TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  PRIMARY KEY (deployment_id, row_id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  who TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  cmdlet TEXT NOT NULL,
  parameters TEXT NOT NULL DEFAULT '{}',
  deployment_id INTEGER,
  outcome TEXT NOT NULL,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_log_tenant ON audit_log (tenant_id, at);
`;
