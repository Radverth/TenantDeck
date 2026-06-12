/**
 * SKU part number → friendly name map (common subset; unknown SKUs fall back
 * to the part number). Extend freely — data only, no code changes needed.
 */
export const SKU_FRIENDLY_NAMES: Record<string, string> = {
  O365_BUSINESS_ESSENTIALS: "Microsoft 365 Business Basic",
  O365_BUSINESS_PREMIUM: "Microsoft 365 Business Standard",
  SPB: "Microsoft 365 Business Premium",
  O365_BUSINESS: "Microsoft 365 Apps for Business",
  OFFICESUBSCRIPTION: "Microsoft 365 Apps for Enterprise",
  STANDARDPACK: "Office 365 E1",
  ENTERPRISEPACK: "Office 365 E3",
  ENTERPRISEPREMIUM: "Office 365 E5",
  SPE_E3: "Microsoft 365 E3",
  SPE_E5: "Microsoft 365 E5",
  SPE_F1: "Microsoft 365 F3",
  EXCHANGESTANDARD: "Exchange Online (Plan 1)",
  EXCHANGEENTERPRISE: "Exchange Online (Plan 2)",
  EXCHANGEDESKLESS: "Exchange Online Kiosk",
  EMS: "Enterprise Mobility + Security E3",
  EMSPREMIUM: "Enterprise Mobility + Security E5",
  AAD_PREMIUM: "Microsoft Entra ID P1",
  AAD_PREMIUM_P2: "Microsoft Entra ID P2",
  ATP_ENTERPRISE: "Defender for Office 365 (Plan 1)",
  THREAT_INTELLIGENCE: "Defender for Office 365 (Plan 2)",
  INTUNE_A: "Microsoft Intune Plan 1",
  MCOMEETADV: "Audio Conferencing",
  MCOEV: "Teams Phone Standard",
  PHONESYSTEM_VIRTUALUSER: "Teams Phone Resource Account",
  MCOPSTN1: "Calling Plan (Domestic)",
  POWER_BI_STANDARD: "Power BI (Free)",
  POWER_BI_PRO: "Power BI Pro",
  PROJECTPROFESSIONAL: "Project Plan 3",
  VISIOCLIENT: "Visio Plan 2",
  WINDOWS_STORE: "Windows Store for Business",
  RIGHTSMANAGEMENT: "Azure Information Protection P1",
  DESKLESSPACK: "Office 365 F3",
  MICROSOFT_BUSINESS_CENTER: "Microsoft Business Center",
  TEAMS_EXPLORATORY: "Teams Exploratory",
  STREAM: "Microsoft Stream",
  FLOW_FREE: "Power Automate Free",
  POWERAPPS_VIRAL: "Power Apps Plan (Trial)",
};

export function skuFriendlyName(partNumber: string): string {
  return SKU_FRIENDLY_NAMES[partNumber] ?? partNumber;
}
