import type {
  InboundConnectorSpec,
  OutboundConnectorSpec,
  TransportRuleSpec,
} from "@shared/types";

/**
 * Translates staged specs into Exchange Online cmdlet invocations.
 * The same strings serve as the engineer-reviewable PowerShell preview
 * and (joined into a script) the executed deployment — what you review
 * is exactly what runs.
 */

const q = (s: string): string => `'${s.replace(/'/g, "''")}'`;
const arr = (xs: string[]): string => xs.map(q).join(",");

export function buildInboundConnector(spec: InboundConnectorSpec, update: boolean): string {
  const cmdlet = update ? "Set-InboundConnector -Identity" : "New-InboundConnector -Name";
  const parts = [
    `${cmdlet} ${q(spec.name)}`,
    `-Comment ${q(spec.comment)}`,
    ...(update ? [] : [`-ConnectorType ${spec.connectorType}`]),
    spec.senderDomains.length > 0 ? `-SenderDomains ${arr(spec.senderDomains)}` : null,
    spec.senderIPAddresses.length > 0 ? `-SenderIPAddresses ${arr(spec.senderIPAddresses)}` : null,
    `-RequireTls $${spec.requireTls}`,
    spec.tlsSenderCertificateName ? `-TlsSenderCertificateName ${q(spec.tlsSenderCertificateName)}` : null,
    `-RestrictDomainsToIPAddresses $${spec.restrictDomainsToIPAddresses}`,
    `-RestrictDomainsToCertificate $${spec.restrictDomainsToCertificate}`,
    `-Enabled $${spec.enabled}`,
  ];
  let cmd = parts.filter((p) => p !== null).join(" `\n  ");

  if (spec.enhancedFiltering) {
    const ef = spec.enhancedFiltering;
    const efParts = [
      `Set-InboundConnector -Identity ${q(spec.name)}`,
      ef.efSkipLastIP ? `-EFSkipLastIP $true` : null,
      ef.efSkipIPs.length > 0 ? `-EFSkipIPs ${arr(ef.efSkipIPs)}` : null,
      ef.efUsers.length > 0 ? `-EFUsers ${arr(ef.efUsers)}` : null,
      `-EFTestMode $${ef.efTestMode}`,
    ];
    cmd += "\n" + efParts.filter((p) => p !== null).join(" `\n  ");
  }
  return cmd;
}

export function buildOutboundConnector(spec: OutboundConnectorSpec, update: boolean): string {
  const cmdlet = update ? "Set-OutboundConnector -Identity" : "New-OutboundConnector -Name";
  const parts = [
    `${cmdlet} ${q(spec.name)}`,
    `-Comment ${q(spec.comment)}`,
    spec.useMXRecord ? `-UseMXRecord $true` : null,
    spec.smartHosts.length > 0 ? `-SmartHosts ${arr(spec.smartHosts)}` : null,
    spec.allAcceptedDomains
      ? `-AllAcceptedDomains $true`
      : spec.recipientDomains.length > 0
        ? `-RecipientDomains ${arr(spec.recipientDomains)}`
        : null,
    spec.tlsSettings ? `-TlsSettings ${spec.tlsSettings}` : null,
    spec.tlsDomain ? `-TlsDomain ${q(spec.tlsDomain)}` : null,
    `-IsTransportRuleScoped $${spec.isTransportRuleScoped}`,
    `-Enabled $${spec.enabled}`,
  ];
  return parts.filter((p) => p !== null).join(" `\n  ");
}

export function buildTransportRule(spec: TransportRuleSpec, update: boolean): string {
  const cmdlet = update ? "Set-TransportRule -Identity" : "New-TransportRule -Name";
  if (spec.kind === "sclBypass") {
    const parts = [
      `${cmdlet} ${q(spec.name)}`,
      spec.fromIPs.length > 0 ? `-SenderIpRanges ${arr(spec.fromIPs)}` : null,
      `-SetSCL -1`,
      spec.priority !== null ? `-Priority ${spec.priority}` : null,
    ];
    return parts.filter((p) => p !== null).join(" `\n  ");
  }
  const parts = [
    `${cmdlet} ${q(spec.name)}`,
    spec.fromIPs.length > 0 ? `-SenderIpRanges ${arr(spec.fromIPs)}` : null,
    spec.routeViaConnector ? `-RouteMessageOutboundConnector ${q(spec.routeViaConnector)}` : null,
    spec.priority !== null ? `-Priority ${spec.priority}` : null,
  ];
  return parts.filter((p) => p !== null).join(" `\n  ");
}

export function buildRemoval(kind: string, name: string): string {
  switch (kind) {
    case "inboundConnector":
      return `Remove-InboundConnector -Identity ${q(name)} -Confirm:$false`;
    case "outboundConnector":
      return `Remove-OutboundConnector -Identity ${q(name)} -Confirm:$false`;
    case "transportRule":
      return `Remove-TransportRule -Identity ${q(name)} -Confirm:$false`;
    default:
      throw new Error(`Unknown kind ${kind}`);
  }
}

export const READ_STATE_SCRIPT = `
$state = [pscustomobject]@{
  inbound  = @(Get-InboundConnector | Select-Object Name,Enabled,ConnectorType,SenderDomains,SenderIPAddresses,RequireTls,TlsSenderCertificateName,RestrictDomainsToIPAddresses,RestrictDomainsToCertificate,EFSkipLastIP,EFSkipIPs,EFUsers,EFTestMode,Comment,WhenChanged)
  outbound = @(Get-OutboundConnector | Select-Object Name,Enabled,SmartHosts,UseMXRecord,RecipientDomains,AllAcceptedDomains,TlsSettings,TlsDomain,IsTransportRuleScoped,Comment,WhenChanged)
  rules    = @(Get-TransportRule | Select-Object Name,State,Priority,SenderIpRanges,SetSCL,RouteMessageOutboundConnector,Comments,WhenChanged)
}
$state | ConvertTo-Json -Depth 6
`;
