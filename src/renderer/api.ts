import type { TenantDeckApi, IpcChannel, IpcRequest, IpcResponse } from "@shared/ipc";

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

export const onEvent = (...args: Parameters<TenantDeckApi["on"]>): (() => void) =>
  window.tenantdeck.on(...args);

/** Export any grid to CSV via the main-process save dialog. */
export async function exportCsv(
  filename: string,
  headers: string[],
  rows: (string | number | boolean | null)[][],
): Promise<void> {
  await invoke("export:csv", { filename, headers, rows });
}
