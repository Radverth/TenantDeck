import type {
  TenantDeckApi,
  IpcChannel,
  IpcRequest,
  IpcResponse,
  IpcEventChannel,
  IpcEvents,
} from "@shared/ipc";

declare global {
  interface Window {
    tenantdeck: TenantDeckApi;
  }
}

export function invoke<C extends IpcChannel>(
  channel: C,
  req: IpcRequest<C>,
): Promise<IpcResponse<C>> {
  return window.tenantdeck.invoke(channel, req);
}

export function onEvent<E extends IpcEventChannel>(
  channel: E,
  listener: (payload: IpcEvents[E]) => void,
): () => void {
  return window.tenantdeck.on(channel, listener);
}

/** Export any grid to CSV via the main-process save dialog. */
export async function exportCsv(
  filename: string,
  headers: string[],
  rows: (string | number | boolean | null)[][],
): Promise<void> {
  await invoke("export:csv", { filename, headers, rows });
}
