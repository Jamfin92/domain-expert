/**
 * Cheap WebGL availability probe. This is guard one of two: the probe can
 * pass while `new WebGLRenderer()` still throws, so `EntityCity` also wraps
 * renderer construction in try/catch. Both failures land on the fallback.
 */
export function hasWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!ctx) return false;
    // Release the probe context: browsers cap live contexts (~16), and under
    // StrictMode this probe runs twice per mount.
    ctx.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}
