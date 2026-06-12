import { describe, expect, it } from "vitest";
import { hasConnectorWriteRole, validateRoles } from "./roles";
import type { GdapRoleAssignment } from "@shared/types";

const role = (name: string): GdapRoleAssignment => ({ roleTemplateId: name, roleName: name });

describe("validateRoles", () => {
  it("passes all read modules with Global Reader", () => {
    const result = validateRoles([role("Global Reader")], [
      "identity",
      "licensing",
      "groups",
      "domains",
      "exchange",
    ]);
    expect(result.ok).toBe(true);
    expect(result.shortfalls).toHaveLength(0);
  });

  it("names the missing role per module", () => {
    const result = validateRoles([role("Helpdesk Administrator")], ["identity"]);
    expect(result.ok).toBe(false);
    expect(result.shortfalls).toEqual([{ module: "identity", missingRole: "Global Reader" }]);
  });

  it("accepts Directory Readers for licensing", () => {
    const result = validateRoles([role("Directory Readers")], ["licensing"]);
    expect(result.ok).toBe(true);
  });

  it("flags surplus roles beyond enabled modules (least privilege)", () => {
    const result = validateRoles([role("Global Reader"), role("Intune Administrator")], ["identity"]);
    expect(result.surplus).toContain("Intune Administrator");
  });

  it("does not flag Exchange Administrator as surplus (connector writes)", () => {
    const result = validateRoles([role("Global Reader"), role("Exchange Administrator")], ["identity"]);
    expect(result.surplus).toHaveLength(0);
  });
});

describe("hasConnectorWriteRole", () => {
  it("requires Exchange Administrator or Global Administrator", () => {
    expect(hasConnectorWriteRole([role("Exchange Administrator")])).toBe(true);
    expect(hasConnectorWriteRole([role("Global Administrator")])).toBe(true);
    expect(hasConnectorWriteRole([role("Global Reader")])).toBe(false);
  });
});
