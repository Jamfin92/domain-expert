/**
 * The desktop bridge, when there is one.
 *
 * Electron's preload exposes these; a browser has none of them. Every caller
 * feature-detects rather than branching on a build flag, so one UI build runs
 * in both shells and degrades to a path input on the web.
 */

export interface DesktopBridge {
  pickFolder(): Promise<string | null>;
  openInEditor(file: string, line?: number): Promise<boolean>;
  platform: string;
}

declare global {
  interface Window {
    psq?: DesktopBridge;
  }
}

export function desktop(): DesktopBridge | undefined {
  return typeof window === "undefined" ? undefined : window.psq;
}

export function isDesktop(): boolean {
  return desktop() !== undefined;
}
