import { authService } from "../auth/authService";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const MAX_RETRIES = 5;

/**
 * Minimal Graph client: per-tenant token acquisition, automatic paging
 * via @odata.nextLink, and 429 handling honouring Retry-After with
 * exponential backoff.
 */
export class GraphClient {
  constructor(private readonly tenantId: string | null) {}

  async get<T>(pathOrUrl: string): Promise<T> {
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${GRAPH_BASE}${pathOrUrl}`;
    for (let attempt = 0; ; attempt++) {
      const token = await authService.getTokenForTenant(this.tenantId);
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, ConsistencyLevel: "eventual" },
      });
      if (res.status === 429 || res.status === 503) {
        if (attempt >= MAX_RETRIES) {
          throw new Error(`Graph throttled after ${MAX_RETRIES} retries: ${url}`);
        }
        const retryAfter = Number(res.headers.get("Retry-After") ?? "0");
        const backoff = Math.max(retryAfter * 1000, 2 ** attempt * 1000);
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new GraphError(res.status, `${res.status} ${res.statusText} for ${url}: ${body}`);
      }
      return (await res.json()) as T;
    }
  }

  /** Follow @odata.nextLink until exhausted. */
  async getAll<T>(path: string): Promise<T[]> {
    const items: T[] = [];
    let url: string | null = path;
    while (url) {
      const page: { value: T[]; "@odata.nextLink"?: string } = await this.get(url);
      items.push(...page.value);
      url = page["@odata.nextLink"] ?? null;
    }
    return items;
  }
}

export class GraphError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** 403 typically means the GDAP role for this data is missing — not assessable. */
export function isPermissionError(e: unknown): boolean {
  return e instanceof GraphError && (e.status === 403 || e.status === 401);
}
