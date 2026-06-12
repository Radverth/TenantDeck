import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke, onEvent } from "./api";
import type { SearchResult } from "@shared/types";
import Dashboard from "./screens/Dashboard";
import TenantRegistry from "./screens/TenantRegistry";
import Audit from "./screens/Audit";
import Connectors from "./screens/Connectors";
import Users from "./screens/Users";
import Licensing from "./screens/Licensing";
import Groups from "./screens/Groups";
import Domains from "./screens/Domains";
import Exchange from "./screens/Exchange";
import Reports from "./screens/Reports";
import Settings from "./screens/Settings";

const SCREENS = [
  { id: "dashboard", label: "Dashboard", component: Dashboard },
  { id: "registry", label: "Tenant Registry", component: TenantRegistry },
  { id: "audit", label: "Audit", component: Audit },
  { id: "connectors", label: "Connector Deployment", component: Connectors },
  { id: "users", label: "Users", component: Users },
  { id: "licensing", label: "Licensing", component: Licensing },
  { id: "groups", label: "Groups & Teams", component: Groups },
  { id: "domains", label: "Domains", component: Domains },
  { id: "exchange", label: "Exchange", component: Exchange },
  { id: "reports", label: "Reports", component: Reports },
  { id: "settings", label: "Settings", component: Settings },
] as const;

type ScreenId = (typeof SCREENS)[number]["id"];

export default function App(): ReactNode {
  const [screen, setScreen] = useState<ScreenId>("dashboard");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const queryClient = useQueryClient();

  const { data: auth } = useQuery({
    queryKey: ["auth"],
    queryFn: () => invoke("auth:status", undefined),
  });

  useEffect(() => {
    const offAuth = onEvent("event:authChanged", () => {
      void queryClient.invalidateQueries({ queryKey: ["auth"] });
    });
    const offSync = onEvent("event:syncProgress", () => {
      void queryClient.invalidateQueries({ queryKey: ["syncStatus"] });
    });
    return () => {
      offAuth();
      offSync();
    };
  }, [queryClient]);

  useEffect(() => {
    if (searchQuery.trim().length < 2) {
      setSearchResults(null);
      return;
    }
    const handle = setTimeout(async () => {
      setSearchResults(await invoke("data:search", { query: searchQuery.trim() }));
    }, 200);
    return () => clearTimeout(handle);
  }, [searchQuery]);

  const Active = SCREENS.find((s) => s.id === screen)!.component;

  return (
    <>
      <aside className="sidebar">
        <div className="brand">
          Tenant<span>Deck</span>
        </div>
        <nav>
          {SCREENS.map((s) => (
            <button
              key={s.id}
              className={s.id === screen ? "active" : ""}
              onClick={() => setScreen(s.id)}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <div className="account">
          {auth?.signedIn ? (
            <>
              <div>{auth.account?.username}</div>
              <button className="btn" style={{ marginTop: 6 }} onClick={() => invoke("auth:signOut", undefined)}>
                Sign out
              </button>
            </>
          ) : (
            <button className="btn accent" onClick={() => invoke("auth:signIn", undefined)}>
              Sign in
            </button>
          )}
        </div>
      </aside>
      <div className="main">
        <div className="topbar" style={{ position: "relative" }}>
          <input
            type="search"
            placeholder="Search users, groups, mailboxes, domains across all tenants…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onBlur={() => setTimeout(() => setSearchResults(null), 200)}
          />
          {searchResults && (
            <div className="search-results">
              {searchResults.length === 0 && <div className="row muted">No matches</div>}
              {searchResults.map((r, i) => (
                <div className="row" key={i}>
                  <span className="chip neutral">{r.kind}</span> <strong>{r.title}</strong>
                  <div className="muted">
                    {r.subtitle} — {r.tenantName}
                  </div>
                </div>
              ))}
            </div>
          )}
          {!auth?.signedIn && (
            <span className="chip warn">Not signed in — connect your partner account in the sidebar</span>
          )}
        </div>
        <div className="content">
          <Active />
        </div>
      </div>
    </>
  );
}
