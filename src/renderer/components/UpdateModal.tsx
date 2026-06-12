import { useEffect, useState, type ReactNode } from "react";
import { invoke, onEvent } from "../api";
import type { UpdateStatus } from "@shared/types";

/**
 * Minimal update notice: no links, no release notes — just that an update
 * is available. Shown automatically when the launch check (or a manual
 * check from Settings) finds a new version.
 */
export default function UpdateModal(): ReactNode {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);

  useEffect(() => onEvent("event:updateStatus", setStatus), []);

  const show =
    status !== null &&
    (status.state === "downloading" || status.state === "downloaded") &&
    status.availableVersion !== null &&
    status.availableVersion !== dismissedVersion;

  if (!show) return null;

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h2 style={{ margin: "0 0 10px" }}>Update available</h2>
        <p>A new version of TenantDeck is available.</p>
        <p className="muted">by Tom Austin</p>
        <div className="toolbar" style={{ marginTop: 16, marginBottom: 0 }}>
          {status.state === "downloaded" ? (
            <button className="btn accent" onClick={() => invoke("update:install", undefined)}>
              Restart &amp; update
            </button>
          ) : (
            <button className="btn" disabled>
              Downloading…
            </button>
          )}
          <button className="btn" onClick={() => setDismissedVersion(status.availableVersion)}>
            Later
          </button>
        </div>
      </div>
    </div>
  );
}
