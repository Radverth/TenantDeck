import type { RoleValidationResult, TenantModule, GdapRoleAssignment } from "@shared/types";

/** Entra role template IDs → display names (subset relevant to GDAP MSP work). */
export const GDAP_ROLE_NAMES: Record<string, string> = {
  "62e90394-69f5-4237-9190-012177145e10": "Global Administrator",
  "f2ef992c-3afb-46b9-b7cf-a126ee74c451": "Global Reader",
  "29232cdf-9323-42fd-ade2-1d097af3e4de": "Exchange Administrator",
  "88d8e3e3-8f55-4a1e-953a-9b9898b8876b": "Directory Readers",
  "4a5d8f65-41da-4de4-8968-e035b65339cf": "Reports Reader",
  "729827e3-9c14-49f7-bb1b-9608f156bbb8": "Helpdesk Administrator",
  "fe930be7-5e62-47db-91af-98c3a49a38b1": "User Administrator",
  "194ae4cb-b126-40b2-bd5b-6091b380977d": "Security Administrator",
  "5d6b6bb7-de71-4623-b4af-96380a352509": "Security Reader",
  "966707d0-3269-4727-9be2-8c3a10f19b9d": "Password Administrator",
  "69091246-20e8-4a56-aa4d-066075b2a7a8": "Teams Administrator",
  "75941009-915a-4869-abe7-691bff18279e": "Skype for Business Administrator",
  "744ec460-397e-42ad-a462-8b3f9747a02c": "Knowledge Administrator",
  "11648597-926c-4cf3-9c36-bcebb0ba8dcc": "Power Platform Administrator",
  "3a2c62db-5318-420d-8d74-23affee5d9d5": "Intune Administrator",
  "158c047a-c907-4556-b7ef-446551a6b5f7": "Cloud Application Administrator",
};

const GLOBAL_READER = "Global Reader";
const GLOBAL_ADMIN = "Global Administrator";
const EXCHANGE_ADMIN = "Exchange Administrator";
const DIRECTORY_READERS = "Directory Readers";

/** Roles that satisfy each module's read requirements (any one suffices). */
const MODULE_READ_ROLES: Record<TenantModule, string[]> = {
  identity: [GLOBAL_READER, GLOBAL_ADMIN],
  licensing: [GLOBAL_READER, GLOBAL_ADMIN, DIRECTORY_READERS],
  groups: [GLOBAL_READER, GLOBAL_ADMIN],
  domains: [GLOBAL_READER, GLOBAL_ADMIN],
  exchange: [GLOBAL_READER, GLOBAL_ADMIN, EXCHANGE_ADMIN],
};

export const CONNECTOR_WRITE_ROLES = [EXCHANGE_ADMIN, GLOBAL_ADMIN];

/**
 * Pre-flight validation: are the GDAP roles sufficient for the enabled
 * modules, and is anything granted beyond what those modules need?
 */
export function validateRoles(
  roles: GdapRoleAssignment[],
  enabledModules: TenantModule[],
): RoleValidationResult {
  const granted = new Set(roles.map((r) => r.roleName));
  const shortfalls: RoleValidationResult["shortfalls"] = [];
  const needed = new Set<string>();

  for (const module of enabledModules) {
    const accepted = MODULE_READ_ROLES[module];
    accepted.forEach((r) => needed.add(r));
    if (!accepted.some((r) => granted.has(r))) {
      shortfalls.push({ module, missingRole: accepted[0] });
    }
  }

  const surplus = [...granted].filter(
    (r) => !needed.has(r) && !CONNECTOR_WRITE_ROLES.includes(r),
  );

  return { ok: shortfalls.length === 0, shortfalls, surplus };
}

export function hasConnectorWriteRole(roles: GdapRoleAssignment[]): boolean {
  const granted = new Set(roles.map((r) => r.roleName));
  return CONNECTOR_WRITE_ROLES.some((r) => granted.has(r));
}
