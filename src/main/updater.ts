import { app } from "electron";
import type { UpdateStatus } from "@shared/types";

type Listener = (s: UpdateStatus) => void;

/**
 * Auto-update against the GitHub Releases feed (electron-updater).
 * Checks automatically on launch and on demand from Settings; downloads in
 * the background and installs on restart. Only active in packaged builds —
 * dev runs report "unsupported" instead of erroring on a missing
 * app-update.yml.
 */
class UpdaterService {
  private status: UpdateStatus = {
    state: "idle",
    currentVersion: app.getVersion(),
    availableVersion: null,
    message: null,
  };
  private listeners = new Set<Listener>();
  private wired = false;

  onChange(l: Listener): void {
    this.listeners.add(l);
  }

  getStatus(): UpdateStatus {
    return this.status;
  }

  private set(patch: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const l of this.listeners) l(this.status);
  }

  private async wire(): Promise<typeof import("electron-updater").autoUpdater | null> {
    if (!app.isPackaged) {
      this.set({ state: "unsupported", message: "Updates run in installed builds only" });
      return null;
    }
    const { autoUpdater } = await import("electron-updater");
    if (!this.wired) {
      this.wired = true;
      autoUpdater.autoDownload = true;
      autoUpdater.on("checking-for-update", () => this.set({ state: "checking", message: null }));
      autoUpdater.on("update-available", (info) =>
        this.set({ state: "downloading", availableVersion: info.version }),
      );
      autoUpdater.on("update-not-available", () =>
        this.set({ state: "upToDate", availableVersion: null }),
      );
      autoUpdater.on("update-downloaded", (info) =>
        this.set({ state: "downloaded", availableVersion: info.version }),
      );
      autoUpdater.on("error", (e) => this.set({ state: "error", message: e.message }));
    }
    return autoUpdater;
  }

  /** Manual trigger (Settings) and the automatic check on app open. */
  async check(): Promise<UpdateStatus> {
    try {
      const autoUpdater = await this.wire();
      if (autoUpdater) await autoUpdater.checkForUpdates();
    } catch (e) {
      this.set({ state: "error", message: e instanceof Error ? e.message : String(e) });
    }
    return this.status;
  }

  async install(): Promise<void> {
    const autoUpdater = await this.wire();
    if (autoUpdater && this.status.state === "downloaded") {
      autoUpdater.quitAndInstall();
    }
  }
}

export const updaterService = new UpdaterService();
