import { resolveTxt, resolveCname } from "node:dns/promises";
import type { DnsCheckResult } from "@shared/types";

async function txt(name: string): Promise<string[]> {
  try {
    const records = await resolveTxt(name);
    return records.map((chunks) => chunks.join(""));
  } catch {
    return [];
  }
}

export async function checkSpf(domain: string): Promise<DnsCheckResult> {
  const records = (await txt(domain)).filter((r) => r.toLowerCase().startsWith("v=spf1"));
  if (records.length === 0) {
    return { health: "fail", detail: "No SPF record found", record: null };
  }
  if (records.length > 1) {
    return {
      health: "fail",
      detail: `Multiple SPF records (${records.length}) — invalid per RFC 7208`,
      record: records.join(" | "),
    };
  }
  const record = records[0];
  if (/\+all/i.test(record)) {
    return { health: "fail", detail: "SPF ends in +all (allows any sender)", record };
  }
  if (/\?all/i.test(record)) {
    return { health: "warn", detail: "SPF ends in ?all (neutral)", record };
  }
  return { health: "pass", detail: "Single valid SPF record", record };
}

export async function checkDmarc(domain: string): Promise<DnsCheckResult> {
  const records = (await txt(`_dmarc.${domain}`)).filter((r) =>
    r.toLowerCase().startsWith("v=dmarc1"),
  );
  if (records.length === 0) {
    return { health: "fail", detail: "No DMARC record found", record: null };
  }
  const record = records[0];
  const policy = /p=(\w+)/i.exec(record)?.[1]?.toLowerCase() ?? "none";
  if (policy === "none") {
    return { health: "warn", detail: "DMARC present but p=none (monitor only)", record };
  }
  return { health: "pass", detail: `DMARC enforced (p=${policy})`, record };
}

/** Microsoft 365 DKIM uses selector1/selector2 CNAMEs to onmicrosoft.com. */
export async function checkDkim(domain: string): Promise<DnsCheckResult> {
  const selectors = ["selector1", "selector2"];
  const found: string[] = [];
  for (const selector of selectors) {
    try {
      const cnames = await resolveCname(`${selector}._domainkey.${domain}`);
      if (cnames.length > 0) found.push(`${selector}→${cnames[0]}`);
    } catch {
      /* missing selector */
    }
  }
  if (found.length === 2) {
    return { health: "pass", detail: "Both DKIM selector CNAMEs resolve", record: found.join(", ") };
  }
  if (found.length === 1) {
    return { health: "warn", detail: "Only one DKIM selector CNAME resolves", record: found[0] };
  }
  return { health: "fail", detail: "DKIM selector CNAMEs not found", record: null };
}
