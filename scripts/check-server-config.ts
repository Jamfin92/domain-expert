/**
 * Validates the environment the LaunchAgent is about to be given, using the
 * server's own rules rather than a bash restatement of them, so a config the
 * server would refuse is never installed. Prints host:port and whether a token
 * is required — never the token.
 */
import { resolveServerConfig } from "../apps/server/src/config.js";

try {
  const { host, port, token } = resolveServerConfig(process.env);
  console.log(`${host}:${String(port)}  token: ${token ? "yes" : "no"}`);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
