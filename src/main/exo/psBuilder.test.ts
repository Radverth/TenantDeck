import { describe, expect, it } from "vitest";
import {
  buildInboundConnector,
  buildOutboundConnector,
  buildRemoval,
  buildTransportRule,
} from "./psBuilder";
import type { InboundConnectorSpec, OutboundConnectorSpec, TransportRuleSpec } from "@shared/types";

const relay: InboundConnectorSpec = {
  name: "TenantDeck SMTP Relay",
  comment: "Deployed by TenantDeck — template smtp-relay v1",
  connectorType: "OnPremises",
  senderDomains: ["*"],
  senderIPAddresses: ["203.0.113.10", "203.0.113.0/28"],
  requireTls: false,
  tlsSenderCertificateName: null,
  restrictDomainsToIPAddresses: true,
  restrictDomainsToCertificate: false,
  enabled: true,
  enhancedFiltering: null,
};

describe("buildInboundConnector", () => {
  it("generates New-InboundConnector with IP restriction", () => {
    const ps = buildInboundConnector(relay, false);
    expect(ps).toContain("New-InboundConnector -Name 'TenantDeck SMTP Relay'");
    expect(ps).toContain("-ConnectorType OnPremises");
    expect(ps).toContain("-SenderIPAddresses '203.0.113.10','203.0.113.0/28'");
    expect(ps).toContain("-RestrictDomainsToIPAddresses $true");
    expect(ps).toContain("-Enabled $true");
  });

  it("uses Set-InboundConnector for updates and omits ConnectorType", () => {
    const ps = buildInboundConnector(relay, true);
    expect(ps).toContain("Set-InboundConnector -Identity");
    expect(ps).not.toContain("-ConnectorType");
  });

  it("appends Enhanced Filtering as a follow-up Set call", () => {
    const ps = buildInboundConnector(
      {
        ...relay,
        enhancedFiltering: { efSkipLastIP: true, efSkipIPs: [], efUsers: [], efTestMode: true },
      },
      false,
    );
    expect(ps).toContain("-EFSkipLastIP $true");
    expect(ps).toContain("-EFTestMode $true");
  });

  it("escapes single quotes in names", () => {
    const ps = buildInboundConnector({ ...relay, name: "O'Brien Relay" }, false);
    expect(ps).toContain("'O''Brien Relay'");
  });
});

describe("buildOutboundConnector", () => {
  it("generates smart host routing with TLS", () => {
    const spec: OutboundConnectorSpec = {
      name: "Smart Host",
      comment: "c",
      smartHosts: ["smtp.gateway.example"],
      useMXRecord: false,
      recipientDomains: [],
      allAcceptedDomains: true,
      tlsSettings: "EncryptionOnly",
      tlsDomain: null,
      isTransportRuleScoped: false,
      enabled: true,
    };
    const ps = buildOutboundConnector(spec, false);
    expect(ps).toContain("-SmartHosts 'smtp.gateway.example'");
    expect(ps).toContain("-AllAcceptedDomains $true");
    expect(ps).toContain("-TlsSettings EncryptionOnly");
  });
});

describe("buildTransportRule", () => {
  it("generates an SCL -1 bypass rule scoped to gateway IPs", () => {
    const spec: TransportRuleSpec = {
      name: "Gateway SCL Bypass",
      kind: "sclBypass",
      fromIPs: ["198.51.100.0/24"],
      routeViaConnector: null,
      priority: 0,
    };
    const ps = buildTransportRule(spec, false);
    expect(ps).toContain("-SenderIpRanges '198.51.100.0/24'");
    expect(ps).toContain("-SetSCL -1");
    expect(ps).toContain("-Priority 0");
  });
});

describe("buildRemoval", () => {
  it("removes by kind without confirmation prompts", () => {
    expect(buildRemoval("inboundConnector", "X")).toBe(
      "Remove-InboundConnector -Identity 'X' -Confirm:$false",
    );
    expect(buildRemoval("transportRule", "Y")).toContain("Remove-TransportRule");
  });
});
