import { getDb } from "../db/database";
import type { ConnectorTemplate } from "@shared/types";

/**
 * Starter templates. Placeholders like {tenant.defaultDomain} resolve from
 * registry data at staging time; entries under `data` (vendor IP ranges,
 * cert names) are editable data files in spirit — change once, redeploy
 * estate-wide.
 */
export const STARTER_TEMPLATES: ConnectorTemplate[] = [
  {
    id: "smtp-relay",
    name: "SMTP relay / application sending",
    version: 1,
    description:
      "Inbound OnPremises connector restricted to client static IPs for printers, scanners and LOB apps.",
    inbound: [
      {
        name: "TenantDeck SMTP Relay",
        comment: "Deployed by TenantDeck — template smtp-relay v1",
        connectorType: "OnPremises",
        senderDomains: ["*"],
        senderIPAddresses: [],
        requireTls: false,
        tlsSenderCertificateName: null,
        restrictDomainsToIPAddresses: true,
        restrictDomainsToCertificate: false,
        enabled: true,
        enhancedFiltering: null,
      },
    ],
    outbound: [],
    transportRules: [],
    data: { clientRelayIPs: [] },
  },
  {
    id: "email-gateway",
    name: "Email security gateway (generic)",
    version: 1,
    description:
      "Inbound partner connector restricted to gateway IPs, Enhanced Filtering skip-list and SCL -1 bypass rule. Optional outbound smart host.",
    inbound: [
      {
        name: "TenantDeck Gateway Inbound",
        comment: "Deployed by TenantDeck — template email-gateway v1",
        connectorType: "Partner",
        senderDomains: ["*"],
        senderIPAddresses: ["{data.gatewayIPs}"],
        requireTls: true,
        tlsSenderCertificateName: null,
        restrictDomainsToIPAddresses: true,
        restrictDomainsToCertificate: false,
        enabled: true,
        enhancedFiltering: {
          efSkipLastIP: true,
          efSkipIPs: [],
          efUsers: [],
          efTestMode: true,
        },
      },
    ],
    outbound: [],
    transportRules: [
      {
        name: "TenantDeck Gateway SCL Bypass",
        kind: "sclBypass",
        fromIPs: ["{data.gatewayIPs}"],
        routeViaConnector: null,
        priority: 0,
      },
    ],
    data: { gatewayIPs: [] },
  },
  {
    id: "outbound-smarthost",
    name: "Outbound smart host",
    version: 1,
    description:
      "Outbound connector routing all recipient domains via specified smart hosts with mandatory TLS.",
    inbound: [],
    outbound: [
      {
        name: "TenantDeck Outbound Smart Host",
        comment: "Deployed by TenantDeck — template outbound-smarthost v1",
        smartHosts: ["{data.smartHosts}"],
        useMXRecord: false,
        recipientDomains: [],
        allAcceptedDomains: true,
        tlsSettings: "EncryptionOnly",
        tlsDomain: null,
        isTransportRuleScoped: false,
        enabled: true,
      },
    ],
    transportRules: [],
    data: { smartHosts: [] },
  },
  {
    id: "hybrid-mailflow",
    name: "Hybrid / on-premises mail flow",
    version: 1,
    description:
      "Inbound and outbound OnPremises connector pair with TLS certificate matching for hybrid coexistence.",
    inbound: [
      {
        name: "TenantDeck Hybrid Inbound",
        comment: "Deployed by TenantDeck — template hybrid-mailflow v1",
        connectorType: "OnPremises",
        senderDomains: ["*"],
        senderIPAddresses: [],
        requireTls: true,
        tlsSenderCertificateName: "{data.hybridCertName}",
        restrictDomainsToIPAddresses: false,
        restrictDomainsToCertificate: true,
        enabled: true,
        enhancedFiltering: null,
      },
    ],
    outbound: [
      {
        name: "TenantDeck Hybrid Outbound",
        comment: "Deployed by TenantDeck — template hybrid-mailflow v1",
        smartHosts: ["{data.onPremSmartHost}"],
        useMXRecord: false,
        recipientDomains: ["{tenant.defaultDomain}"],
        allAcceptedDomains: false,
        tlsSettings: "DomainValidation",
        tlsDomain: "{data.hybridCertName}",
        isTransportRuleScoped: false,
        enabled: true,
      },
    ],
    transportRules: [],
    data: { hybridCertName: [], onPremSmartHost: [] },
  },
];

export function ensureTemplatesSeeded(): void {
  const db = getDb();
  const ins = db.prepare(
    "INSERT INTO connector_templates (id, template) VALUES (?, ?) ON CONFLICT(id) DO NOTHING",
  );
  const tx = db.transaction(() => {
    for (const t of STARTER_TEMPLATES) ins.run(t.id, JSON.stringify(t));
  });
  tx();
}

export function listTemplates(): ConnectorTemplate[] {
  const rows = getDb().prepare("SELECT template FROM connector_templates").all() as {
    template: string;
  }[];
  return rows.map((r) => JSON.parse(r.template));
}

export function saveTemplate(template: ConnectorTemplate): void {
  getDb()
    .prepare(
      "INSERT INTO connector_templates (id, template) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET template = excluded.template",
    )
    .run(template.id, JSON.stringify(template));
}
