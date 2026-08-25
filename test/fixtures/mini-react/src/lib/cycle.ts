/** A reference cycle reaching no component; `visited` must terminate it. */
export function pingA(): unknown {
  void fetch("/api/ping");
  return pingB;
}

export function pingB(): unknown {
  return pingA;
}
