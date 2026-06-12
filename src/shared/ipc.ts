import type {
  AppSettings,
  AuditFinding,
  AuditLogEntry,
  AuditRunSummary,
  AuthStatus,
  CheckDefinition,
  CommitResult,
  ConnectorInventoryRow,
  ConnectorTemplate,
  DeploymentRecord,
  DiscoveredTenant,
  DomainRow,
  DryRunDiff,
  EstateSummary,
  GroupRow,
  LicenseSkuRow,
  MailboxRow,
  SearchResult,
  StagedDeploymentRow,
  SyncProgressEvent,
  TenantEdit,
  TenantRecord,
  TenantScore,
  TenantSyncStatus,
  UserRow,
} from "./types";

/**
 * Request/response contract for every IPC channel.
 * Main registers a handler per key; the preload exposes a typed invoke.
 */
export interface IpcContract {
  // Auth
  "auth:status": { req: void; res: AuthStatus };
  "auth:signIn": { req: void; res: AuthStatus };
  "auth:signOut": { req: void; res: void };

  // Tenant registry
  "registry:discover": { req: void; res: DiscoveredTenant[] };
  "registry:list": { req: void; res: TenantRecord[] };
  "registry:commit": {
    req: { tenants: { tenant: DiscoveredTenant; edit: TenantEdit }[] };
    res: CommitResult;
  };
  "registry:update": {
    req: { tenantIds: string[]; edit: TenantEdit };
    res: TenantRecord[];
  };
  "registry:remove": { req: { tenantIds: string[] }; res: void };
  "registry:purgeData": { req: { tenantIds: string[] | null }; res: void };

  // Sync
  "sync:run": { req: { tenantIds: string[] | null }; res: void };
  "sync:status": { req: void; res: TenantSyncStatus[] };

  // Directory data
  "data:users": { req: { tenantIds?: string[] }; res: UserRow[] };
  "data:licenses": { req: { tenantIds?: string[] }; res: LicenseSkuRow[] };
  "data:groups": { req: { tenantIds?: string[] }; res: GroupRow[] };
  "data:domains": { req: { tenantIds?: string[] }; res: DomainRow[] };
  "data:mailboxes": { req: { tenantIds?: string[] }; res: MailboxRow[] };
  "data:summary": { req: void; res: EstateSummary };
  "data:search": { req: { query: string }; res: SearchResult[] };

  // Audit engine
  "audit:checks": { req: void; res: CheckDefinition[] };
  "audit:setCheckEnabled": { req: { checkId: string; enabled: boolean }; res: void };
  "audit:addCustomCheck": { req: { check: CheckDefinition }; res: void };
  "audit:run": { req: { tenantIds: string[] | null }; res: AuditRunSummary };
  "audit:findings": {
    req: { tenantIds?: string[]; runId?: number };
    res: AuditFinding[];
  };
  "audit:scores": { req: void; res: TenantScore[] };

  // Connector deployment
  "connectors:templates": { req: void; res: ConnectorTemplate[] };
  "connectors:saveTemplate": { req: { template: ConnectorTemplate }; res: void };
  "connectors:stage": {
    req: { templateId: string; tenantIds: string[] };
    res: StagedDeploymentRow[];
  };
  "connectors:validate": {
    req: { rows: StagedDeploymentRow[] };
    res: StagedDeploymentRow[];
  };
  "connectors:dryRun": { req: { rows: StagedDeploymentRow[] }; res: DryRunDiff[] };
  "connectors:deploy": {
    req: {
      rows: StagedDeploymentRow[];
      templateId: string;
      stageDisabled: boolean;
      efTestMode: boolean;
      confirmedTenantCount: number | null;
    };
    res: DeploymentRecord;
  };
  "connectors:rollback": { req: { deploymentId: number; tenantId: string }; res: void };
  "connectors:inventory": { req: void; res: ConnectorInventoryRow[] };
  "connectors:deployments": { req: void; res: DeploymentRecord[] };
  "connectors:auditLog": { req: { tenantId?: string }; res: AuditLogEntry[] };

  // Settings
  "settings:get": { req: void; res: AppSettings };
  "settings:set": { req: { settings: Partial<AppSettings> }; res: AppSettings };

  // Export
  "export:csv": {
    req: { filename: string; headers: string[]; rows: (string | number | boolean | null)[][] };
    res: { savedTo: string | null };
  };
}

export type IpcChannel = keyof IpcContract;
export type IpcRequest<C extends IpcChannel> = IpcContract[C]["req"];
export type IpcResponse<C extends IpcChannel> = IpcContract[C]["res"];

/** Push events main → renderer. */
export interface IpcEvents {
  "event:syncProgress": SyncProgressEvent;
  "event:authChanged": AuthStatus;
}

export type IpcEventChannel = keyof IpcEvents;

/** Shape of the API the preload exposes on window.tenantdeck. */
export interface TenantDeckApi {
  invoke<C extends IpcChannel>(channel: C, req: IpcRequest<C>): Promise<IpcResponse<C>>;
  on<E extends IpcEventChannel>(
    channel: E,
    listener: (payload: IpcEvents[E]) => void,
  ): () => void;
}
