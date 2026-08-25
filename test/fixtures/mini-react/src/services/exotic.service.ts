const K = "computedMember";

/**
 * Members that CANNOT be definitions — a computed key, an accessor, a spread
 * — each holding a call. None of those calls may spill outward to
 * exoticService and fan out to components touching only `plain`.
 */
export const exoticService = {
  async plain(): Promise<unknown> {
    const res = await fetch("/api/exotic/plain");
    return res.json();
  },
  [K]() {
    return fetch("/api/exotic/computed");
  },
  get lazy(): Promise<Response> {
    return fetch("/api/exotic/accessor");
  },
  ...{
    inlineSpread(): Promise<Response> {
      return fetch("/api/exotic/spread");
    },
  },
};
