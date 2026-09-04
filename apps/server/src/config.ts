/**
 * Where "how am I exposed?" is decided, once, for both the server and the
 * deploy script.
 *
 * `POST /api/repos` opens any directory on the machine and the SQL grader runs
 * typed input, so binding anything but loopback without a token is not a
 * choice this code will make for you: it throws instead of starting.
 */

export interface ServerConfig {
  host: string;
  port: number;
  token?: string;
}

/**
 * `localhost` is loopback by convention (it is what `/etc/hosts` says on every
 * machine this runs on); the other two are loopback by construction.
 */
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

/** All three mean "every interface", which is the thing the interlock exists to stop. */
const WILDCARD = new Set(["0.0.0.0", "::", "[::]"]);

const MIN_TOKEN = 16;

export function resolveServerConfig(env: NodeJS.ProcessEnv): ServerConfig {
  const rawHost = env["PSQ_HOST"];
  let host = "127.0.0.1";
  if (rawHost !== undefined) {
    host = rawHost.trim();
    // An empty host is not "the default": Node's listen() treats it as :: and
    // binds every interface, which is the opposite of what a blank looks like.
    if (host === "") {
      throw new Error(
        "PSQ_HOST is set but empty. An empty host binds every interface — " +
          "set one address to bind, or unset PSQ_HOST for 127.0.0.1.",
      );
    }
    if (WILDCARD.has(host)) {
      throw new Error(
        `PSQ_HOST=${host} binds every interface. Bind one specific address ` +
          "(127.0.0.1 for local only, or the one private address you want to serve).",
      );
    }
  }

  const rawPort = env["PSQ_PORT"];
  let port = 8092;
  if (rawPort !== undefined) {
    const text = rawPort.trim();
    // Set-but-empty is a mistake, not a request for the default — the same
    // rule as PSQ_HOST, so an env file cannot mean two things by one blank.
    // Digits only: Number() would happily take "0x2360" and "1e3".
    if (!/^\d+$/.test(text)) {
      throw new Error(`PSQ_PORT=${rawPort} is not a port number (expected 1..65535).`);
    }
    const parsed = Number(text);
    if (parsed < 1 || parsed > 65535) {
      throw new Error(`PSQ_PORT=${rawPort} is not a port number (expected 1..65535).`);
    }
    port = parsed;
  }

  // Trimmed before it is measured and before it is used: a trailing space in
  // an env file is invisible, and it must neither pad a short token past the
  // minimum nor become part of the secret the server compares against.
  const rawToken = env["PSQ_TOKEN"]?.trim();
  let token: string | undefined;
  if (rawToken !== undefined && rawToken !== "") {
    if (rawToken.length < MIN_TOKEN) {
      throw new Error(
        `PSQ_TOKEN is too short (${String(rawToken.length)} characters, minimum ${String(MIN_TOKEN)}). ` +
          "Generate one with: openssl rand -hex 32",
      );
    }
    token = rawToken;
  }

  if (!LOOPBACK.has(host) && token === undefined) {
    throw new Error(
      `Refusing to serve ${host} with no token. Anyone who can reach that ` +
        "address could open any directory on this machine. Either set PSQ_TOKEN " +
        "(openssl rand -hex 32), or bind 127.0.0.1.",
    );
  }

  return token === undefined ? { host, port } : { host, port, token };
}
