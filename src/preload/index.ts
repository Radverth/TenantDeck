import { contextBridge, ipcRenderer } from "electron";
import type { IpcChannel, IpcEventChannel, TenantDeckApi } from "@shared/ipc";

/**
 * The only bridge between renderer and main: a typed invoke plus event
 * subscriptions. No Node APIs are ever exposed to the renderer.
 */
const api: TenantDeckApi = {
  invoke: (channel: IpcChannel, req: unknown) => ipcRenderer.invoke(channel, req),
  on: (channel: IpcEventChannel, listener: (payload: never) => void) => {
    const wrapped = (_event: unknown, payload: never): void => listener(payload);
    ipcRenderer.on(channel, wrapped as never);
    return () => ipcRenderer.removeListener(channel, wrapped as never);
  },
};

contextBridge.exposeInMainWorld("tenantdeck", api);
