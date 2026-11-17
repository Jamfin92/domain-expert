import type { Coverage } from "@/lib/api";

/**
 * The error every failed API call throws. Pure: no fetch, no storage, so the
 * builder below is a unit with no network wiring.
 *
 * `message` follows the client's long-standing rules exactly; `code` and
 * `coverage` are what the server's no-entities refusal adds
 * (`{ error, code: "no-entities", coverage }`).
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
    readonly code: string | null,
    readonly coverage: Coverage | null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Build the error for a non-ok response. Message: a 401 reads as `needsToken`;
 * an object body with an `error` key reads as `String(body.error)`; anything
 * else as `Request failed (<status>)`. `coverage` is trusted only beside its
 * own code, `no-entities`.
 */
export function errorFromResponse(status: number, body: unknown, needsToken: string): ApiError {
  const obj = body !== null && typeof body === "object" ? (body as Record<string, unknown>) : null;
  const message =
    status === 401
      ? needsToken
      : obj !== null && "error" in obj
        ? String(obj["error"])
        : `Request failed (${status})`;
  const code = obj !== null && typeof obj["code"] === "string" ? obj["code"] : null;
  const raw = obj?.["coverage"];
  const coverage =
    code === "no-entities" && raw !== null && typeof raw === "object" ? (raw as Coverage) : null;
  return new ApiError(message, status, body, code, coverage);
}
