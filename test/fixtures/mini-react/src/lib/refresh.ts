/**
 * Two definitions, one key: the top-level function and the class method both
 * produce "src/lib/refresh.ts#Refresh". First wins, the collision is the
 * fixture's expected warning — and the LOSER owns a call, so the call must
 * come out unattributed: spilling its ownership outward to RefreshScheduler
 * would hand it to every component touching the class.
 */
export function Refresh(): string {
  return "refresh";
}

export class RefreshScheduler {
  /**
   * The constructor is dropped like every other non-method member: a type
   * annotation or instanceof references the class without constructing it,
   * so "referencing the class" does not prove this body ran.
   */
  constructor() {
    void fetch("/api/ctor");
  }

  /**
   * A property arrow is not a definition (only named methods are), so the
   * call inside it must be dropped, not handed to the class.
   */
  poll = (): Promise<Response> => fetch("/api/poll");

  async Refresh(): Promise<void> {
    await fetch("/api/refresh");
  }
}

/**
 * A class EXPRESSION: its members are never indexed, so the whole expression
 * is dropped — the call inside tick() must not attribute to Poller's
 * referencers.
 */
export const Poller = class {
  tick(): Promise<Response> {
    return fetch("/api/klass");
  }
};
