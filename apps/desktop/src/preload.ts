import { contextBridge, ipcRenderer } from "electron";

/**
 * The only bridge between the page and the machine.
 *
 * Three functions, no `require`, no filesystem, no shell. The renderer stays
 * sandboxed; the web build sees no `window.psq` at all and falls back to a
 * path input, which is why one UI build runs in both shells.
 */
contextBridge.exposeInMainWorld("psq", {
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke("psq:pickFolder"),
  openInEditor: (file: string, line?: number): Promise<boolean> =>
    ipcRenderer.invoke("psq:openInEditor", file, line),
  platform: process.platform,
});
